import { test, expect, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chooseExport } from './projectActions'

// MP3 export end-to-end (issue #121). Exports the demo project to MP3 through the
// real UI + production build, saves the download, and proves it's a genuine MP3:
// a valid frame-sync header, non-empty bytes, and — the ground truth — the browser
// decodes it back to real audio samples via `decodeAudioData`. This exercises the
// offline-render → watermark → LAME-encode path in a real browser, entirely
// separate from the live playback graph (so it never touches the #97 audio seam).

async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

test.describe('MP3 export', () => {
  test('exports a valid, decodable .mp3 from the demo project', async ({ page }) => {
    await page.goto('/')
    await dismissTour(page)

    // The app boots with the demo project, so there is audible content to render.
    await expect(page.locator('.pr-note').first()).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      chooseExport(page, 'Export MP3 audio'),
    ])
    expect(download.suggestedFilename()).toMatch(/\.mp3$/)

    const dir = await mkdtemp(join(tmpdir(), 'cadence-mp3-'))
    const filePath = join(dir, download.suggestedFilename())
    await download.saveAs(filePath)
    const bytes = await readFile(filePath)

    // Non-empty, and opens with the MPEG frame sync (0xFF 0xEx).
    expect(bytes.length).toBeGreaterThan(1024)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1] & 0xe0).toBe(0xe0)

    // Ground truth: a real browser decodes the bytes back to audio samples.
    const decoded = await page.evaluate(async (b64: string) => {
      const binary = atob(b64)
      const buf = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) buf[i] = binary.charCodeAt(i)
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      try {
        const audio = await ctx.decodeAudioData(buf.buffer)
        return { duration: audio.duration, length: audio.length }
      } finally {
        await ctx.close()
      }
    }, bytes.toString('base64'))

    expect(decoded.length).toBeGreaterThan(0)
    expect(decoded.duration).toBeGreaterThan(0)
  })
})
