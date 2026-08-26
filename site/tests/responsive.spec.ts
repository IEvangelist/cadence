import { test, expect } from '@playwright/test';

// Runs across the desktop / tablet / mobile projects declared in the config, so
// the same assertions cover all three breakpoints.
const paths = ['/cadence/', '/cadence/docs/', '/cadence/docs/features/'];

for (const path of paths) {
  test(`no horizontal overflow at ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    // Allow 1px for sub-pixel rounding; anything more is a real layout leak.
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('primary nav follows the 48rem breakpoint', async ({ page }, testInfo) => {
  await page.goto('/cadence/', { waitUntil: 'networkidle' });
  const desktopNav = page.locator('nav.nav-desktop');
  if (testInfo.project.name === 'mobile') {
    await expect(desktopNav).toBeHidden();
  } else {
    await expect(desktopNav).toBeVisible();
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`Motion renders the ${theme} theme without responsive regressions`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript((preference) => {
      localStorage.setItem('cadence.v1.theme', preference);
    }, theme);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'no-preference' });
    await page.goto('/cadence/', { waitUntil: 'networkidle' });

    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
    await expect(page.getByRole('heading', { level: 1, name: 'Make the idea land.' })).toBeVisible();

    const reveal = page.locator('.ai-copy');
    await reveal.scrollIntoViewIfNeeded();
    await expect(reveal).toHaveCSS('opacity', '1');
    await expect(reveal).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(pageErrors).toEqual([]);
  });
}
