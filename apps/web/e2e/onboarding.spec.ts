import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test.describe('first-run onboarding', () => {
  test('opens on first run, passes WCAG 2.1 A/AA axe, and closes with Escape', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Blank project/ }).click()

    await expect(page.getByRole('dialog')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('persists dismissal after skipping', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /Blank project/ }).click()

    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'Skip tour' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await page.reload()
    await expect(page.getByRole('dialog')).toBeHidden()
  })
})
