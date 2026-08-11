import { test, expect, type Page } from '@playwright/test'

// Real-audio regression guard for #97 ("web composer plays no audio"). Mocked unit
// tests can't catch a silent Web Audio graph, so this spec taps the *real* output:
// we wrap `AudioNode.connect` so any node that reaches the native destination is
// also fanned out to an `AnalyserNode` on the same context. That tap is additive —
// it never changes what plays — but it lets us read the actual output signal and
// assert its RMS clears the noise floor during playback. A disposed/silent graph
// stays at ~0 and fails the build, so "no music plays" can never regress green.

// Autoplay must not require a gesture (belt-and-suspenders with the Play click),
// and `--mute-audio` keeps CI machines quiet while the analyser still sees signal
// (muting happens at the output device, downstream of the graph we measure).
test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  },
})

// Install the output tap before any app/Tone.js code runs so the very first
// `master.toDestination()` connection is captured.
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
          // If a particular tap can't attach, other destination connections
          // still get analysers — the measurement below simply uses those.
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

// Roll the transport and return the peak output RMS seen over ~3s. Real audio
// clears the threshold within the first beats; a silent graph never does.
async function measurePeakRms(page: Page): Promise<{ peak: number; analyserCount: number }> {
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

async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

test.describe('composer audio output', () => {
  test('playback emits audible signal (output RMS > 0)', async ({ page }) => {
    await installOutputTap(page)
    await page.goto('/')

    // Interaction suites run as a returning user (onboarding pre-dismissed), but
    // dismiss the tour defensively so its backdrop can never intercept the click.
    await dismissTour(page)

    // The app boots with the demo project (a chord + kick starting at beat 0), so
    // there is audible content the moment the transport rolls.
    await expect(page.locator('.pr-note').first()).toBeVisible()

    await page.locator('button.transport-play').click()

    const result = await measurePeakRms(page)

    // The tap must have attached — proves we actually measured the output graph.
    expect(result.analyserCount).toBeGreaterThan(0)
    // Real playback must clear the noise floor; a disposed/silent graph stays ~0.
    expect(result.peak).toBeGreaterThan(0.01)
  })

  // #112: pro editing added a velocity lane whose bars edit `note.velocity`. That
  // value must keep flowing through the UNCHANGED engine seam
  // (`voice.trigger(pitch, dur, time, velocity)`), so a velocity edit must never
  // silence the graph. Raise a note to full velocity from the lane, then prove
  // playback still clears the noise floor — the velocity path stays audible.
  test('velocity edits keep the audio path audible (RMS > 0)', async ({ page }) => {
    await installOutputTap(page)
    await page.goto('/')
    await dismissTour(page)

    // The demo project seeds notes, so the velocity lane renders a bar per note.
    const bar = page.locator('.pr-vel-bar').first()
    await expect(bar).toBeVisible()

    // Drive the velocity up via the keyboard-accessible bar (ArrowUp = +vel).
    await bar.focus()
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('ArrowUp')

    await page.locator('button.transport-play').click()

    const result = await measurePeakRms(page)
    expect(result.analyserCount).toBeGreaterThan(0)
    expect(result.peak).toBeGreaterThan(0.01)
  })
})
