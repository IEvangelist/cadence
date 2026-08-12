import { describe, expect, it, vi } from 'vitest'
import type { InstrumentVoiceContext } from '../types'
import type { SampledInstrument } from './samplePacks/renderSample'

// Mock the lazily-imported pack module so the contributions' `createVoice` never
// pulls Tone/Web Audio into the jsdom run — the pack build is browser-only and is
// exercised there. Each loader returns a recordable stand-in instrument.
const g = vi.hoisted(() => ({
  grand: { triggers: [] as unknown[][], disposed: 0 },
  electric: { triggers: [] as unknown[][], disposed: 0 },
}))

vi.mock('./samplePacks/pianoPacks', () => ({
  loadGrandPiano: () => ({
    trigger: (...args: unknown[]) => g.grand.triggers.push(args),
    dispose: () => {
      g.grand.disposed += 1
    },
  }),
  loadElectricPiano: () => ({
    trigger: (...args: unknown[]) => g.electric.triggers.push(args),
    dispose: () => {
      g.electric.disposed += 1
    },
  }),
}))

const { SAMPLER_VOICE_INSTRUMENTS, createSamplerVoice } = await import('./samplerVoices')

function context(): InstrumentVoiceContext {
  return { output: {} as never, track: {} as never, tempo: 120 }
}

/** A recordable {@link SampledInstrument} plus a controllable load promise. */
function harness() {
  const triggers: unknown[][] = []
  const state = { triggers, disposed: 0 }
  const instrument: SampledInstrument = {
    trigger: (...args) => {
      triggers.push(args)
    },
    dispose: () => {
      state.disposed += 1
    },
  }
  let resolve!: (value: SampledInstrument) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<SampledInstrument>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { state, instrument, load: () => promise, resolve, reject }
}

/** Flush pending microtasks and one macrotask so chained thens/awaits settle. */
async function tick(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (condition()) return
    await tick()
  }
  throw new Error('condition never became true')
}

describe('createSamplerVoice', () => {
  it('buffers triggers that arrive before the pack loads and flushes them in order', async () => {
    const bed = harness()
    const voice = createSamplerVoice(context(), bed.load)
    voice.trigger(60, 0.5, 0, 0.8)
    voice.trigger(62, 0.25, 1, 0.6)
    // Nothing plays until the pack resolves.
    expect(bed.state.triggers).toHaveLength(0)

    bed.resolve(bed.instrument)
    await until(() => bed.state.triggers.length === 2)

    expect(bed.state.triggers).toEqual([
      [60, 0.5, 0, 0.8],
      [62, 0.25, 1, 0.6],
    ])
  })

  it('forwards triggers directly once the pack has loaded, keeping velocity', async () => {
    const bed = harness()
    const voice = createSamplerVoice(context(), bed.load)
    bed.resolve(bed.instrument)
    await tick()

    voice.trigger(64, 1, 2, 0.33)
    expect(bed.state.triggers).toEqual([[64, 1, 2, 0.33]])
  })

  it('discards a load that resolves after the voice was disposed', async () => {
    const bed = harness()
    const voice = createSamplerVoice(context(), bed.load)
    voice.trigger(60, 0.5, 0, 0.8)
    voice.dispose()

    bed.resolve(bed.instrument)
    await tick()

    // The late-arriving instrument is disposed and its buffered note never plays.
    expect(bed.state.disposed).toBe(1)
    expect(bed.state.triggers).toHaveLength(0)
  })

  it('ignores triggers received after dispose but before load', async () => {
    const bed = harness()
    const voice = createSamplerVoice(context(), bed.load)
    voice.dispose()
    voice.trigger(60, 0.5, 0, 0.8)

    bed.resolve(bed.instrument)
    await tick()
    expect(bed.state.triggers).toHaveLength(0)
  })

  it('disposes the instrument when disposed after load', async () => {
    const bed = harness()
    const voice = createSamplerVoice(context(), bed.load)
    bed.resolve(bed.instrument)
    await tick()

    voice.dispose()
    expect(bed.state.disposed).toBe(1)
  })

  it('stays valid and silent when the pack fails to load', async () => {
    const voice = createSamplerVoice(context(), () => Promise.reject(new Error('no audio')))
    voice.trigger(60, 0.5, 0, 0.8)
    await tick()
    expect(() => voice.dispose()).not.toThrow()
  })
})

describe('SAMPLER_VOICE_INSTRUMENTS', () => {
  it('contributes the two flagship sampled keys with valid metadata', () => {
    expect(SAMPLER_VOICE_INSTRUMENTS.map((i) => i.id)).toEqual([
      'sampled-grand-piano',
      'sampled-electric-piano',
    ])
    for (const inst of SAMPLER_VOICE_INSTRUMENTS) {
      expect(inst.kind).toBe('synth')
      expect(inst.group).toBe('Keys')
      expect(inst.polyphonic).toBe(true)
      expect(inst.description.length).toBeGreaterThan(0)
      expect(inst.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(typeof inst.createVoice).toBe('function')
    }
  })

  it('lazy-loads the grand piano pack and plays through it velocity-sensitively', async () => {
    const inst = SAMPLER_VOICE_INSTRUMENTS.find((i) => i.id === 'sampled-grand-piano')!
    const voice = inst.createVoice(context())
    voice.trigger(60, 0.5, 0, 0.9)
    await until(() => g.grand.triggers.length === 1)
    expect(g.grand.triggers[0]).toEqual([60, 0.5, 0, 0.9])
    voice.dispose()
    await until(() => g.grand.disposed === 1)
  })

  it('lazy-loads the electric piano pack on demand', async () => {
    const inst = SAMPLER_VOICE_INSTRUMENTS.find((i) => i.id === 'sampled-electric-piano')!
    const voice = inst.createVoice(context())
    voice.trigger(72, 0.25, 0, 0.5)
    await until(() => g.electric.triggers.length === 1)
    expect(g.electric.triggers[0]).toEqual([72, 0.25, 0, 0.5])
  })
})
