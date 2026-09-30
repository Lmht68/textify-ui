import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

import type {
  CancelledTranscriptionJobResponse,
  FailedTranscriptionJobResponse,
  ProcessingTranscriptionJobResponse,
  QueuedTranscriptionJobResponse,
  SucceededTranscriptionJobResponse,
} from '../../src/generated/textify-api/types.gen';

const JOB_ID = '00000000-0000-4000-8000-000000000099';
const FOREIGN_JOB_ID = '00000000-0000-4000-8000-000000000098';
const SUBMITTED_AT = '2025-01-02T03:04:05+00:00';
const STARTED_AT = '2025-01-02T03:04:07+00:00';
const FINISHED_AT = '2025-01-02T03:04:10+00:00';
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const SOURCE_VIDEO_URL = 'https://www.tiktok.com/@textify/video/1234567890';

const openLandingPage = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
};

const jobSelf = (capability: string): string => `/api/transcription-jobs/${capability}`;

const jobCancel = (capability: string): string => `${jobSelf(capability)}/cancellation`;

const queuedJobResponse = (capability: string): QueuedTranscriptionJobResponse => ({
  id: capability,
  status: 'queued',
  submitted_at: SUBMITTED_AT,
  links: {
    self: jobSelf(capability),
    cancel: jobCancel(capability),
  },
});

const processingJobResponse = (
  capability: string,
  cancel = jobCancel(capability),
): ProcessingTranscriptionJobResponse => ({
  id: capability,
  status: 'processing',
  submitted_at: SUBMITTED_AT,
  started_at: STARTED_AT,
  cancellation_requested: false,
  links: {
    self: jobSelf(capability),
    cancel,
  },
});

const succeededJobResponse = ({
  capability = JOB_ID,
  source = {
    platform: 'tiktok',
    url: SOURCE_VIDEO_URL,
    title: 'A complete Source Video',
    channel: 'Quiet Studio',
    duration_seconds: 258,
  },
  transcript = {
    language: 'en',
    text: 'A complete fixture Transcript.',
  },
}: Readonly<{
  capability?: string;
  source?: SucceededTranscriptionJobResponse['result']['source'];
  transcript?: SucceededTranscriptionJobResponse['result']['transcript'];
}> = {}): SucceededTranscriptionJobResponse => ({
  id: capability,
  status: 'finished',
  outcome: 'succeeded',
  submitted_at: SUBMITTED_AT,
  started_at: STARTED_AT,
  finished_at: FINISHED_AT,
  links: { self: jobSelf(capability) },
  result: { source, transcript },
});

const failedJobResponse = (
  capability: string,
  code: FailedTranscriptionJobResponse['error']['code'] = 'transcription_failed',
): FailedTranscriptionJobResponse => ({
  id: capability,
  status: 'finished',
  outcome: 'failed',
  submitted_at: SUBMITTED_AT,
  started_at: STARTED_AT,
  finished_at: FINISHED_AT,
  links: { self: jobSelf(capability) },
  error: {
    code,
    message: 'Private backend failure detail.',
  },
});

const cancelledJobResponse = (capability: string): CancelledTranscriptionJobResponse => ({
  id: capability,
  status: 'finished',
  outcome: 'cancelled',
  submitted_at: SUBMITTED_AT,
  started_at: null,
  finished_at: FINISHED_AT,
  links: { self: jobSelf(capability) },
});

const responseHeaders = (retryAfter: string | undefined): Record<string, string> => ({
  'cache-control': 'no-store',
  'content-type': 'application/json',
  'x-request-id': REQUEST_ID,
  ...(retryAfter === undefined ? {} : { 'retry-after': retryAfter }),
});

const fulfillAcceptedSubmission = async (
  route: Route,
  capability: string,
  retryAfter: string | undefined,
): Promise<void> => {
  await route.fulfill({
    status: 202,
    headers: {
      ...responseHeaders(retryAfter),
      location: jobSelf(capability),
    },
    body: JSON.stringify(queuedJobResponse(capability)),
  });
};

type InspectionResponse = Readonly<{
  body: unknown;
  retryAfter?: string | undefined;
  delayMilliseconds?: number | undefined;
}>;

type JobRouteCallbacks = Readonly<{
  onRequestStart?: (requestCount: number) => void;
  onRequestComplete?: (requestCount: number) => void;
}>;

type JobRoutes = Readonly<{
  getCount: () => number;
  getTimes: () => Array<number>;
  foreignGetCount: () => number;
}>;

