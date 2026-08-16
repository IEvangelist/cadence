import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'

// Accessibility gate: the rendered home page must be free of WCAG 2.1 A/AA
// violations. axe-core runs in the real browser against the production build.
test.describe('accessibility', () => {
  test('home page has no detectable WCAG 2.1 A/AA violations', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    // A non-empty array means real, actionable a11y defects — fail loudly and
    // surface them in the assertion diff.
    expect(results.violations).toEqual([])
  })

  test('document exposes a language and a single top-level landmark', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('main')).toHaveCount(1)
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const route of ['/', '/stems', '/pricing', '/profile', '/licenses']) {
      test(`${route} is axe-clean in ${theme} theme`, async ({ page }) => {
        await page.addInitScript((selectedTheme) => {
          localStorage.setItem('cadence.v1.theme', selectedTheme)
        }, theme)
        await page.goto(route)
        await expect(page.getByRole('main')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze()
        expect(results.violations).toEqual([])
      })
    }
  }
})
