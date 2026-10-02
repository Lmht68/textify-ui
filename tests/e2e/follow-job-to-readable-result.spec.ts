import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page, Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Window uses declaration merging.
  interface Window {
    __textifyObjectUrls: {
      created: Array<string>;
      revoked: Array<string>;
    };
    __textifyCancellationFetches: Array<{
      method: string;
      cache: RequestCache | undefined;
      hasBody: boolean;
    }>;
  }
}

import type {
  CancelledTranscriptionJobResponse,
  ErrorResponse,
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

const VIEW_SOURCE_VIDEO_URL = 'https://www.youtube.com/watch?v=AbCdEf12345&t=9&feature=share#chapter';
const VIEW_SEGMENTS = [
  {
    start: 0,
    end: 44,
    text: 'Regex? C++ [v2] (draft).* 日本語 النص العربي café.',
  },
  {
    start: 65.8,
    end: 110,
    text: 'A longunbrokentokenfortheviewportwithArabicمرحبابالعالمandmoretext.',
  },
  {
    start: 3661.9,
    end: 3665,
    text: 'Regex? C++ [v2] (draft).* café.',
  },
] as const;
const VIEW_TRANSCRIPT = {
  language: 'ar',
  text: VIEW_SEGMENTS.map((segment) => segment.text).join(' '),
  segments: [...VIEW_SEGMENTS],
} satisfies SucceededTranscriptionJobResponse['result']['transcript'];
const VIEW_SOURCE = {
  platform: 'youtube',
  url: VIEW_SOURCE_VIDEO_URL,
  title: 'A complete Source Video',
  channel: 'Quiet Studio',
  duration_seconds: 3665,
} satisfies SucceededTranscriptionJobResponse['result']['source'];

const EMPTY_TRANSCRIPT_SEGMENTS: Array<never> = [];

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
  cancellationRequested = false,
): ProcessingTranscriptionJobResponse => ({
  id: capability,
  status: 'processing',
  submitted_at: SUBMITTED_AT,
  started_at: STARTED_AT,
  cancellation_requested: cancellationRequested,
  links: {
    self: jobSelf(capability),
    cancel,
  },
});

const cancellationRequestedJobResponse = (capability: string): ProcessingTranscriptionJobResponse =>
  processingJobResponse(capability, jobCancel(capability), true);

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
    segments: [{ start: 0, end: 1, text: 'A complete fixture Transcript.' }],
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

const errorResponse = (code: ErrorResponse['error']['code']): ErrorResponse => ({
  error: {
    code,
    message: 'Private backend error detail.',
  },
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

type RouteGate = Readonly<{
  release: () => void;
  waitUntilStarted: () => Promise<void>;
  waitUntilReleased: () => Promise<void>;
  markStarted: () => void;
}>;

type ScriptedRouteResponse = Readonly<{
  body: unknown;
  status?: number | undefined;
  retryAfter?: string | undefined;
  headers?: Record<string, string> | undefined;
  delayMilliseconds?: number | undefined;
  gate?: RouteGate | undefined;
}>;

type InspectionResponse = ScriptedRouteResponse;

type CancellationResponse = ScriptedRouteResponse;

type Submission = Readonly<{
  capability: string;
  retryAfter?: string | undefined;
  gate?: RouteGate | undefined;
}>;

type RequestRecord = Readonly<{
  method: string;
  path: string;
  body: string | null;
}>;

type JobRouteCallbacks = Readonly<{
  onRequestStart?: (requestCount: number) => void;
  onRequestComplete?: (requestCount: number) => void;
}>;

type JobRoutes = Readonly<{
  postCount: () => number;
  getCount: () => number;
  putCount: () => number;
  getTimes: () => Array<number>;
  foreignGetCount: () => number;
  requests: () => Array<RequestRecord>;
}>;

const installJobRoutes = async (
  options: Readonly<{
    page: Page;
    capability?: string;
    postRetryAfter?: string | undefined;
    submissions?: ReadonlyArray<Submission>;
    inspections: ReadonlyArray<InspectionResponse>;
    cancellations?: ReadonlyArray<CancellationResponse>;
    callbacks?: JobRouteCallbacks;
  }>,
): Promise<JobRoutes> => {
  const {
    page,
    inspections,
    cancellations = [],
    callbacks = {},
  } = options;
  const postRetryAfter = Object.hasOwn(options, 'postRetryAfter') ? options.postRetryAfter : '1';
  const submissions = options.submissions ?? [{
    capability: options.capability ?? JOB_ID,
    retryAfter: postRetryAfter,
  }];
  const selfPaths = new Set(submissions.map((submission) => jobSelf(submission.capability)));
  const cancelPaths = new Set(submissions.map((submission) => jobCancel(submission.capability)));
  const foreignSelf = jobSelf(FOREIGN_JOB_ID);
  let postCount = 0;
  let getCount = 0;
  let putCount = 0;
  let foreignGetCount = 0;
  const getTimes: Array<number> = [];
  const requestRecords: Array<RequestRecord> = [];

  await page.route('**/api/transcription-jobs**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requestRecords.push({
      method: request.method(),
      path,
      body: request.postData(),
    });

    if (request.method() === 'POST' && path === '/api/transcription-jobs') {
      const submission = submissions[postCount];

      if (submission === undefined) {
        throw new Error('The test received more submission requests than it configured.');
      }

      postCount += 1;
      submission.gate?.markStarted();
      await submission.gate?.waitUntilReleased();
      await fulfillAcceptedSubmission(
        route,
        submission.capability,
        submission.retryAfter ?? postRetryAfter,
      );
      return;
    }

    if (request.method() === 'PUT') {
      if (!cancelPaths.has(path)) {
        await route.fulfill({ status: 404 });
        return;
      }

      const cancellation = cancellations[putCount];

      if (cancellation === undefined) {
        throw new Error('The test received more cancellation requests than it configured.');
      }

      putCount += 1;
      cancellation.gate?.markStarted();
      await cancellation.gate?.waitUntilReleased();
      await fulfillScriptedResponse(route, cancellation);
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

    if (!selfPaths.has(path)) {
      await route.fulfill({ status: 404 });
      return;
    }

    getCount += 1;
    getTimes.push(Date.now());
    callbacks.onRequestStart?.(getCount);
    const inspection = inspections[getCount - 1];

    if (inspection === undefined) {
      throw new Error('The test received more inspection requests than it configured.');
    }

    try {
      inspection.gate?.markStarted();
      await inspection.gate?.waitUntilReleased();
      await fulfillScriptedResponse(route, inspection);
    } finally {
      callbacks.onRequestComplete?.(getCount);
    }
  });

  return {
    postCount: () => postCount,
    getCount: () => getCount,
    putCount: () => putCount,
    getTimes: () => getTimes,
    foreignGetCount: () => foreignGetCount,
    requests: () => requestRecords,
  };
};

