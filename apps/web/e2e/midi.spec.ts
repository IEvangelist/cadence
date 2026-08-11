import { test, expect, type Page } from '@playwright/test'

// Live-MIDI e2e (#111). Web MIDI needs a real device, so we inject a mock
// `navigator.requestMIDIAccess` before any app code runs: it hands back one input
// port whose `onmidimessage` the composer subscribes to. The test then dispatches
// synthetic MIDI bytes and asserts the two falsifiable behaviors — an incoming
// note previews audibly through the EXISTING preview seam, and an armed take
// records notes into the active track — plus the velocity-0-as-note-off guard.

test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  },
})

// Expose a single mock input on `window.__cadenceMidiInput`; the composer sets its
// `onmidimessage`, which we invoke to simulate hardware.
async function installMockMidi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const input = { id: 'mock-in', name: 'Mock Controller', onmidimessage: null }
    ;(window as unknown as { __cadenceMidiInput?: unknown }).__cadenceMidiInput = input
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map(),
      onstatechange: null,
      sysexEnabled: false,
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(access),
    })
  })
}

// Same output tap as audio.spec: fan every destination-bound node into an analyser
// so we can read the REAL output signal without changing what plays.
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
        nativeConnect as unknown as (this: AudioNode, ...args: unknown[]) => AudioNode
      ).call(this, target, ...rest)
    } as typeof AudioNode.prototype.connect
  })
}

async function dismissTour(page: Page): Promise<void> {
  const tour = page.getByTestId('onboarding-tour-root')
  if (await tour.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Dismiss onboarding tour' }).click()
    await expect(tour).toBeHidden()
  }
}

// Resolve once the composer has subscribed to the mock input.
async function waitForMidiSubscription(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __cadenceMidiInput?: { onmidimessage?: unknown } }
    return typeof w.__cadenceMidiInput?.onmidimessage === 'function'
  })
}

async function sendMidi(page: Page, bytes: number[]): Promise<void> {
  await page.evaluate((message) => {
    const w = window as unknown as {
      __cadenceMidiInput?: { onmidimessage?: ((event: { data: Uint8Array }) => void) | null }
    }
    w.__cadenceMidiInput?.onmidimessage?.({ data: new Uint8Array(message) })
  }, bytes)
}

test.describe('composer live MIDI input (#111)', () => {
  test('an incoming MIDI note previews audibly through the existing seam', async ({ page }) => {
    await installMockMidi(page)
    await installOutputTap(page)
    await page.goto('/')
    await dismissTour(page)
    await waitForMidiSubscription(page)

    // Re-trigger note-ons while sampling so the (short) monitor blips always fall
    // inside the measurement window; a silent preview path never clears the floor.
    const peak = await page.evaluate(async () => {
      const w = window as unknown as {
        __cadenceMidiInput?: { onmidimessage?: ((event: { data: Uint8Array }) => void) | null }
        __cadenceAnalysers?: AnalyserNode[]
      }
      const analysers = w.__cadenceAnalysers ?? []
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      let max = 0
      for (let frame = 0; frame < 150; frame += 1) {
        if (frame % 5 === 0) {
          w.__cadenceMidiInput?.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) })
        }
        for (const analyser of analysers) {
          const buffer = new Float32Array(analyser.fftSize)
          analyser.getFloatTimeDomainData(buffer)
          let sumSquares = 0
          for (let i = 0; i < buffer.length; i += 1) sumSquares += buffer[i] * buffer[i]
          const rms = Math.sqrt(sumSquares / buffer.length)
          if (rms > max) max = rms
        }
        if (max > 0.01) break
        await sleep(20)
      }
      return max
    })

    expect(peak).toBeGreaterThan(0.01)
  })

  test('arming record captures played notes into the active track', async ({ page }) => {
    await installMockMidi(page)
    await page.goto('/')
    await dismissTour(page)
    await waitForMidiSubscription(page)

    // Start from an empty project so the recorded note is the only one on the roll.
    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.locator('.pr-note')).toHaveCount(0)

    await page.locator('button.transport-play').click()
    await page.waitForTimeout(200) // let the transport roll before arming/playing
    await page.getByRole('button', { name: 'Record' }).click()

    await sendMidi(page, [0x90, 60, 100]) // note-on C4
    await page.waitForTimeout(120)
    await sendMidi(page, [0x80, 60, 0]) // note-off C4

    await expect(page.locator('.pr-note')).toHaveCount(1)
  })

  test('a velocity-0 note-on is a note-off and records nothing', async ({ page }) => {
    await installMockMidi(page)
    await page.goto('/')
    await dismissTour(page)
    await waitForMidiSubscription(page)

    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.locator('.pr-note')).toHaveCount(0)

    await page.locator('button.transport-play').click()
    await page.waitForTimeout(200) // let the transport roll before arming/playing
    await page.getByRole('button', { name: 'Record' }).click()

    // Velocity-0 note-on is the note-off convention: it must not open a capture,
    // so nothing is recorded (and no silent zero-velocity note is ever inserted).
    await sendMidi(page, [0x90, 64, 0])
    await page.waitForTimeout(120)
    await sendMidi(page, [0x80, 64, 0])

    await expect(page.locator('.pr-note')).toHaveCount(0)
  })
})
