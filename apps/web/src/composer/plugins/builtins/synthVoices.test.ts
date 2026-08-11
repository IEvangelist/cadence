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
    DuoSynth: Voice,
    PluckSynth: Voice,
    MembraneSynth: Voice,
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
      // Ids persist inside saved projects, so every one must be kebab-case: a
      // rename or a stray capital/underscore would break project round-trip.
      expect(inst.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('ships a large, professional catalog spanning many instrument families', () => {
    // The expanded library is the whole point of this module — lock in both the
    // breadth (families) and the depth (a generous minimum preset count).
    expect(SYNTH_VOICE_INSTRUMENTS.length).toBeGreaterThanOrEqual(40)
    const groups = new Set(SYNTH_VOICE_INSTRUMENTS.map((i) => i.group))
    for (const family of [
      'Keys',
      'Guitars & Plucked',
      'Bass',
      'Strings',
      'Brass & Winds',
      'Leads',
      'Pads',
      'Mallets & Plucks',
      'Percussion',
    ]) {
      expect(groups.has(family)).toBe(true)
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
