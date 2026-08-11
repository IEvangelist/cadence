import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// #112 — visual proof of the pro composer editing controls. Runs against the
// production build and captures desktop screenshots of each headline feature so a
// reviewer can see precise single-note select/resize, zoom in/out, the velocity
// lane, and quantize without running the app. The shots land in the gitignored
// test-results/ dir; their paths are reported on the PR.
const SHOT_DIR = join('test-results', 'pro-editing')

async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

test.describe('composer pro editing (#112)', () => {
  test.beforeAll(async () => {
    await mkdir(SHOT_DIR, { recursive: true })
  })

  test('captures select/resize, zoom, velocity, and quantize', async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await dismissTour(page)

    const roll = page.locator('.piano-roll')
    await expect(roll).toBeVisible()
    await expect(page.locator('.pr-note').first()).toBeVisible()

    // (a) Precise single-note selection: zoom in once so the edges and both
    // resize handles read clearly, then select a single note.
    await page.getByRole('button', { name: 'Zoom in horizontally (time)' }).click()
    await page.getByRole('button', { name: 'Zoom in vertically (pitch)' }).click()
    const firstNote = page.locator('.pr-note').first()
    await firstNote.click()
    await expect(page.locator('.pr-note.is-selected')).toHaveCount(1)
    await roll.screenshot({ path: join(SHOT_DIR, 'a-note-selected.png') })

    // (b) Zoomed IN — push the time axis further for close, precise edits.
    await page.getByRole('button', { name: 'Zoom in horizontally (time)' }).click()
    await page.getByRole('button', { name: 'Zoom in horizontally (time)' }).click()
    await roll.screenshot({ path: join(SHOT_DIR, 'b-zoom-in.png') })

    // (b) Zoomed OUT — reset, then zoom out for the overview.
    await page.getByRole('button', { name: 'Reset zoom' }).click()
    await page.getByRole('button', { name: 'Zoom out horizontally (time)' }).click()
    await page.getByRole('button', { name: 'Zoom out vertically (pitch)' }).click()
    await roll.screenshot({ path: join(SHOT_DIR, 'c-zoom-out.png') })

    // (c) Velocity lane — vary a few bars so the per-note dynamics are visible.
    await page.getByRole('button', { name: 'Reset zoom' }).click()
    await page.getByRole('button', { name: 'Zoom in horizontally (time)' }).click()
    const bars = page.locator('.pr-vel-bar')
    const barCount = await bars.count()
    if (barCount > 0) {
      await bars.nth(0).focus()
      for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowDown')
    }
    if (barCount > 2) {
      await bars.nth(2).focus()
      for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowUp')
    }
    await expect(page.locator('.pr-velocity')).toBeVisible()
    await roll.screenshot({ path: join(SHOT_DIR, 'd-velocity-lane.png') })

    // (d) Quantize — snap every note to the current grid at full strength.
    await page.getByRole('button', { name: /Quantize/ }).click()
    await roll.screenshot({ path: join(SHOT_DIR, 'e-quantize.png') })

    // The roll is still intact and interactive after the whole flow.
    await expect(page.locator('.pr-note').first()).toBeVisible()
  })
})