const fulfillScriptedResponse = async (route: Route, response: ScriptedRouteResponse): Promise<void> => {
  if (response.delayMilliseconds !== undefined) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, response.delayMilliseconds);
    });
  }

  await route.fulfill({
    status: response.status ?? 200,
    headers: response.headers ?? responseHeaders(response.retryAfter),
    body: JSON.stringify(response.body),
  });
};

const createRouteGate = (): RouteGate => {
  let resolveStarted: () => void = () => undefined;
  let resolveReleased: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    resolveReleased = resolve;
  });
  let hasStarted = false;

  return {
    release: resolveReleased,
    waitUntilStarted: () => started,
    waitUntilReleased: () => released,
    markStarted: () => {
      if (!hasStarted) {
        hasStarted = true;
        resolveStarted();
      }
    },
  };
};

const submitSourceVideo = async (page: Page, sourceVideoUrl = SOURCE_VIDEO_URL): Promise<void> => {
  await page.getByLabel('Source Video URL').fill(sourceVideoUrl);
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

const showCompletedResult = async ({
  page,
  source = VIEW_SOURCE,
  sourceVideoUrl = VIEW_SOURCE_VIDEO_URL,
  transcript = VIEW_TRANSCRIPT,
}: Readonly<{
  page: Page;
  source?: SucceededTranscriptionJobResponse['result']['source'];
  sourceVideoUrl?: string;
  transcript?: SucceededTranscriptionJobResponse['result']['transcript'];
}>): Promise<void> => {
  await installJobRoutes({
    page,
    inspections: [{ body: succeededJobResponse({ source, transcript }), retryAfter: undefined }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page, sourceVideoUrl);
  await expect(page.locator('.reading-window')).toBeVisible();
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
  await expect(page.locator('#transcript-plain-panel p')).toHaveText('A complete fixture Transcript.');
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

  await expect(page.getByRole('heading', { name: 'Turn videos into text you can actually use' })).toBeVisible();
  await expect(page.getByLabel('Source Video URL')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Get transcript' })).toBeEnabled();
  await expect(page.locator('.reading-window')).toHaveCount(0);
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
  await expect(page.locator('#transcript-empty-state')).toHaveText('No spoken text was detected in this Source Video.');
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
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('A complete fixture Transcript.\n');
  await expect(page.locator('#transcript-copy-feedback')).toHaveText('Plain text copied.');
  await expect(copy).toHaveAccessibleDescription('Plain text copied.');
  await expect(copy).toBeFocused();

  const download = page.getByRole('button', { name: 'Download' });
  const downloadEvent = page.waitForEvent('download');
  await download.click();
  const downloadedFile = await downloadEvent;
  const downloadPath = await downloadedFile.path();

  if (downloadPath === null) {
    throw new Error('The browser did not expose the downloaded Transcript.');
  }

  expect(downloadedFile.suggestedFilename()).toBe('a-complete-source-video-transcript.txt');
  expect(await readFile(downloadPath)).toEqual(Buffer.from('A complete fixture Transcript.\n', 'utf8'));
  await expect(page.locator('#transcript-download-feedback')).toHaveText('Plain text downloaded.');
  await expect(download).toHaveAccessibleDescription('Plain text downloaded.');
  await expect(download).toBeFocused();
});

test('should preserve selection and focus when Clipboard API rejects for a live Transcript', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Clipboard permission control is only deterministic in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => Promise.reject(new Error('Clipboard access rejected.')),
    });
  });
  await showCompletedResult({ page });

  const copy = page.getByRole('button', { name: 'Copy' });
  await expect(copy).toBeVisible();
  const selectedText = await page.evaluate(() => {
    const heading = document.querySelector('h1');
    const selection = document.getSelection();

    if (heading === null || selection === null) {
      throw new Error('The test selection could not be created.');
    }

    const range = document.createRange();
    range.selectNodeContents(heading);
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await copy.focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${VIEW_TRANSCRIPT.text}\n`);
  await expect(page.locator('#transcript-copy-feedback')).toHaveText('Plain text copied.');
  await expect(copy).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(selectedText);
});

test('should retain semantic reading order and accessibility across configured viewports when a Transcript succeeds', async ({
  page,
}, testInfo) => {
  await installJobRoutes({
    page,
    inspections: [{ body: succeededJobResponse({ source: VIEW_SOURCE, transcript: VIEW_TRANSCRIPT }), retryAfter: undefined }],
  });
  await openLandingPage(page);

  await submitSourceVideo(page, VIEW_SOURCE_VIDEO_URL);
  const transcript = page.locator('#transcript-plain-panel p');
  await expect(transcript).toHaveAttribute('dir', 'auto');
  await expect(transcript).toHaveAttribute('lang', 'ar');
  await expect(transcript).toContainText('Regex? C++ [v2] (draft).* 日本語 النص العربي café.');
  await expect(page.getByRole('tablist', { name: 'Transcript views' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Plain text' })).toHaveAttribute('aria-controls', 'transcript-plain-panel');
  await expect(page.getByRole('tab', { name: 'Timestamps' })).toHaveAttribute(
    'aria-controls',
    'transcript-timestamps-panel',
  );
  await page.getByRole('tab', { name: 'Timestamps' }).click();
  await expect(page.locator('.transcript__segment time')).toHaveText(['00:00', '01:05', '01:01:01']);
  await expect(page.locator('.transcript__segment > p')).toHaveText(VIEW_SEGMENTS.map((segment) => segment.text));
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

test('should activate transcript tabs with pointer and keyboard controls when Segments are available', async ({ page }) => {
  await showCompletedResult({ page });

  const plainText = page.getByRole('tab', { name: 'Plain text' });
  const timestamps = page.getByRole('tab', { name: 'Timestamps' });
  await expect(plainText).toHaveAttribute('aria-selected', 'true');
  await expect(plainText).toHaveAttribute('tabindex', '0');
  await expect(timestamps).toHaveAttribute('aria-selected', 'false');
  await expect(timestamps).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#transcript-plain-panel')).toBeVisible();
  await expect(page.locator('#transcript-timestamps-panel')).toBeHidden();

  await timestamps.click();
  await expect(timestamps).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#transcript-timestamps-panel')).toBeVisible();

  await timestamps.focus();
  await page.evaluate(() => {
    window.scrollTo({ top: 300, behavior: 'instant' });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(300);
  const scrollPosition = 300;
  await page.keyboard.press('ArrowLeft');
  await expect(plainText).toBeFocused();
  await expect(plainText).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollPosition);

  await page.keyboard.press('End');
  await expect(timestamps).toBeFocused();
  await expect(timestamps).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(plainText).toBeFocused();
  await expect(plainText).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(timestamps).toBeFocused();
  await expect(timestamps).toHaveAttribute('aria-selected', 'true');


  const readingOrder = await page.evaluate(() =>
    [
      '.reading-window__heading',
      '.source-metadata',
      '[role="tablist"]',
      '[role="search"]',
      '#transcript-plain-panel',
      '#transcript-timestamps-panel',
    ].map((selector) => {
      const element = document.querySelector(selector);

      if (element === null) {
        throw new Error(`Missing ${selector}.`);
      }

      return [...document.querySelectorAll('*')].indexOf(element);
    }),
  );
  expect(readingOrder).toEqual([...readingOrder].sort((first, second) => first - second));
});

for (const segments of [undefined, EMPTY_TRANSCRIPT_SEGMENTS]) {
  test(`should keep Plain text usable when Transcript Segments are ${segments === undefined ? 'omitted' : 'empty'}`, async ({
    page,
  }) => {
    const transcript =
      segments === undefined
        ? { language: 'en', text: 'A complete Transcript remains searchable.' }
        : { language: 'en', text: 'A complete Transcript remains searchable.', segments };
    await showCompletedResult({ page, transcript });

    const plainText = page.getByRole('tab', { name: 'Plain text' });
    const timestamps = page.getByRole('tab', { name: 'Timestamps' });
    const search = page.getByRole('searchbox', { name: 'Search Transcript' });
    await expect(timestamps).toHaveAttribute('aria-disabled', 'true');
    await expect(timestamps).toHaveAttribute('aria-describedby', 'transcript-timestamps-unavailable');
    await expect(timestamps).toHaveAttribute('tabindex', '-1');
    await expect(
      page.getByText("Timestamps aren't available because this Transcript has no Transcript Segments.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(search).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Copy' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Download' })).toBeEnabled();

    await search.fill('searchable');
    await expect(page.getByRole('status', { name: 'Search feedback' })).toHaveText('1 of 1 matches.');
    await timestamps.click({ force: true });
    await expect(plainText).toHaveAttribute('aria-selected', 'true');
    await timestamps.focus();
    await page.keyboard.press('Enter');
    await expect(plainText).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Space');
    await expect(plainText).toHaveAttribute('aria-selected', 'true');
  });
}

test('should find literal Unicode matches and preserve context when a Visitor searches a Transcript', async ({ page }) => {
  await showCompletedResult({ page });

  const search = page.getByRole('searchbox', { name: 'Search Transcript' });
  const feedback = page.getByRole('status', { name: 'Search feedback' });
  await search.fill('regex? c++ [v2] (draft).*');
  await expect(feedback).toHaveText('1 of 2 matches.');
  await expect(page.locator('mark')).toHaveCount(2);
  await expect(page.locator('.transcript__match--current')).toHaveText('Regex? C++ [v2] (draft).*');
  await expect(page.locator('#transcript-plain-panel')).toContainText(VIEW_TRANSCRIPT.text);

  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(feedback).toHaveText('2 of 2 matches.');
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(feedback).toHaveText('1 of 2 matches.');

  await search.fill('CAFÉ');
  await expect(feedback).toHaveText('1 of 2 matches.');
  await expect(page.locator('mark')).toHaveText(['café', 'café']);
  await search.fill('النص العربي');
  await expect(feedback).toHaveText('1 of 1 matches.');
  await search.fill('日本語');
  await expect(feedback).toHaveText('1 of 1 matches.');

  await search.fill('01:05');
  await expect(feedback).toHaveText('No matches.');
  await page.getByRole('tab', { name: 'Timestamps' }).click();
  await expect(search).toHaveValue('01:05');
  await expect(feedback).toHaveText('1 of 1 matches.');
  await expect(page.locator('.transcript__match--current')).toHaveText('01:05');
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(feedback).toHaveText('');
  await expect(page.locator('mark')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('should render complete Segment context responsively when a Transcript contains one thousand Segments', async ({
  page,
}) => {
  const segments = Array.from({ length: 1_000 }, (_, index) => ({
    start: index,
    end: index + 1,
    text: index === 999 ? 'Final Segment contains needle.' : `Segment ${index + 1} context.`,
  }));
  await showCompletedResult({
    page,
    transcript: {
      language: 'en',
      text: segments.map((segment) => segment.text).join(' '),
      segments,
    },
  });

  await page.getByRole('tab', { name: 'Timestamps' }).click();
  await page.getByRole('searchbox', { name: 'Search Transcript' }).fill('needle');
  await expect(page.getByRole('status', { name: 'Search feedback' })).toHaveText('1 of 1 matches.', {
    timeout: 5_000,
  });
  await expect(page.locator('.transcript__segment > p').first()).toHaveText('Segment 1 context.');
  await expect(page.locator('.transcript__segment > p').last()).toHaveText('Final Segment contains needle.');
});

test('should preserve narrow document bounds and target sizes when timestamped Segments render at 320 pixels', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The 320px aperture is measured deterministically in Chromium.');
  await page.setViewportSize({ width: 320, height: 844 });
  await showCompletedResult({ page });

  await page.getByRole('tab', { name: 'Timestamps' }).click();
  await expect(page.locator('.transcript__segment time').last()).toHaveText('01:01:01');
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
});

test('should copy and download the active representation with exact bytes when result actions succeed', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Clipboard and download behavior is deterministic in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL);
    const instrumentation = { created: [] as Array<string>, revoked: [] as Array<string> };

    Reflect.set(window, '__textifyObjectUrls', instrumentation);
    Reflect.set(URL, 'createObjectURL', (object: Blob) => {
      const objectUrl = originalCreateObjectUrl(object);
      instrumentation.created.push(objectUrl);
      return objectUrl;
    });
    Reflect.set(URL, 'revokeObjectURL', (objectUrl: string) => {
      instrumentation.revoked.push(objectUrl);
      originalRevokeObjectUrl(objectUrl);
    });
  });
  await showCompletedResult({ page });

  const plainExport = `${VIEW_TRANSCRIPT.text}\n`;
  const timestampExport =
    '[00:00] Regex? C++ [v2] (draft).* 日本語 النص العربي café.\n' +
    '[01:05] A longunbrokentokenfortheviewportwithArabicمرحبابالعالمandmoretext.\n' +
    '[01:01:01] Regex? C++ [v2] (draft).* café.\n';
  const copy = page.getByRole('button', { name: 'Copy' });
  const download = page.getByRole('button', { name: 'Download' });
  await page.getByRole('searchbox', { name: 'Search Transcript' }).fill('regex? c++ [v2] (draft).*');
  await expect(page.locator('mark')).toHaveCount(2);

  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(plainExport);
  await expect(page.locator('#transcript-copy-feedback')).toHaveText('Plain text copied.');
  await expect(copy).toHaveAccessibleDescription('Plain text copied.');
  await expect(download).not.toHaveAccessibleDescription('Plain text copied.');
  await expect(copy).toBeFocused();

  const plainDownload = page.waitForEvent('download');
  await download.click();
  const plainFile = await plainDownload;
  const plainPath = await plainFile.path();

  if (plainPath === null) {
    throw new Error('The browser did not expose the plain Transcript download.');
  }

  expect(plainFile.suggestedFilename()).toBe('a-complete-source-video-transcript.txt');
  expect(await readFile(plainPath)).toEqual(Buffer.from(plainExport, 'utf8'));
  await expect(page.locator('#transcript-download-feedback')).toHaveText('Plain text downloaded.');
  await expect(download).toHaveAccessibleDescription('Plain text downloaded.');
  await expect(copy).not.toHaveAccessibleDescription('Plain text downloaded.');
  await expect(download).toBeFocused();

  await page.getByRole('tab', { name: 'Timestamps' }).click();
  await copy.click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(timestampExport);
  await expect(page.locator('#transcript-copy-feedback')).toHaveText('Timestamps copied.');
  await expect(copy).toHaveAccessibleDescription('Timestamps copied.');

  const timestampDownload = page.waitForEvent('download');
  await download.click();
  const timestampFile = await timestampDownload;
  const timestampPath = await timestampFile.path();

  if (timestampPath === null) {
    throw new Error('The browser did not expose the timestamped Transcript download.');
  }

  expect(timestampFile.suggestedFilename()).toBe('a-complete-source-video-transcript-timestamps.txt');
  expect(await readFile(timestampPath)).toEqual(Buffer.from(timestampExport, 'utf8'));
  await expect(page.locator('#transcript-download-feedback')).toHaveText('Timestamps downloaded.');
  await expect(download).toHaveAccessibleDescription('Timestamps downloaded.');
  await expect(download).toBeFocused();
  await expect(page.locator('#transcript-copy-feedback')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#transcript-copy-feedback')).toHaveAttribute('aria-atomic', 'true');
  await expect(page.locator('#transcript-download-feedback')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('#transcript-download-feedback')).toHaveAttribute('aria-atomic', 'true');
  await expect.poll(() => page.evaluate('window.__textifyObjectUrls.revoked.length')).toBe(2);
  expect(await page.evaluate('window.__textifyObjectUrls.created')).toEqual(
    await page.evaluate('window.__textifyObjectUrls.revoked'),
  );
});

test('should derive safe title-based download names when Source Video titles are unavailable or unsafe', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Download names are verified in Chromium.');
  const emptyTitleSource = { ...VIEW_SOURCE, title: '' };
  await showCompletedResult({ page, source: emptyTitleSource });

  const emptyTitleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  expect((await emptyTitleDownload).suggestedFilename()).toBe('youtube-video-transcript.txt');
});

test('should sanitize unsafe Source Video titles when a Visitor downloads a Transcript', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Download names are verified in Chromium.');
  const unsafeTitleSource = { ...VIEW_SOURCE, title: '../Q&A: launch / 東京?.*' };
  await showCompletedResult({ page, source: unsafeTitleSource });

  const unsafeTitleDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  expect((await unsafeTitleDownload).suggestedFilename()).toBe('q-a-launch-東京-transcript.txt');
});

test('should report exact plain-view action failures when clipboard and object URL adapters fail', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Action adapter failures are deterministic in Chromium.');
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => Promise.reject(new Error('Clipboard access rejected.')),
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => false,
    });
    Reflect.set(URL, 'createObjectURL', () => {
      throw new Error('Object URL creation failed.');
    });
  });
  await showCompletedResult({ page });

  const copy = page.getByRole('button', { name: 'Copy' });
  const download = page.getByRole('button', { name: 'Download' });
  await copy.click();
  await expect(page.locator('#transcript-copy-feedback')).toHaveText("Couldn't copy the plain text. Try again.");
  await expect(copy).toHaveAccessibleDescription("Couldn't copy the plain text. Try again.");
  await expect(copy).toBeFocused();
  await download.click();
  await expect(page.locator('#transcript-download-feedback')).toHaveText(
    "Couldn't download the plain text. Try again.",
  );
  await expect(download).toHaveAccessibleDescription("Couldn't download the plain text. Try again.");
  await expect(download).toBeFocused();
});

test('should replace only the YouTube time parameter when a Visitor opens a timestamp', async ({ page }) => {
  await showCompletedResult({ page });

  const openSource = page.getByRole('link', { name: 'Open source' });
  await expect(openSource).toHaveAttribute('href', VIEW_SOURCE_VIDEO_URL);
  await page.getByRole('tab', { name: 'Timestamps' }).click();
  const popupEvent = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open source at 01:05' }).click();
  const popup = await popupEvent;
  const timecodeUrl = new URL(popup.url());

  expect(timecodeUrl.searchParams.getAll('t')).toEqual(['65']);
  expect(timecodeUrl.searchParams.get('v')).toBe('AbCdEf12345');
  expect(timecodeUrl.searchParams.get('feature')).toBe('share');
  expect(timecodeUrl.hash).toBe('#chapter');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
});

for (const [platform, sourceVideoUrl] of [
  ['tiktok', 'https://www.tiktok.com/@textify/video/1234567890'],
  ['instagram', 'https://www.instagram.com/reel/AbCdEf12345/'],
  ['facebook', 'https://www.facebook.com/watch/?v=1234567890'],
  ['x', 'https://x.com/textify/status/1234567890'],
] as const) {
  test(`should leave ${platform} time labels noninteractive when Segments render`, async ({ page }) => {
    const source = {
      ...VIEW_SOURCE,
      platform,
      url: sourceVideoUrl,
    };
    await showCompletedResult({ page, source, sourceVideoUrl });

    await expect(page.getByRole('link', { name: 'Open source' })).toHaveAttribute('href', sourceVideoUrl);
    await page.getByRole('tab', { name: 'Timestamps' }).click();
    await expect(page.locator('.transcript__segment time')).toHaveCount(VIEW_SEGMENTS.length);
    await expect(page.locator('.transcript__time-link')).toHaveCount(0);
  });
}

const REPLACEMENT_JOB_ID = '00000000-0000-4000-8000-000000000100';

const expectPoliteCancellationStatus = async (
  page: Page,
  button: Locator,
  message: string,
): Promise<void> => {
  const status = page.locator('#transcript-job-cancellation-status');

  await expect(status).toHaveText(message);
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(button).toHaveAttribute('aria-describedby', 'transcript-job-cancellation-status');
};

test('should cancel a queued Transcript Job with one empty PUT when a Visitor activates Cancel', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.__textifyCancellationFetches = [];
    window.fetch = async (input, init) => {
      const request = new Request(input, init);

      if (new URL(request.url).pathname.endsWith('/cancellation')) {
        window.__textifyCancellationFetches.push({
          method: request.method,
          cache: init?.cache,
          hasBody: Object.hasOwn(init ?? {}, 'body'),
        });
      }

      return originalFetch(input, init);
    };
  });
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{ status: 200, body: cancelledJobResponse(JOB_ID) }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  const heading = page.getByRole('heading', { name: 'Transcript Job cancelled', exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
  expect(routes.putCount()).toBe(1);
  expect(routes.getCount()).toBe(0);
  expect(routes.requests()).toEqual([
    { method: 'POST', path: '/api/transcription-jobs', body: JSON.stringify({ url: SOURCE_VIDEO_URL }) },
    { method: 'PUT', path: jobCancel(JOB_ID), body: null },
  ]);
  expect(await page.evaluate(() => window.__textifyCancellationFetches)).toEqual([
    { method: 'PUT', cache: 'no-store', hasBody: false },
  ]);
});

test('should follow accepted processing cancellation to a focused terminal outcome when cleanup completes', async ({
  page,
}) => {
  const routes = await installJobRoutes({
    page,
    inspections: [
      { body: cancellationRequestedJobResponse(JOB_ID), retryAfter: '1' },
      { body: cancelledJobResponse(JOB_ID) },
    ],
    cancellations: [{
      status: 202,
      body: cancellationRequestedJobResponse(JOB_ID),
      retryAfter: '1',
    }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);

  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await cancel.click();
  const requested = page.getByRole('button', { name: 'Cancellation requested', exact: true });
  await expect(page.getByRole('heading', { name: 'Cancelling transcript job', exact: true })).toBeVisible();
  await expect(requested).toBeFocused();
  await expectPoliteCancellationStatus(
    page,
    requested,
    'Cancellation accepted. Textify is cleaning up this Transcript Job.',
  );
  await expect(page.getByRole('heading', { name: 'Transcript Job cancelled', exact: true })).toBeFocused();
  expect(routes.putCount()).toBe(1);
  expect(routes.getCount()).toBe(2);
});

test('should reject repeated direct cancellation activation when its PUT is pending', async ({ page }) => {
  const cancellationGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{ status: 200, body: cancelledJobResponse(JOB_ID), gate: cancellationGate }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await cancellationGate.waitUntilStarted();
  const requested = page.getByRole('button', { name: 'Cancellation requested', exact: true });
  await expect(requested).toBeFocused();
  await expect(requested).toHaveAttribute('aria-disabled', 'true');
  await expectPoliteCancellationStatus(page, requested, 'Requesting cancellation.');
  await requested.press('Enter');
  await requested.press(' ');
  await requested.click({ force: true });
  expect(routes.putCount()).toBe(1);

  cancellationGate.release();
  await expect(page.getByRole('heading', { name: 'Transcript Job cancelled', exact: true })).toBeFocused();
});

test('should release the direct cancellation guard when cancellation cannot be confirmed', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [
      { status: 500, body: errorResponse('internal_error') },
      { status: 200, body: cancelledJobResponse(JOB_ID) },
    ],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(retry).toBeFocused();
  await expectPoliteCancellationStatus(
    page,
    retry,
    'Textify could not confirm cancellation. The Transcript Job is still active. Try again.',
  );
  await retry.click();

  await expect(page.getByRole('heading', { name: 'Transcript Job cancelled', exact: true })).toBeFocused();
  expect(routes.putCount()).toBe(2);
});

test('should protect confirmed replacement while its cancellation PUT is pending', async ({ page }) => {
  const cancellationGate = createRouteGate();
  const newSubmissionGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1', gate: newSubmissionGate },
    ],
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{ status: 200, body: cancelledJobResponse(JOB_ID), gate: cancellationGate }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page, SOURCE_VIDEO_URL);
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=replacement');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();

  const confirm = page.getByRole('button', { name: 'Cancel and replace', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await cancellationGate.waitUntilStarted();
  await expect(confirm).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Keep current job', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  const pendingStatus = page.locator('#replacement-cancellation-pending-status');
  await expect(pendingStatus).toHaveText('Requesting cancellation before starting the new Source Video.');
  await expect(pendingStatus).toHaveAttribute('role', 'status');
  await expect(pendingStatus).toHaveAttribute('aria-live', 'polite');
  await expect(pendingStatus).toHaveAttribute('aria-atomic', 'true');
  await expect(confirm).toHaveAttribute('aria-describedby', 'replacement-cancellation-pending-status');
  await confirm.press('Enter');
  await confirm.press(' ');
  await confirm.click({ force: true });
  await page.getByRole('button', { name: 'Keep current job', exact: true }).click({ force: true });
  await page.getByLabel('Source Video URL').press('Enter');
  expect(routes.putCount()).toBe(1);
  expect(routes.postCount()).toBe(1);

  cancellationGate.release();
  await newSubmissionGate.waitUntilStarted();
  const submit = page.getByRole('button', { name: 'Get transcript', exact: true });
  await expect(submit).toHaveAttribute('aria-disabled', 'true');
  await expect(submit).toBeFocused();
  expect(routes.requests().map(({ method, path }) => ({ method, path }))).toEqual([
    { method: 'POST', path: '/api/transcription-jobs' },
    { method: 'PUT', path: jobCancel(JOB_ID) },
    { method: 'POST', path: '/api/transcription-jobs' },
  ]);

  newSubmissionGate.release();
  await expect(page.getByRole('heading', { name: 'Waiting to start', exact: true })).toBeVisible();
});

test('should discard accepted cleanup and submit the confirmed replacement when cancellation returns 202', async ({
  page,
}) => {
  const newSubmissionGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1', gate: newSubmissionGate },
    ],
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{
      status: 202,
      body: cancellationRequestedJobResponse(JOB_ID),
      retryAfter: '1',
    }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=replace-202');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();

  await newSubmissionGate.waitUntilStarted();
  await expect(page.getByRole('button', { name: 'Get transcript', exact: true })).toBeFocused();
  expect(routes.requests().map(({ method, path }) => ({ method, path }))).toEqual([
    { method: 'POST', path: '/api/transcription-jobs' },
    { method: 'PUT', path: jobCancel(JOB_ID) },
    { method: 'POST', path: '/api/transcription-jobs' },
  ]);
  expect(routes.requests().filter(({ method, path }) => method === 'GET' && path === jobSelf(JOB_ID))).toHaveLength(0);

  newSubmissionGate.release();
});

test('should preserve active authority and the replacement draft when a Visitor declines replacement', async ({
  page,
}) => {
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  const replacementUrl = 'https://www.youtube.com/watch?v=declined';
  await page.getByLabel('Source Video URL').fill(replacementUrl);
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();

  await page.getByRole('button', { name: 'Keep current job', exact: true }).click();
  const submit = page.getByRole('button', { name: 'Get transcript', exact: true });
  await expect(submit).toBeFocused();
  await expect(page.getByLabel('Source Video URL')).toHaveValue(replacementUrl);
  await expect(page.getByLabel('Source Video URL')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  expect(routes.putCount()).toBe(0);
  expect(routes.postCount()).toBe(1);
});

test('should keep confirmation current for active inspection and submit once for a terminal inspection', async ({
  page,
}) => {
  const activeInspectionGate = createRouteGate();
  const terminalInspectionGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1' },
    ],
    inspections: [
      { body: processingJobResponse(JOB_ID), retryAfter: '1', gate: activeInspectionGate },
      { body: cancelledJobResponse(JOB_ID), gate: terminalInspectionGate },
    ],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=inspection-race');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();

  await activeInspectionGate.waitUntilStarted();
  activeInspectionGate.release();
  await expect(page.getByRole('heading', { name: 'Replace this Transcript Job?', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Creating transcript', exact: true })).toBeVisible();
  await terminalInspectionGate.waitUntilStarted();
  terminalInspectionGate.release();
  await expect.poll(routes.postCount).toBe(2);
  await expect(page.getByRole('button', { name: 'Get transcript', exact: true })).toBeFocused();
});

test('should ignore a stale old inspection while a replacement cancellation is pending', async ({ page }) => {
  const oldInspectionGate = createRouteGate();
  const cancellationGate = createRouteGate();
  const newSubmissionGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1', gate: newSubmissionGate },
    ],
    inspections: [{ body: cancelledJobResponse(JOB_ID), gate: oldInspectionGate }],
    cancellations: [{ status: 200, body: cancelledJobResponse(JOB_ID), gate: cancellationGate }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await oldInspectionGate.waitUntilStarted();
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=stale');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();
  await cancellationGate.waitUntilStarted();

  oldInspectionGate.release();
  await expect(page.locator('#replacement-cancellation-pending-status')).toHaveText(
    'Requesting cancellation before starting the new Source Video.',
  );
  expect(routes.postCount()).toBe(1);

  cancellationGate.release();
  await newSubmissionGate.waitUntilStarted();
  newSubmissionGate.release();
  await expect.poll(routes.postCount).toBe(2);
});

test('should check a direct completion race before rendering its terminal outcome', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: cancelledJobResponse(JOB_ID) }],
    cancellations: [{ status: 409, body: errorResponse('job_already_finished') }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const checking = page.getByRole('button', { name: 'Checking final outcome', exact: true });
  await expect(checking).toBeFocused();
  await expect(checking).toHaveAttribute('aria-disabled', 'true');
  await expectPoliteCancellationStatus(
    page,
    checking,
    'This Transcript Job finished before cancellation. Checking its final outcome.',
  );
  await expect(page.getByRole('heading', { name: 'Transcript Job cancelled', exact: true })).toBeFocused();
  expect(routes.getCount()).toBe(1);
});

for (const [name, inspection] of [
  ['succeeded', { body: succeededJobResponse() }],
  ['failed', { body: failedJobResponse(JOB_ID) }],
  ['cancelled', { body: cancelledJobResponse(JOB_ID) }],
  ['expired', { status: 404, body: errorResponse('job_not_found') }],
] as const) {
  test(`should submit immediately without cancellation when a ${name} Transcript Job receives a new Source Video`, async ({
    page,
  }) => {
    const routes = await installJobRoutes({
      page,
      submissions: [
        { capability: JOB_ID, retryAfter: '1' },
        { capability: REPLACEMENT_JOB_ID, retryAfter: '1' },
      ],
      inspections: [inspection],
    });
    await openLandingPage(page);
    await submitSourceVideo(page);

    await expect.poll(routes.getCount).toBe(1);
    await page.getByLabel('Source Video URL').fill(`https://www.youtube.com/watch?v=${name}`);
    await page.getByRole('button', { name: 'Get transcript', exact: true }).click();

    await expect.poll(routes.postCount).toBe(2);
    await expect(page.getByRole('heading', { name: 'Replace this Transcript Job?', exact: true })).toHaveCount(0);
    expect(routes.putCount()).toBe(0);
  });
}

