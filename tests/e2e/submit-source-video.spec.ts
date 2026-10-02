import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

const QUEUED_JOB_ID = '00000000-0000-4000-8000-000000000000';
const SUBMITTED_AT = '2025-01-02T03:04:05+00:00';
const RETRY_AFTER_SECONDS = '2';

const openLandingPage = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
};

const expectUnlockedLandingForm = async (page: Page, sourceVideoUrl: string): Promise<void> => {
  const input = page.getByLabel('Source Video URL');
  const submit = page.getByRole('button', { name: 'Get transcript' });

  await expect(input).toHaveValue(sourceVideoUrl);
  await expect(input).toBeEditable();
  await expect(submit).toBeEnabled();
  await expect(page.locator('.reading-window')).toHaveCount(0);
};

const queuedResponse = ({
  self,
  cancel,
}: Readonly<{
  self: string;
  cancel: string;
}>) => ({
  id: QUEUED_JOB_ID,
  status: 'queued',
  submitted_at: SUBMITTED_AT,
  links: { self, cancel },
});

const fulfillAcceptedSubmission = async (
  route: Route,
  capability: string,
  overrides: Readonly<{
    self?: string;
    cancel?: string;
  }> = {},
): Promise<void> => {
  const self = overrides.self ?? `/api/transcription-jobs/${capability}`;
  const cancel = overrides.cancel ?? `/api/transcription-jobs/${capability}/cancellation`;

  await route.fulfill({
    status: 202,
    contentType: 'application/json',
    headers: {
      'cache-control': 'no-store',
      location: self,
      'retry-after': RETRY_AFTER_SECONDS,
      'x-request-id': '00000000-0000-4000-8000-000000000001',
    },
    body: JSON.stringify(queuedResponse({ self, cancel })),
  });
};

test('should validate only absolute HTTPS URLs before submitting a Source Video', async ({ page }) => {
  let postCount = 0;
  const sourceVideoUrl = 'https://example.com/video';

  await page.route('**/api/transcription-jobs', async (route) => {
    postCount += 1;
    await fulfillAcceptedSubmission(route, '00000000-0000-4000-8000-000000000010');
  });
  await openLandingPage(page);

  const input = page.getByLabel('Source Video URL');
  const submit = page.getByRole('button', { name: 'Get transcript' });
  const feedback = page.locator('#source-video-url-feedback');
  const invalidInputs = [
    { value: '', message: 'Enter a Source Video URL.' },
    { value: 'not a URL', message: 'Enter a complete HTTPS Source Video URL.' },
    { value: '/relative/video', message: 'Enter a complete HTTPS Source Video URL.' },
    { value: 'http://example.com/video', message: 'Enter a complete HTTPS Source Video URL.' },
  ];

  for (const invalidInput of invalidInputs) {
    await input.fill(invalidInput.value);
    await submit.click();
    await expect(feedback).toHaveText(invalidInput.message);
    await expect(input).toBeFocused();
    await expectUnlockedLandingForm(page, invalidInput.value);
  }

  expect(postCount).toBe(0);

  await input.fill(sourceVideoUrl);
  await submit.click();

  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
  expect(postCount).toBe(1);
});