const installJobRoutes = async (
  options: Readonly<{
    page: Page;
    capability?: string;
    postRetryAfter?: string | undefined;
    inspections: ReadonlyArray<InspectionResponse>;
    callbacks?: JobRouteCallbacks;
  }>,
): Promise<JobRoutes> => {
  const {
    page,
    capability = JOB_ID,
    inspections,
    callbacks = {},
  } = options;
  const postRetryAfter = Object.hasOwn(options, 'postRetryAfter') ? options.postRetryAfter : '1';
  const self = jobSelf(capability);
  const foreignSelf = jobSelf(FOREIGN_JOB_ID);
  let getCount = 0;
  let foreignGetCount = 0;
  const getTimes: Array<number> = [];

  await page.route('**/api/transcription-jobs**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;

    if (request.method() === 'POST' && path === '/api/transcription-jobs') {
      await fulfillAcceptedSubmission(route, capability, postRetryAfter);
      return;
    }

    if (request.method() !== 'GET') {
      await route.fulfill({ status: 405 });
      return;
    }

    if (path === foreignSelf) {
      foreignGetCount += 1;
      await route.fulfill({ status: 500 });
      return;
    }

    if (path !== self) {
      await route.fulfill({ status: 404 });
      return;
    }

    getCount += 1;
    getTimes.push(Date.now());
    callbacks.onRequestStart?.(getCount);
    const inspection = inspections[Math.min(getCount - 1, inspections.length - 1)];

    if (inspection === undefined) {
      throw new Error('The test received more inspection requests than it configured.');
    }

    try {
      if (inspection.delayMilliseconds !== undefined) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, inspection.delayMilliseconds);
        });
      }

      await route.fulfill({
        status: 200,
        headers: responseHeaders(inspection.retryAfter),
        body: JSON.stringify(inspection.body),
      });
    } finally {
      callbacks.onRequestComplete?.(getCount);
    }
  });

  return {
    getCount: () => getCount,
    getTimes: () => getTimes,
    foreignGetCount: () => foreignGetCount,
  };
};

const submitSourceVideo = async (page: Page): Promise<void> => {
  await page.getByLabel('Source Video URL').fill(SOURCE_VIDEO_URL);
  await page.getByRole('button', { name: 'Get transcript' }).click();
};

const expectNoFurtherPolling = async (page: Page, getCount: () => number): Promise<void> => {
  const terminalCount = getCount();

  await page.waitForTimeout(1_200);
  expect(getCount()).toBe(terminalCount);
};

const expectNoPrivateJobDetails = async (page: Page, capability: string): Promise<void> => {
  const readingWindow = page.locator('.reading-window__frame');

  await expect(readingWindow).not.toContainText(capability);
  await expect(readingWindow).not.toContainText('Private backend failure detail.');
  await expect(readingWindow).not.toContainText('transcription_failed');
};

test('should follow queued processing and success states when a Transcript Job completes', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    inspections: [
      { body: processingJobResponse(JOB_ID), retryAfter: '1' },
      { body: succeededJobResponse(), retryAfter: undefined },
    ],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Creating transcript' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A complete Source Video' })).toBeVisible();
  await expect(page.locator('.transcript')).toHaveText('A complete fixture Transcript.');
  await expect(page.getByText('Synthetic demo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Open source' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A complete Source Video' })).toBeFocused();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect(page.getByText(/%|queue position|estimated|remaining|stage/iu)).toHaveCount(0);
  expect(routes.getCount()).toBe(2);
  await expectNoFurtherPolling(page, routes.getCount);
});

test('should use the two-second poll fallback when accepted and active responses omit or malform Retry-After', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Timing floor is covered deterministically in Chromium.');
  const routes = await installJobRoutes({
    page,
    postRetryAfter: undefined,
    inspections: [
      { body: processingJobResponse(JOB_ID), retryAfter: 'malformed' },
      { body: succeededJobResponse(), retryAfter: undefined },
    ],
  });
  await openLandingPage(page);

  const acceptedAt = Date.now();
  await submitSourceVideo(page);
  await page.waitForTimeout(1_500);
  expect(routes.getCount()).toBe(0);
  await expect.poll(routes.getCount).toBe(1);
  const [firstPollAt] = routes.getTimes();

  if (firstPollAt === undefined) {
    throw new Error('The accepted job was not polled.');
  }

  expect(firstPollAt - acceptedAt).toBeGreaterThanOrEqual(1_900);
  await page.waitForTimeout(1_500);
  expect(routes.getCount()).toBe(1);
  await expect(page.getByRole('heading', { name: 'A complete Source Video' })).toBeVisible({ timeout: 2_500 });
  const [, secondPollAt] = routes.getTimes();

  if (secondPollAt === undefined) {
    throw new Error('The active job was not polled after the fallback delay.');
  }

  expect(secondPollAt - firstPollAt).toBeGreaterThanOrEqual(1_900);
});