for (const [name, cancellation] of [
  ['a foreign terminal self link', { status: 200, body: cancelledJobResponse(FOREIGN_JOB_ID) }],
  ['a mismatched terminal status', { status: 200, body: processingJobResponse(JOB_ID) }],
  ['a false cancellation_requested response', { status: 202, body: processingJobResponse(JOB_ID) }],
] as const) {
  test(`should retain active authority when cancellation returns ${name}`, async ({ page }) => {
    const routes = await installJobRoutes({
      page,
      inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
      cancellations: [cancellation],
    });
    await openLandingPage(page);
    await submitSourceVideo(page);

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const retry = page.getByRole('button', { name: 'Cancel', exact: true });
    await expect(retry).toBeFocused();
    await expectPoliteCancellationStatus(
      page,
      retry,
      'Textify could not confirm cancellation. The Transcript Job is still active. Try again.',
    );
    expect(routes.putCount()).toBe(1);
    expect(routes.getCount()).toBe(0);
  });
}

test('should cancel only the replacement capability after a successful replacement', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1' },
    ],
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [
      { status: 200, body: cancelledJobResponse(JOB_ID) },
      { status: 200, body: cancelledJobResponse(REPLACEMENT_JOB_ID) },
    ],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=second-cancel');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to start', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Transcript Job cancelled', exact: true })).toBeFocused();
  expect(routes.requests().filter(({ method }) => method === 'PUT').map(({ path }) => path)).toEqual([
    jobCancel(JOB_ID),
    jobCancel(REPLACEMENT_JOB_ID),
  ]);

  const browserVisibleState = await page.evaluate(async ({ oldCapability, newCapability }) => {
    const cacheEntries = await Promise.all(
      (await caches.keys()).map(async (name) => (await caches.open(name)).keys()),
    );
    const serializedState = JSON.stringify({
      url: window.location.href,
      dom: document.documentElement.outerHTML,
      cookies: document.cookie,
      localStorage: Object.entries(localStorage),
      sessionStorage: Object.entries(sessionStorage),
      cacheEntries: cacheEntries.flat().map((request) => request.url),
    });

    return serializedState.includes(oldCapability) || serializedState.includes(newCapability);
  }, { oldCapability: JOB_ID, newCapability: REPLACEMENT_JOB_ID });

  expect(browserVisibleState).toBe(false);
});

