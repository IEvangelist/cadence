import { test, expect, type Page } from '@playwright/test'

// #110 Quick Starts (house-dub templates). Proves the gallery wires a one-click
// template into the composer through the existing load-project path: the roll
// shows the loaded arrangement and it is immediately playable (real output RMS >
// 0, reusing the #97 audio tap). Also covers a keyboard-only open+load (a11y).

// Autoplay without a gesture + muted device, so the analyser still sees signal
// while CI stays quiet (identical to audio.spec's harness).
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  },
})

/** Fan every connection that reaches the destination out to an AnalyserNode. */
async function installOutputTap(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const globalWithTap = window as unknown as { __cadenceAnalysers?: AnalyserNode[] }
    const analysers: AnalyserNode[] = []
    globalWithTap.__cadenceAnalysers = analysers
    const nativeConnect = AudioNode.prototype.connect
    AudioNode.prototype.connect = function connect(
      this: AudioNode,
      target: AudioNode | AudioParam,
      ...rest: number[]
    ) {
      if (target instanceof AudioDestinationNode) {
        try {
          const analyser = this.context.createAnalyser()
          analyser.fftSize = 2048
          nativeConnect.call(this, analyser)
          analysers.push(analyser)
        } catch {
          // Other destination taps still attach; the measurement uses those.
        }
      }
      return (
        nativeConnect as unknown as (this: AudioNode, ...args: unknown[]) => AudioNode
      ).call(this, target, ...rest)
    } as typeof AudioNode.prototype.connect
  })
}

/** Peak output RMS over ~3s — >0.01 proves real audio, ~0 proves silence. */
async function peakRms(page: Page): Promise<{ peak: number; analyserCount: number }> {
  return page.evaluate(async () => {
    const globalWithTap = window as unknown as { __cadenceAnalysers?: AnalyserNode[] }
    const analysers = globalWithTap.__cadenceAnalysers ?? []
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    let peak = 0
    for (let frame = 0; frame < 150; frame += 1) {
      for (const analyser of analysers) {
        const buffer = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buffer)
        let sumSquares = 0
        for (let i = 0; i < buffer.length; i += 1) sumSquares += buffer[i] * buffer[i]
        const rms = Math.sqrt(sumSquares / buffer.length)
        if (rms > peak) peak = rms
      }
      if (peak > 0.01) break
      await sleep(20)
    }
    return { peak, analyserCount: analysers.length }
  })
}

async function dismissOnboarding(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

test.describe('quick starts (house dubs)', () => {
  test('opening the gallery and loading a template populates the composer', async ({
    page,
  }) => {
    await page.goto('/')
    await dismissOnboarding(page)

    // Expand the collapsible Quick Starts panel, then load a template.
    await page.getByRole('button', { name: 'Quick Starts' }).click()
    const gallery = page.getByRole('region', { name: 'Quick Starts' })
    await expect(gallery).toBeVisible()
    await gallery.getByRole('button', { name: /Midnight Tape/ }).click()

    // The composer now holds the multi-track template, and the roll shows notes.
    await expect(page.getByLabel('Project name')).toHaveValue('Midnight Tape')
    await expect(page.locator('.pr-note').first()).toBeVisible()
  })

  test('a loaded template is immediately playable (output RMS > 0)', async ({ page }) => {
    await installOutputTap(page)
    await page.goto('/')
    await dismissOnboarding(page)

    await page.getByRole('button', { name: 'Quick Starts' }).click()
    await page
      .getByRole('region', { name: 'Quick Starts' })
      .getByRole('button', { name: /Sunset Boulevard/ })
      .click()
    await expect(page.getByLabel('Project name')).toHaveValue('Sunset Boulevard')
    await expect(page.locator('.pr-note').first()).toBeVisible()

    await page.locator('button.transport-play').click()

    const result = await peakRms(page)
    expect(result.analyserCount).toBeGreaterThan(0)
    expect(result.peak).toBeGreaterThan(0.01)
  })

  test('keyboard-only: open the gallery and load a template', async ({ page }) => {
    await page.goto('/')
    await dismissOnboarding(page)

    // Focus the disclosure and activate it with the keyboard.
    const disclosure = page.getByRole('button', { name: 'Quick Starts' })
    await disclosure.focus()
    await expect(disclosure).toBeFocused()
    await page.keyboard.press('Enter')

    // Focus a template card and activate it with the keyboard.
    const card = page
      .getByRole('region', { name: 'Quick Starts' })
      .getByRole('button', { name: /Weightless Drift/ })
    await card.focus()
    await expect(card).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page.getByLabel('Project name')).toHaveValue('Weightless Drift')
    await expect(page.locator('.pr-note').first()).toBeVisible()
  })
})