test('should keep one inspection request in flight when an active response is delayed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Overlapping fetch coverage is deterministic in Chromium.');
  let inFlight = 0;
  let maxInFlight = 0;
  const routes = await installJobRoutes({
    page,
    inspections: [
      { body: processingJobResponse(JOB_ID), retryAfter: '1', delayMilliseconds: 1_300 },
      { body: succeededJobResponse(), retryAfter: undefined },
    ],
    callbacks: {
      onRequestStart: () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
      },
      onRequestComplete: () => {
        inFlight -= 1;
      },
    },
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  await expect(page.getByRole('heading', { name: 'A complete Source Video' })).toBeVisible({ timeout: 5_000 });
  expect(routes.getCount()).toBe(2);
  expect(maxInFlight).toBe(1);
});

test('should release a pending Transcript Job capability when the page reloads', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    postRetryAfter: '2',
    inspections: [{ body: processingJobResponse(JOB_ID), retryAfter: '1' }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
  await page.reload();

  await expect(page.getByRole('heading', { name: 'A short guide to better sleep' })).toBeVisible();
  await page.waitForTimeout(2_200);
  expect(routes.getCount()).toBe(0);
});

test('should render a generic focused failure when a queued Transcript Job fails', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: failedJobResponse(JOB_ID), retryAfter: undefined }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const heading = page.getByRole('heading', { name: 'Transcript unavailable' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText("Textify couldn't provide this Transcript.", { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open source' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await expectNoPrivateJobDetails(page, JOB_ID);
  await expectNoFurtherPolling(page, routes.getCount);
});

test('should render a generic focused cancellation when a queued Transcript Job is cancelled', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: cancelledJobResponse(JOB_ID), retryAfter: undefined }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const heading = page.getByRole('heading', { name: 'Transcript Job cancelled' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(
    page.getByText('This Transcript Job ended without creating a Transcript.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open source' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy' })).toHaveCount(0);
  await expectNoPrivateJobDetails(page, JOB_ID);
  await expectNoFurtherPolling(page, routes.getCount);
});

test('should treat an incomplete terminal response as a generic focused contract failure', async ({ page }) => {
  const malformedCancelledResponse = {
    id: JOB_ID,
    status: 'finished',
    outcome: 'cancelled',
    submitted_at: SUBMITTED_AT,
    started_at: null,
    links: { self: jobSelf(JOB_ID) },
    debug: 'private terminal detail',
  };
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: malformedCancelledResponse, retryAfter: undefined }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const heading = page.getByRole('heading', { name: 'Transcript unavailable' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText('private terminal detail', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open source' })).toHaveCount(0);
  await expectNoFurtherPolling(page, routes.getCount);
});

test('should reject a foreign active cancellation capability when an inspection self link matches', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: processingJobResponse(JOB_ID, jobCancel(FOREIGN_JOB_ID)), retryAfter: '1' }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const heading = page.getByRole('heading', { name: 'Transcript unavailable' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  expect(routes.foreignGetCount()).toBe(0);
  await expectNoFurtherPolling(page, routes.getCount);
  expect(routes.foreignGetCount()).toBe(0);
});

test('should expose only safe Source Video metadata and a noopener canonical source link when a title is empty', async ({
  page,
}, testInfo) => {
  const source = {
    platform: 'tiktok' as const,
    url: SOURCE_VIDEO_URL,
    title: '',
    channel: 'Quiet Studio',
    duration_seconds: 258,
    video_id: 'private-video-id',
    description: 'Private Source Video description.',
  };
  const transcript = {
    language: 'en',
    text: 'A complete fixture Transcript.',
    method: 'faster_whisper' as const,
  };
  await installJobRoutes({
    page,
    inspections: [{ body: succeededJobResponse({ source, transcript }), retryAfter: undefined }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  await expect(page.getByRole('heading', { name: 'TikTok video' })).toBeVisible();
  await expect(page.locator('.source-metadata dt').filter({ hasText: /^Supported Platform$/u })).toBeVisible();
  await expect(page.getByText('Quiet Studio', { exact: true })).toBeVisible();
  await expect(page.getByText('4 min 18 sec', { exact: true })).toBeVisible();
  await expect(page.getByText('English', { exact: true })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.locator('.reading-window__frame')).not.toContainText('private-video-id');
  await expect(page.locator('.reading-window__frame')).not.toContainText('Private Source Video description.');
  await expect(page.locator('.reading-window__frame')).not.toContainText('faster_whisper');

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open source' }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(SOURCE_VIDEO_URL);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();

  if (testInfo.project.name === 'mobile-webkit') {
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390);
  }
});

test('should preserve an empty backend-valid Transcript without enabling copy or download', async ({ page }) => {
  await installJobRoutes({
    page,
    inspections: [
      {
        body: succeededJobResponse({
          source: {
            platform: 'tiktok',
            url: SOURCE_VIDEO_URL,
            title: 'A silent Source Video',
            channel: '',
            duration_seconds: 42,
          },
          transcript: { language: 'und', text: '' },
        }),
        retryAfter: undefined,
      },
    ],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const explanation = page.getByText('No spoken text was detected in this Source Video.', { exact: true });
  const copy = page.getByRole('button', { name: 'Copy' });
  const download = page.getByRole('button', { name: 'Download' });
  await expect(explanation).toBeVisible();
  await expect(page.getByText('Unknown', { exact: true })).toBeVisible();
  await expect(page.locator('.source-metadata dt').filter({ hasText: /^Channel$/u })).toHaveCount(0);
  await expect(copy).toBeDisabled();
  await expect(download).toBeDisabled();
  await expect(copy).toHaveAttribute('aria-describedby', 'transcript-empty-state');
  await expect(download).toHaveAttribute('aria-describedby', 'transcript-empty-state');
  await expect(page.locator('.transcript')).toHaveText('No spoken text was detected in this Source Video.');
});

test('should copy and download the exact live Transcript when result actions are available', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Clipboard and download behavior is deterministic in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installJobRoutes({
    page,
    inspections: [{ body: succeededJobResponse(), retryAfter: undefined }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const copy = page.getByRole('button', { name: 'Copy' });
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('A complete fixture Transcript.');
  await expect(page.getByRole('status', { name: 'Copy feedback' })).toHaveText('Transcript copied.');
  await expect(copy).toBeFocused();

  const download = page.getByRole('button', { name: 'Download' });
  const downloadEvent = page.waitForEvent('download');
  await download.click();
  const downloadedFile = await downloadEvent;
  expect(downloadedFile.suggestedFilename()).toBe('textify-transcript.txt');
  await expect(page.getByRole('status', { name: 'Download feedback' })).toHaveText('Transcript downloaded.');
  await expect(download).toBeFocused();
});

test('should retain semantic reading order and accessibility across configured viewports when a Transcript succeeds', async ({
  page,
}, testInfo) => {
  await installJobRoutes({
    page,
    inspections: [
      {
        body: succeededJobResponse({
          transcript: { language: 'ar', text: 'نص عربي كامل.' },
        }),
        retryAfter: undefined,
      },
    ],
  });
  await openLandingPage(page);

  await submitSourceVideo(page);
  const transcript = page.locator('.transcript p');
  await expect(transcript).toHaveAttribute('dir', 'auto');
  await expect(transcript).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.locator('.source-metadata dt')).toHaveText([
    'Supported Platform',
    'Channel',
    'Duration',
    'Detected language',
  ]);
  await expect(page.locator('.command-rail__utilities > .command-rail__action')).toHaveCount(3);
  await expect(page.locator('.command-rail__utilities').getByRole('link')).toHaveText('Open source');
  await expect(page.locator('.command-rail__utilities').getByRole('button')).toHaveText(['Copy', 'Download']);

  if (testInfo.project.name === 'mobile-webkit') {
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390);
  } else {
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1440);
  }

  const dimensions = await page.locator('button, a, input').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }),
  );
  const layout = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    apertureClientWidth: document.querySelector('.reading-window__frame')?.clientWidth,
    apertureScrollWidth: document.querySelector('.reading-window__frame')?.scrollWidth,
  }));

  expect(dimensions.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.apertureScrollWidth).toBeLessThanOrEqual(layout.apertureClientWidth ?? 0);

  const accessibilityResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibilityResults.violations).toEqual([]);
});
