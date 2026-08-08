import { test, expect } from '@playwright/test'

// Full composer flow against the production build: create a note, run the
// transport, export a .mid download, then reload and confirm the note persisted
// (localStorage autosave/restore). Exercises the audio engine, piano roll,
// MIDI export, and persistence end to end.
test.describe('composer', () => {
  test('create a note, play, export MIDI, and persist across reload', async ({ page }) => {
    await page.goto('/')

    // Start from a clean project so the assertions are unambiguous.
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByText('Your canvas is empty.')).toBeVisible()

    const grid = page.getByRole('application', { name: /Note grid/ })
    await expect(grid).toBeVisible()

    // Click the grid to place a note.
    await grid.click({ position: { x: 72, y: 96 } })
    await expect(page.locator('.pr-note')).toHaveCount(1)

    // Transport: press play, then stop.
    await page.getByRole('button', { name: /Play/ }).click()
    await page.getByRole('button', { name: /Stop/ }).click()

    // Persist explicitly, then export the project to a .mid download.
    await page.getByRole('button', { name: 'Save' }).click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export MIDI' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.mid$/)

    // Reload: the saved project (with our note) is restored from storage.
    await page.reload()
    await expect(page.locator('.pr-note')).toHaveCount(1)
    await expect(page.getByText('Your canvas is empty.')).toHaveCount(0)
  })
})