test('should keep the queued form available for confirmed replacement when a Source Video is accepted', async ({
  page,
}) => {
  let postCount = 0;
  let putCount = 0;
  const requestOrder: Array<string> = [];
  const sourceVideoUrl = 'https://example.com/video';
  const replacementSourceVideoUrl = 'https://example.com/replacement';

  await page.route('**/api/transcription-jobs', async (route) => {
    postCount += 1;
    requestOrder.push(`POST ${route.request().postData() ?? ''}`);
    await fulfillAcceptedSubmission(route, '00000000-0000-4000-8000-000000000011');
  });
  await page.route('**/api/transcription-jobs/*/cancellation', async (route) => {
    putCount += 1;
    requestOrder.push(`PUT ${route.request().postData() ?? ''}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'cache-control': 'no-store',
        'x-request-id': '00000000-0000-4000-8000-000000000001',
      },
      body: JSON.stringify({
        id: '00000000-0000-4000-8000-000000000011',
        status: 'finished',
        outcome: 'cancelled',
        submitted_at: SUBMITTED_AT,
        started_at: null,
        finished_at: '2025-01-02T03:04:06+00:00',
        links: { self: '/api/transcription-jobs/00000000-0000-4000-8000-000000000011' },
      }),
    });
  });
  await openLandingPage(page);

  const input = page.getByLabel('Source Video URL');
  const submit = page.getByRole('button', { name: 'Get transcript' });
  await input.fill(sourceVideoUrl);
  await submit.click();

  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
  await expect(input).toHaveValue(sourceVideoUrl);
  await expect(input).toBeEditable();
  await expect(submit).toBeEnabled();
  await input.fill(replacementSourceVideoUrl);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Replace this Transcript Job?' })).toBeVisible();
  expect(requestOrder).toEqual([`POST ${JSON.stringify({ url: sourceVideoUrl })}`]);

  await page.getByRole('button', { name: 'Cancel and replace' }).click();
  await expect.poll(() => postCount).toBe(2);
  expect(putCount).toBe(1);
  expect(requestOrder).toEqual([
    `POST ${JSON.stringify({ url: sourceVideoUrl })}`,
    'PUT ',
    `POST ${JSON.stringify({ url: replacementSourceVideoUrl })}`,
  ]);
});

test('should retry once after a connection failure when the second attempt is accepted', async ({ page }) => {
  let postCount = 0;
  const requestTimes: Array<number> = [];

  await page.addInitScript(() => {
    Object.defineProperty(Math, 'random', {
      configurable: true,
      value: () => 0.5,
    });
  });
  await page.route('**/api/transcription-jobs', async (route) => {
    postCount += 1;
    requestTimes.push(Date.now());

    if (postCount === 1) {
      await route.abort('failed');
      return;
    }

    await fulfillAcceptedSubmission(route, '00000000-0000-4000-8000-000000000012');
  });
  await openLandingPage(page);

  await page.getByLabel('Source Video URL').fill('https://example.com/video');
  await page.getByRole('button', { name: 'Get transcript' }).click();

  await expect(page.getByRole('heading', { name: 'Trying submission once more' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();
  expect(postCount).toBe(2);
  const [firstRequestTime, secondRequestTime] = requestTimes;

  if (firstRequestTime === undefined || secondRequestTime === undefined) {
    throw new Error('Expected exactly two submission attempts.');
  }

  const retryDelay = secondRequestTime - firstRequestTime;
  expect(retryDelay).toBeGreaterThanOrEqual(700);
  expect(retryDelay).toBeLessThan(1_500);
});

test('should stop automatic work and restore the initial landing state when both connection attempts fail', async ({ page }) => {
  let postCount = 0;

  await page.route('**/api/transcription-jobs', async (route) => {
    postCount += 1;
    await route.abort('failed');
  });
  await openLandingPage(page);

  await page.getByLabel('Source Video URL').fill('https://example.com/video');
  await page.getByRole('button', { name: 'Get transcript' }).click();

  await expectUnlockedLandingForm(page, 'https://example.com/video');
  await expect(
    page.getByText(
      'Textify could not confirm whether a previous attempt was accepted. Trying again may create another Transcript Job.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.waitForTimeout(1_100);
  expect(postCount).toBe(2);
});

test('should show frontend-owned validation feedback without retrying when the backend rejects the Source Video', async ({ page }) => {
  let postCount = 0;

  await page.route('**/api/transcription-jobs', async (route) => {
    postCount += 1;
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      headers: {
        'x-request-id': '00000000-0000-4000-8000-000000000002',
      },
      body: JSON.stringify({
        error: {
          code: 'invalid_url',
          message: 'A private backend detail that must not be rendered.',
        },
      }),
    });
  });
  await openLandingPage(page);

  await page.getByLabel('Source Video URL').fill('https://example.com/video');
  await page.getByRole('button', { name: 'Get transcript' }).click();

  await expectUnlockedLandingForm(page, 'https://example.com/video');
  await expect(page.locator('#source-video-url-feedback')).toHaveText('Check the Source Video URL and try again.');
  await expect(page.getByText('A private backend detail that must not be rendered.', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1_100);
  expect(postCount).toBe(1);
});

const unsafeCapabilityCases = [
  {
    self: 'https://untrusted.example/api/transcription-jobs/00000000-0000-4000-8000-000000000020',
    cancel: '/api/transcription-jobs/00000000-0000-4000-8000-000000000020/cancellation',
  },
  {
    self: '/api/transcription-jobs/00000000-0000-4000-8000-000000000021',
    cancel: 'https://untrusted.example/api/transcription-jobs/00000000-0000-4000-8000-000000000021/cancellation',
  },
  {
    self: '/api/not-transcription-jobs/00000000-0000-4000-8000-000000000022',
    cancel: '/api/transcription-jobs/00000000-0000-4000-8000-000000000022/cancellation',
  },
] as const;

for (const [index, unsafeCapabilityCase] of unsafeCapabilityCases.entries()) {
  test(`should reject an unsafe capability without retrying when accepted response variant ${index + 1} is received`, async ({ page }) => {
    let postCount = 0;

    await page.route('**/api/transcription-jobs', async (route) => {
      postCount += 1;
      await fulfillAcceptedSubmission(route, `00000000-0000-4000-8000-00000000003${index}`, unsafeCapabilityCase);
    });
    await openLandingPage(page);

    await page.getByLabel('Source Video URL').fill('https://example.com/video');
    await page.getByRole('button', { name: 'Get transcript' }).click();

    await expectUnlockedLandingForm(page, 'https://example.com/video');
    await expect(page.locator('#source-video-url-feedback')).toHaveText(
      'Textify could not submit this Source Video. Try again.',
    );
    await page.waitForTimeout(1_100);
    expect(postCount).toBe(1);
  });
}

test('should keep a queued capability out of browser-visible and persistent state when the page reloads', async ({ page }) => {
  let postCount = 0;
  const capability = '00000000-0000-4000-8000-000000000040';
  const consoleMessages: Array<string> = [];

  page.on('console', (message) => {
    consoleMessages.push(message.text());
  });
  await page.route('**/api/transcription-jobs', async (route) => {
    postCount += 1;
    await fulfillAcceptedSubmission(route, capability);
  });
  await openLandingPage(page);

  await page.getByLabel('Source Video URL').fill('https://example.com/video');
  await page.getByRole('button', { name: 'Get transcript' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toBeVisible();

  expect(page.url().includes(capability)).toBe(false);
  const authorityLeaks = await page.evaluate(async (value) => {
    const attributesContainValue = Array.from(document.querySelectorAll('*')).some((element) =>
      Array.from(element.attributes).some((attribute) => attribute.value.includes(value)),
    );
    let cacheContainsValue = false;

    if ('caches' in window) {
      for (const cacheName of await caches.keys()) {
        const cache = await caches.open(cacheName);

        for (const request of await cache.keys()) {
          if (request.url.includes(value)) {
            cacheContainsValue = true;
            break;
          }

          const response = await cache.match(request);

          if (response !== undefined && (await response.clone().text()).includes(value)) {
            cacheContainsValue = true;
            break;
          }
        }

        if (cacheContainsValue) {
          break;
        }
      }
    }

    const storageContainsValue = (storage: Storage): boolean => {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        const entry = key === null ? null : storage.getItem(key);

        if (key?.includes(value) || entry?.includes(value)) {
          return true;
        }
      }

      return false;
    };

    return {
      attribute: attributesContainValue,
      cookie: document.cookie.includes(value),
      dom: document.documentElement.outerHTML.includes(value),
      localStorage: storageContainsValue(localStorage),
      sessionStorage: storageContainsValue(sessionStorage),
      cacheStorage: cacheContainsValue,
    };
  }, capability);

  expect(authorityLeaks).toEqual({
    attribute: false,
    cookie: false,
    dom: false,
    localStorage: false,
    sessionStorage: false,
    cacheStorage: false,
  });
  expect(consoleMessages.some((message) => message.includes(capability))).toBe(false);

  await page.reload();

  await expectUnlockedLandingForm(page, '');
  await expect(page.getByRole('heading', { name: 'Waiting to start' })).toHaveCount(0);
  expect(postCount).toBe(1);
});