test('should submit the confirmed replacement when cancellation reports a completion race', async ({ page }) => {
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1' },
    ],
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{ status: 409, body: errorResponse('job_already_finished') }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=completion-race');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();

  await expect.poll(routes.postCount).toBe(2);
  expect(routes.putCount()).toBe(1);
  expect(routes.requests().filter(({ method, path }) => method === 'GET' && path === jobSelf(JOB_ID))).toHaveLength(0);
  await expect(page.getByRole('heading', { name: 'Waiting to start', exact: true })).toBeVisible();
});

test('should preserve a replacement draft without automatic submission when cancellation returns job_not_found', async ({
  page,
}) => {
  const replacementSourceVideoUrl = 'https://www.youtube.com/watch?v=expired-replacement';
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1' },
    ],
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{ status: 404, body: errorResponse('job_not_found') }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByLabel('Source Video URL').fill(replacementSourceVideoUrl);
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Transcript Job unavailable', exact: true })).toBeFocused();
  await expect(page.getByLabel('Source Video URL')).toHaveValue(replacementSourceVideoUrl);
  expect(routes.postCount()).toBe(1);
  expect(routes.putCount()).toBe(1);

  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await expect.poll(routes.postCount).toBe(2);
});

test('should start a replacement without another cancellation PUT when cleanup is already accepted', async ({
  page,
}) => {
  const newSubmissionGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1', gate: newSubmissionGate },
    ],
    inspections: [{ body: cancellationRequestedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{
      status: 202,
      body: cancellationRequestedJobResponse(JOB_ID),
      retryAfter: '1',
    }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cancelling transcript job', exact: true })).toBeVisible();
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=after-cleanup');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Start a new Transcript Job?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start new transcript', exact: true }).click();
  await newSubmissionGate.waitUntilStarted();
  expect(routes.putCount()).toBe(1);
  expect(routes.postCount()).toBe(2);

  newSubmissionGate.release();
});

