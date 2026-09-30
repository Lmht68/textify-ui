import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const EXPECTED_DEMO_EXPORT = `Good sleep can improve your mood, focus, and overall health. A steady sleep routine gives your body a clearer rhythm for rest and wakefulness. Rather than chasing a perfect night, begin with a few habits you can repeat, then notice which ones help you feel more alert the next day.

Start by going to bed and waking at about the same time every day, including weekends. A consistent schedule helps regulate your internal clock, which can make it easier to fall asleep and wake naturally. If your routine has drifted, adjust it in small steps instead of trying to change several hours at once.

Seek natural light soon after waking. Morning light tells your brain that the day has begun and helps set the timing for sleep later that night. Open the curtains, sit near a bright window, or take a short walk outdoors. In the evening, lower the light where you can so the contrast between day and night stays clear.

Regular movement can also support sleep, especially when it happens earlier in the day. Choose an activity that fits your energy and schedule, whether that is walking, cycling, stretching, or a short workout. Caffeine can linger longer than expected, so notice how an afternoon coffee affects your sleep and move it earlier if needed.

If you nap, keep it short enough that it does not replace the sleep you need at night. An early-afternoon rest may restore attention without pushing bedtime later. Notice the result the same way you would notice caffeine: your own pattern is more useful than a universal rule.

Create a quiet wind-down routine for the last part of the evening. Dim bright screens, finish demanding tasks, and choose something calmer such as reading, stretching, or listening to music. The routine does not need to be elaborate. Repeating the same few cues can help your body recognize that sleep is approaching.

Keep the bedroom comfortably cool, dark, and quiet, and make the bed a place associated with rest. If you remain awake for a long time, step away for a calm activity in low light, then return when you feel sleepy. Good sleep is built from patterns, not a single perfect night, so give each change enough time before deciding whether it works for you.
`;

const openLandingPage = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Window uses declaration merging.
  interface Window {
    __textifyObjectUrls: {
      created: Array<string>;
      revoked: Array<string>;
    };
  }
}

test('should expose the synthetic demo contract when opening the landing route', async ({ page }) => {
  await openLandingPage(page);

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Textify' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Turn videos into text you can actually use' })).toBeVisible();
  const platforms = page.getByRole('list', { name: 'Supported Platforms' });
  await expect(platforms.getByRole('listitem')).toHaveText(['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X']);
  await expect(page.getByLabel('Source Video URL')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get transcript' })).toBeEnabled();
  await expect(page.getByText('Synthetic demo', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A short guide to better sleep' })).toBeVisible();
  await expect(page.locator('.transcript p')).toHaveCount(7);
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download' })).toBeVisible();
  await expect(page.getByText('To clipboard', { exact: true })).toHaveCount(0);
  await expect(page.getByText('As a .txt file', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /previous|next/i })).toHaveCount(0);
  await expect(page.locator('mark')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'How Textify works' })).toBeVisible();
  await expect(page.getByText(/keeps no History/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'History' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /account|theme/i })).toHaveCount(0);
  await expect(page.getByText(/timestamps|open source/i)).toHaveCount(0);
});


test('should copy the complete demo export when Clipboard API access succeeds', async ({ browserName, context, page }) => {
  test.skip(browserName !== 'chromium', 'Clipboard permission control is only deterministic in Chromium.');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openLandingPage(page);

  const copy = page.getByRole('button', { name: 'Copy' });
  await copy.click();

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(EXPECTED_DEMO_EXPORT);
  await expect(page.getByRole('status', { name: 'Copy feedback' })).toHaveText('Demo transcript copied.');
  await expect(page.getByRole('status', { name: 'Copy feedback' })).toHaveAttribute('aria-live', 'polite');
  await expect(page.getByRole('status', { name: 'Copy feedback' })).toHaveAttribute('aria-atomic', 'true');
  await expect(copy).toBeFocused();
  expect(Buffer.byteLength(EXPECTED_DEMO_EXPORT, 'utf8')).toBe(2197);
});

test('should preserve selection and focus when Clipboard API rejects but the fallback succeeds', async ({
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
  await openLandingPage(page);

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
  const copy = page.getByRole('button', { name: 'Copy' });
  await copy.focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(EXPECTED_DEMO_EXPORT);
  await expect(page.getByRole('status', { name: 'Copy feedback' })).toHaveText('Demo transcript copied.');
  await expect(copy).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.getSelection()?.toString())).toBe(selectedText);
});

test('should report an inline copy failure when every clipboard path fails', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Clipboard path control is only deterministic in Chromium.');
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async () => Promise.reject(new Error('Clipboard access rejected.')),
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => false,
    });
  });
  await openLandingPage(page);

  const copy = page.getByRole('button', { name: 'Copy' });
  await copy.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('status', { name: 'Copy feedback' })).toHaveText(
    "Couldn't copy the demo transcript. Try again.",
  );
  await expect(copy).toBeFocused();
});

