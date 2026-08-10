import { describe, expect, it, vi } from 'vitest'
import type { InstrumentVoiceContext } from '../types'

/**
 * Shared spy state the mocked `tone` module writes to. Every melodic voice in
 * this module builds a synth (directly or wrapped in a PolySynth) that exposes
 * `triggerAttackRelease` + `dispose`; the mock records both so the test can
 * assert every factory constructs, triggers, and tears down a voice.
 */
const h = vi.hoisted(() => ({
  triggers: [] as unknown[][],
  disposes: 0,
}))

vi.mock('tone', () => {
  class Voice {
    volume = { value: 0 }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: unknown[]) {}
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.triggers.push(args)
    }
    dispose() {
      h.disposes += 1
    }
  }
  // Every synth the module can construct shares the same minimal surface.
  return {
    Gain: Voice,
    PolySynth: Voice,
    Synth: Voice,
    FMSynth: Voice,
    AMSynth: Voice,
    MonoSynth: Voice,
  }
})

const { SYNTH_VOICE_INSTRUMENTS } = await import('./synthVoices')

function context(): InstrumentVoiceContext {
  return { output: {} as never, track: {} as never, tempo: 120 }
}

describe('SYNTH_VOICE_INSTRUMENTS', () => {
  it('contributes a catalog of uniquely-identified, grouped synth instruments', () => {
    const ids = SYNTH_VOICE_INSTRUMENTS.map((i) => i.id)
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
    for (const inst of SYNTH_VOICE_INSTRUMENTS) {
      expect(inst.kind).toBe('synth')
      expect(inst.group).toBeTruthy()
      expect(inst.description.length).toBeGreaterThan(0)
      expect(typeof inst.createVoice).toBe('function')
    }
  })

  it('builds, triggers, and disposes a working voice for every instrument', () => {
    for (const inst of SYNTH_VOICE_INSTRUMENTS) {
      h.triggers.length = 0
      const before = h.disposes

      const voice = inst.createVoice(context())
      voice.trigger(60, 0.5, 0, 0.8)

      // The voice forwarded the note to the synth as (noteName, dur, time, vel).
      expect(h.triggers.length).toBeGreaterThan(0)
      const [note, duration, time, velocity] = h.triggers[0]
      expect(typeof note).toBe('string')
      expect(duration).toBe(0.5)
      expect(time).toBe(0)
      expect(velocity).toBe(0.8)

      voice.dispose()
      expect(h.disposes).toBe(before + 1)
    }
  })
})
