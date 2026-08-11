import { describe, expect, it, vi } from 'vitest'
import type { InstrumentVoiceContext } from '../types'

/**
 * Shared spy state the mocked `tone` module writes to. Each kit builds one
 * `MembraneSynth` (kick) and two `NoiseSynth` voices (snare + hat); the mock
 * tags every trigger by voice so the test can prove all three drum-map branches
 * (kick ≤ 36, snare ≤ 40, hat otherwise) and disposal run for every kit.
 */
const h = vi.hoisted(() => ({
  triggers: [] as { kind: string; args: unknown[] }[],
  disposes: 0,
}))

vi.mock('tone', () => {
  class Membrane {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: unknown[]) {}
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.triggers.push({ kind: 'kick', args })
    }
    dispose() {
      h.disposes += 1
    }
  }
  class Noise {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: unknown[]) {}
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.triggers.push({ kind: 'noise', args })
    }
    dispose() {
      h.disposes += 1
    }
  }
  class Gain {
    connect() {
      return this
    }
    toDestination() {
      return this
    }
    dispose() {}
  }
  return { MembraneSynth: Membrane, NoiseSynth: Noise, Gain }
})

const { DRUM_KIT_INSTRUMENTS } = await import('./drumKits')

function context(): InstrumentVoiceContext {
  return { output: {} as never, track: {} as never, tempo: 120 }
}

describe('DRUM_KIT_INSTRUMENTS', () => {
  it('contributes uniquely-identified drum kits grouped under Drums', () => {
    const ids = DRUM_KIT_INSTRUMENTS.map((i) => i.id)
    expect(ids.length).toBeGreaterThanOrEqual(4)
    expect(new Set(ids).size).toBe(ids.length)
    for (const inst of DRUM_KIT_INSTRUMENTS) {
      expect(inst.kind).toBe('drum')
      expect(inst.group).toBe('Drums')
      expect(typeof inst.createVoice).toBe('function')
      expect(inst.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('routes kick, snare, and hat pitches and disposes every kit', () => {
    for (const inst of DRUM_KIT_INSTRUMENTS) {
      h.triggers.length = 0
      const before = h.disposes

      const voice = inst.createVoice(context())
      voice.trigger(36, 0.5, 0, 0.9) // kick
      voice.trigger(38, 0.5, 0, 0.8) // snare
      voice.trigger(44, 0.5, 0, 0.7) // hat

      const kinds = h.triggers.map((t) => t.kind)
      expect(kinds).toEqual(['kick', 'noise', 'noise'])

      // The kick is tuned to a note name; the snare/hat fire on duration.
      expect(typeof h.triggers[0].args[0]).toBe('string')
      // Hats are clamped short regardless of the written note length.
      expect(h.triggers[2].args[0]).toBe(0.05)

      voice.dispose()
      // Each kit builds three voices, so dispose tears down three nodes.
      expect(h.disposes).toBe(before + 3)
    }
  })
})
