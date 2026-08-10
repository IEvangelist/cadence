import { test, expect } from '@playwright/test'

const viewports = [
  { name: 'mobile', width: 375, height: 667 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]

test.describe('responsive', () => {
  for (const viewport of viewports) {
    test(`has no horizontal overflow at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      await expect(
        page.getByRole('heading', { level: 1, name: 'Cadence' }),
      ).toBeVisible()

      const overflow = await page.evaluate(() => {
        const el = document.documentElement
        return el.scrollWidth - el.clientWidth
      })

      expect(overflow).toBeLessThanOrEqual(1)
    })
  }
})
