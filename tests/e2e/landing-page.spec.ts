import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const openLandingPage = async (page: Page): Promise<void> => {
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
};

test('should expose only the initial landing contract when opening the landing route', async ({ page }) => {
  let transcriptionJobPostCount = 0;

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (request.method() === 'POST' && url.pathname === '/api/transcription-jobs') {
      transcriptionJobPostCount += 1;
    }
  });
  await openLandingPage(page);

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Textify' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Turn videos into text you can actually use' })).toBeVisible();
  const platforms = page.getByRole('list', { name: 'Supported Platforms' });
  await expect(platforms.getByRole('listitem')).toHaveText(['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X']);
  await expect(page.getByLabel('Source Video URL')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Get transcript' })).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'How Textify works' })).toBeVisible();
  await expect(page.locator('.reading-window')).toHaveCount(0);
  await expect(page.locator('.transcript')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open source' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'History' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /account|theme/iu })).toHaveCount(0);
  expect(transcriptionJobPostCount).toBe(0);
});

test('should retain same-document navigation and keyboard order when using initial page controls', async ({ page }) => {
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
});

test('should remain responsive and accessible when the initial landing page is rendered across supported viewports', async ({
  page,
}, testInfo) => {
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
    const submissionRail = document.querySelector('.submission-rail');

    if (submissionRail === null) {
      throw new Error('The submission surface is missing.');
    }

    return {
      submissionRailClientWidth: submissionRail.clientWidth,
      submissionRailScrollWidth: submissionRail.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth);
  expect(layout.submissionRailScrollWidth).toBeLessThanOrEqual(layout.submissionRailClientWidth);
  expect(dimensions.every(({ height, width }) => height >= 44 && width >= 44)).toBe(true);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Turn videos into text you can actually use' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How Textify works' })).toBeVisible();
  await expect(page.locator('.reading-window')).toHaveCount(0);

  const accessibilityResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibilityResults.violations).toEqual([]);
});

test('should remove motion and retain landing content when reduced motion is preferred', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'How Textify works' })).toBeVisible();
  await expect(page.locator('.reading-window')).toHaveCount(0);
});