test('should restore replacement confirmation for a retryable cancellation failure', async ({ page }) => {
  const replacementSourceVideoUrl = 'https://www.youtube.com/watch?v=retry-replacement';
  const routes = await installJobRoutes({
    page,
    inspections: [{ body: queuedJobResponse(JOB_ID), retryAfter: '1' }],
    cancellations: [{ status: 503, body: errorResponse('job_store_unavailable') }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await page.getByLabel('Source Video URL').fill(replacementSourceVideoUrl);
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Replace this Transcript Job?', exact: true })).toBeVisible();
  await expect(page.getByText(
    'Textify could not confirm cancellation. The Transcript Job is still active. Try again.',
    { exact: true },
  )).toBeVisible();
  await page.getByRole('button', { name: 'Keep current job', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Get transcript', exact: true })).toBeFocused();
  await expect(page.getByLabel('Source Video URL')).toHaveValue(replacementSourceVideoUrl);
  expect(routes.postCount()).toBe(1);
  expect(routes.putCount()).toBe(1);
});

test('should ignore an old inspection after replacement acceptance cannot reclaim the new submission', async ({
  page,
}) => {
  const oldInspectionGate = createRouteGate();
  const newSubmissionGate = createRouteGate();
  const routes = await installJobRoutes({
    page,
    submissions: [
      { capability: JOB_ID, retryAfter: '1' },
      { capability: REPLACEMENT_JOB_ID, retryAfter: '1', gate: newSubmissionGate },
    ],
    inspections: [{ body: succeededJobResponse(), gate: oldInspectionGate }],
    cancellations: [{ status: 200, body: cancelledJobResponse(JOB_ID) }],
  });
  await openLandingPage(page);
  await submitSourceVideo(page);
  await oldInspectionGate.waitUntilStarted();
  await page.getByLabel('Source Video URL').fill('https://www.youtube.com/watch?v=stale-after-acceptance');
  await page.getByRole('button', { name: 'Get transcript', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel and replace', exact: true }).click();
  await newSubmissionGate.waitUntilStarted();

  oldInspectionGate.release();
  await expect(page.getByRole('heading', { name: 'Sending Source Video', exact: true })).toBeVisible();
  expect(routes.postCount()).toBe(2);
  expect(routes.getCount()).toBe(1);

  newSubmissionGate.release();
});
