import { test, expect, type Page } from '@playwright/test'
import { openMixWorkspace } from './studioActions'

// Parameter-automation guard (#44 mixer automation, the #112 follow-up). This is
// the *inverse* of the #97 audible guard in `audio.spec.ts`: instead of proving
// the graph makes sound, it proves a drawn automation lane can drive a mixer
// parameter over the transport timeline and audibly change the output. We draw a
// single master-gain point near the bottom of the lane (≈ -60 dB) and assert the
// measured output RMS is held BELOW the noise floor while the transport rolls.
//
// Because automation is applied on the #44 mixer overlay (masterGain node), never
// the frozen #97 note-playback seam, a working note graph that would otherwise be
// audible (see audio.spec) must go silent purely from the automation override.

test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  },
})

// Tap every node that reaches the destination with an AnalyserNode so we can read
// the real output signal (additive — it never changes what plays). Installed
// before app/Tone.js code runs so the first `master.toDestination()` is captured.
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
          // Other destination connections still get analysers.
        }
      }
      return (
        nativeConnect as unknown as (
          this: AudioNode,
          ...args: unknown[]
        ) => AudioNode
      ).call(this, target, ...rest)
    } as typeof AudioNode.prototype.connect
  })
}

// Roll the transport, let the automation settle past any first-frame transient,
// then return the peak output RMS over a ~1.6s window. A silenced master bus
// stays near zero; a bus at unity would clear 0.01 almost immediately.
async function measureSettledPeakRms(page: Page): Promise<{ peak: number; analyserCount: number }> {
  return page.evaluate(async () => {
    const globalWithTap = window as unknown as { __cadenceAnalysers?: AnalyserNode[] }
    const analysers = globalWithTap.__cadenceAnalysers ?? []
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    // Let the transport start and the per-frame automation apply clamp the master
    // bus before we measure, so a one-frame startup transient can't fail the guard.
    await sleep(400)

    let peak = 0
    for (let frame = 0; frame < 80; frame += 1) {
      for (const analyser of analysers) {
        const buffer = new Float32Array(analyser.fftSize)
        analyser.getFloatTimeDomainData(buffer)
        let sumSquares = 0
        for (let i = 0; i < buffer.length; i += 1) sumSquares += buffer[i] * buffer[i]
        const rms = Math.sqrt(sumSquares / buffer.length)
        if (rms > peak) peak = rms
      }
      await sleep(20)
    }
    return { peak, analyserCount: analysers.length }
  })
}

async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

async function openMixer(page: Page) {
  const workspace = page.getByRole('region', { name: 'Mix workspace' })
  if (await workspace.isVisible().catch(() => false)) {
    return workspace.getByRole('region', { name: 'Mixer' })
  }
  const mixerToggle = page.getByRole('button', { name: /Mixer|Mix/ }).first()
  if ((await mixerToggle.getAttribute('aria-expanded')) !== 'true') {
    await mixerToggle.click()
  }
  await expect(mixerToggle).toHaveAttribute('aria-expanded', 'true')
  return page.getByRole('region', { name: 'Mixer' })
}

test.describe('composer parameter automation', () => {
  test('master-gain automation silences the output over the timeline', async ({ page }) => {
    await installOutputTap(page)
    await page.goto('/')
    await dismissTour(page)

    // The demo project seeds audible content at beat 0 (see audio.spec), so any
    // silence below is caused by the automation override, not an empty project.
    await expect(page.locator('.pr-note').first()).toBeVisible()

    await openMixWorkspace(page)

    // Draw a master-gain point near the bottom of the lane (≈ -60 dB). A single
    // point is held across the whole timeline, so the master bus stays down for
    // the entire playthrough.
    const laneGraph = page
      .getByRole('group', { name: 'Master gain automation' })
      .locator('.automation-lane__graph')
    await expect(laneGraph).toBeVisible()
    const box = await laneGraph.boundingBox()
    if (!box) throw new Error('automation lane graph has no layout box')
    await laneGraph.click({ position: { x: 3, y: box.height - 2 } })

    // The drawn point surfaces as an accessible remove button — proof it persisted
    // into the project model and rendered back onto the lane.
    await expect(
      page.getByRole('button', { name: /Remove Master gain point at beat/ }),
    ).toBeVisible()

    await page.locator('button.transport-play').click()

    const result = await measureSettledPeakRms(page)

    // The tap must have attached — proves we actually measured the output graph.
    expect(result.analyserCount).toBeGreaterThan(0)
    // With the master bus automated to ≈ -60 dB, the output stays below the floor
    // the #97 guard requires playback to clear. If automation failed to apply, the
    // audible demo project would push this over 0.01 and fail the build.
    expect(result.peak).toBeLessThan(0.01)
  })

  test('persisted manual master gain changes the audible output', async ({ page }) => {
    await installOutputTap(page)
    await page.goto('/')
    await dismissTour(page)
    await expect(page.locator('.pr-note').first()).toBeVisible()

    const mixer = await openMixer(page)
    await mixer
      .getByRole('group', { name: 'Master bus' })
      .getByRole('slider', { name: /Gain/ })
      .fill('-60')
    await page.locator('button.transport-play').click()

    const result = await measureSettledPeakRms(page)
    expect(result.analyserCount).toBeGreaterThan(0)
    expect(result.peak).toBeLessThan(0.01)
  })
})
