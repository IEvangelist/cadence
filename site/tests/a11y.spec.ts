import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// WCAG 2.0/2.1 level A + AA — the brand palette is already AA (see
// docs/brand/color/contrast-report.md), so the landing + docs must stay clean.
const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const pages = [
  { name: 'landing page', path: '/cadence/' },
  { name: 'docs overview', path: '/cadence/docs/' },
  { name: 'docs article', path: '/cadence/docs/getting-started/' },
];

for (const p of pages) {
  test(`${p.name} has no WCAG A/AA violations`, async ({ page }) => {
    await page.goto(p.path, { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations, null, 2),
    ).toEqual([]);
  });
}
