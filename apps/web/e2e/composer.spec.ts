import { test, expect } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function createBlankProject(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New project' }).click()
  await page.getByRole('button', { name: /Blank project/ }).click()
}

async function openExportMenu(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Export & share' }).click()
}

// Full composer flow against the production build: create a note, run the
// transport, export a .mid download, then reload and confirm the note persisted
// (localStorage autosave/restore). Exercises the audio engine, piano roll,
// MIDI export, and persistence end to end.
test.describe('composer', () => {
  test('create a note, play, export MIDI, and persist across reload', async ({ page }) => {
    await page.goto('/')

    // Start from a clean project so the assertions are unambiguous.
    await createBlankProject(page)
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
      (async () => {
        await openExportMenu(page)
        await page.getByRole('menuitem', { name: 'Export MIDI' }).click()
      })(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.mid$/)

    // Reload: the saved project (with our note) is restored from storage.
    await page.reload()
    await expect(page.locator('.pr-note')).toHaveCount(1)
    await expect(page.getByText('Your canvas is empty.')).toHaveCount(0)
  })

  test('round-trips a project through the portable .cadence.json file', async ({ page }) => {
    await page.goto('/')

    await createBlankProject(page)
    await expect(page.getByText('Your canvas is empty.')).toBeVisible()

    const grid = page.getByRole('application', { name: /Note grid/ })
    await grid.click({ position: { x: 72, y: 96 } })
    await grid.click({ position: { x: 144, y: 144 } })
    await expect(page.locator('.pr-note')).toHaveCount(2)

    // Export the portable project file and capture the download bytes.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await openExportMenu(page)
        await page.getByRole('menuitem', { name: /Export Project file/ }).click()
      })(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.cadence\.json$/)
    const dir = await mkdtemp(join(tmpdir(), 'cadence-e2e-'))
    const filePath = join(dir, download.suggestedFilename())
    await download.saveAs(filePath)
    const saved = JSON.parse(await readFile(filePath, 'utf8'))
    expect(saved.format).toBe('cadence-project')

    // Wipe the canvas, then re-import the file and confirm the notes return.
    await createBlankProject(page)
    await expect(page.locator('.pr-note')).toHaveCount(0)

    await page.getByLabel('Import project or MusicXML file').setInputFiles(filePath)
    await expect(page.locator('.pr-note')).toHaveCount(2)
  })

  test('opens a project shared through a URL fragment', async ({ page, browser }) => {
    // Build a self-contained shared project by exporting the portable file,
    // encoding it into the #project= fragment, then loading that URL fresh.
    await page.goto('/')
    await createBlankProject(page)
    const grid = page.getByRole('application', { name: /Note grid/ })
    await grid.click({ position: { x: 72, y: 96 } })
    await expect(page.locator('.pr-note')).toHaveCount(1)

    // Copy a shareable link to the clipboard (the app writes navigator.clipboard).
    await page.evaluate(() => {
      const w = window as unknown as { __copied?: string }
      const original = navigator.clipboard.writeText.bind(navigator.clipboard)
      navigator.clipboard.writeText = async (text: string) => {
        w.__copied = text
        return original(text)
      }
    })
    await openExportMenu(page)
    await page.getByRole('menuitem', { name: 'Share snapshot' }).click()
    const shareUrl = await page.evaluate(
      () => (window as unknown as { __copied?: string }).__copied ?? '',
    )
    expect(shareUrl).toContain('#project=')

    // Open the share URL in a *fresh* context with empty storage, so the note can
    // only come from the fragment — proving the share round-trip end to end.
    const fresh = await browser.newContext()
    const sharedPage = await fresh.newPage()
    await sharedPage.goto(shareUrl)
    // Empty storage means the note can only have come from the fragment.
    await expect(sharedPage.locator('.pr-note')).toHaveCount(1)
    await fresh.close()
  })
})
