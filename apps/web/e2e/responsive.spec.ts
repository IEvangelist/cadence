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

      await expect(page.getByRole('main')).toBeVisible()

      const overflow = await page.evaluate(() => {
        const el = document.documentElement
        return el.scrollWidth - el.clientWidth
      })

      expect(overflow).toBeLessThanOrEqual(1)
    })
  }

  for (const viewport of viewports) {
    test(`secondary routes have no horizontal overflow at ${viewport.name}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      for (const path of ['/pricing', '/stems', '/licenses', '/profile']) {
        await page.goto(path)
        await expect(page.getByRole('main')).toBeVisible()

        const overflow = await page.evaluate(() => {
          const element = document.documentElement
          return element.scrollWidth - element.clientWidth
        })
        expect(overflow, `${path} overflow at ${viewport.name}`).toBeLessThanOrEqual(1)
      }

      if (viewport.name === 'mobile') {
        const dialog = page.getByRole('dialog', { name: 'Sign in to Cadence' })
        await expect(dialog).toBeVisible()
        const bounds = await dialog.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
      }
    })
  }
})