test('should download and revoke the object URL when a Visitor requests the demo export', async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'Download events are verified in Chromium.');
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
  await openLandingPage(page);

  const download = page.getByRole('button', { name: 'Download' });
  const downloadEvent = page.waitForEvent('download');
  await download.click();
  const downloadedFile = await downloadEvent;
  const downloadPath = await downloadedFile.path();

  if (downloadPath === null) {
    throw new Error('The browser did not expose the downloaded demo export.');
  }

  expect(downloadedFile.suggestedFilename()).toBe('textify-demo-transcript.txt');
  expect((await readFile(downloadPath)).toString('utf8')).toBe(EXPECTED_DEMO_EXPORT);
  await expect(page.getByRole('status', { name: 'Download feedback' })).toHaveText('Demo transcript downloaded.');
  await expect(download).toBeFocused();
  await expect.poll(() => page.evaluate('window.__textifyObjectUrls.revoked.length')).toBe(1);
  await expect(page).toHaveURL('/');
  expect(await page.evaluate('window.__textifyObjectUrls.created[0]')).toBe(
    await page.evaluate('window.__textifyObjectUrls.revoked[0]'),
  );
});

test('should report an inline download failure when object URL creation fails', async ({ browserName, page }) => {
  test.skip(browserName !== 'chromium', 'Download creation failure is verified in Chromium.');
  await page.addInitScript(() => {
    Reflect.set(URL, 'createObjectURL', () => {
      throw new Error('Object URL creation failed.');
    });
  });
  await openLandingPage(page);

  const download = page.getByRole('button', { name: 'Download' });
  await download.click();

  await expect(page.getByRole('status', { name: 'Download feedback' })).toHaveText(
    "Couldn't download the demo transcript. Try again.",
  );
  await expect(download).toBeFocused();
});

test('should retain same-document navigation and keyboard order when using page controls', async ({ page }) => {
  await openLandingPage(page);

  const wordmark = page.getByRole('button', { name: 'Textify' });
  const howItWorks = page.getByRole('link', { name: 'How it works' });
  const sourceVideoUrl = page.getByLabel('Source Video URL');
  const submit = page.getByRole('button', { name: 'Get transcript' });
  await wordmark.click();
  await expect(page).toHaveURL('/');
  await expect(sourceVideoUrl).toBeFocused();

  await howItWorks.click();
  await expect(page).toHaveURL('/#how-it-works');
  await expect(page.locator('#how-it-works')).toBeInViewport();

  await page.goto('/');
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Tab');
  await expect(wordmark).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(howItWorks).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sourceVideoUrl).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Copy' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Download' })).toBeFocused();
});

test('should remain responsive and accessible when rendered across supported viewports', async ({ page }, testInfo) => {
  await openLandingPage(page);

  if (testInfo.project.name === 'mobile-webkit') {
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(390);
  }

  const dimensions = await page.locator('button, a, input').evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { height: box.height, width: box.width };
    }),
  );
  const layout = await page.evaluate(() => {
    const aperture = document.querySelector('.reading-window__frame');
    const submissionRail = document.querySelector('.submission-rail');

    if (aperture === null || submissionRail === null) {
      throw new Error('The submission surface is missing.');
    }

    return {
      apertureClientWidth: aperture.clientWidth,
      apertureScrollWidth: aperture.scrollWidth,
      submissionRailClientWidth: submissionRail.clientWidth,
      submissionRailScrollWidth: submissionRail.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.apertureScrollWidth).toBeLessThanOrEqual(layout.apertureClientWidth);
  expect(layout.submissionRailScrollWidth).toBeLessThanOrEqual(layout.submissionRailClientWidth);
  expect(dimensions.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Turn videos into text you can actually use' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A short guide to better sleep' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How Textify works' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLParagraphElement>('.transcript p'), (paragraph) => paragraph.dir),
    ),
  ).toEqual(['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto']);

  const accessibilityResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibilityResults.violations).toEqual([]);
});

test('should remove motion and retain visible content when reduced motion is preferred', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openLandingPage(page);

  const motion = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('button, a'));
    return {
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
      durations: elements.map((element) => {
        const styles = getComputedStyle(element);
        return {
          animationDuration: styles.animationDuration,
          transitionDuration: styles.transitionDuration,
        };
      }),
    };
  });

  expect(motion.scrollBehavior).toBe('auto');
  expect(
    motion.durations.every(
      ({ animationDuration, transitionDuration }) => animationDuration === '0s' && transitionDuration === '0s',
    ),
  ).toBe(true);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Turn videos into text you can actually use' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A short guide to better sleep' })).toBeVisible();
});
