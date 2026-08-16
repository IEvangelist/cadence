import { test, expect } from '@playwright/test'
import { chooseExport, createBlankProject } from './projectActions'

test.describe('composer shared contract surfaces', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __CADENCE_AI_MOCK__: boolean }).__CADENCE_AI_MOCK__ = true
    })
  })

  test('composer shared surfaces: edit → transport → AI accept → export → persist', async ({
    page,
  }) => {
    await page.goto('/')

    await createBlankProject(page)
    await expect(page.getByText('Your canvas is empty.')).toBeVisible()

    const grid = page.getByRole('application', { name: /Note grid/ })
    await expect(grid).toBeVisible()
    await grid.click({ position: { x: 72, y: 96 } })
    await expect(page.locator('.pr-note')).toHaveCount(1)

    await page.getByRole('button', { name: /Play/ }).click()
    await page.getByRole('button', { name: /Stop/ }).click()

    const panel = page.getByRole('region', { name: 'AI Assistant' })
    await expect(panel).toBeVisible()
    await panel.getByRole('radio', { name: /Generate melody/ }).check()
    await panel.getByRole('button', { name: 'Generate' }).click()
    await expect(panel.getByRole('button', { name: 'Accept' })).toBeVisible()
    const committedBefore = await page.locator('.pr-note:not(.is-preview)').count()
    await panel.getByRole('button', { name: 'Accept' }).click()
    await expect
      .poll(async () => page.locator('.pr-note:not(.is-preview)').count())
      .toBeGreaterThan(committedBefore)
    await expect(page.locator('.pr-note.is-preview')).toHaveCount(0)

    const committedAfter = await page.locator('.pr-note:not(.is-preview)').count()
    await page.getByRole('button', { name: 'Save' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      chooseExport(page, 'Export MIDI'),
    ])
    expect(download.suggestedFilename()).toMatch(/\.mid$/)

    await page.reload()
    await expect(page.locator('.pr-note')).toHaveCount(committedAfter)
  })
})
