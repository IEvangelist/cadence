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
