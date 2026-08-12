import { describe, expect, it, vi } from 'vitest'
import type { InstrumentVoiceContext } from '../types'

/**
 * Spy state the mocked `tone` writes to. Every base built-in voice builds one or
 * more nodes exposing `triggerAttackRelease` + `dispose`; the mock tags each node
 * by kind and records its trigger args so we can assert the enhanced voices
 * construct, route by pitch, forward velocity, and tear down cleanly.
 */
const h = vi.hoisted(() => ({
  constructs: [] as string[],
  triggers: [] as Array<{ kind: string; args: unknown[] }>,
  disposes: 0,
}))

vi.mock('tone', () => {
  class Base {
    volume = { value: 0 }
    kind = 'base'
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: unknown[]) {}
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.triggers.push({ kind: this.kind, args })
    }
    dispose() {
      h.disposes += 1
    }
  }
  class PolySynth extends Base {
    kind = 'poly'
    constructor(...args: unknown[]) {
      super(...args)
      h.constructs.push('poly')
    }
  }
  class Synth extends Base {
    kind = 'synth'
  }
  class FMSynth extends Base {
    kind = 'fm'
  }
  class MembraneSynth extends Base {
    kind = 'membrane'
    constructor(...args: unknown[]) {
      super(...args)
      h.constructs.push('membrane')
    }
  }
  class NoiseSynth extends Base {
    kind = 'noise'
    constructor(...args: unknown[]) {
      super(...args)
      h.constructs.push('noise')
    }
  }
  class Gain extends Base {
    kind = 'gain'
  }
  return { PolySynth, Synth, FMSynth, MembraneSynth, NoiseSynth, Gain }
})

const { BUILTIN_INSTRUMENTS } = await import('./instruments')

function context(): InstrumentVoiceContext {
  return { output: {} as never, track: {} as never, tempo: 120 }
}

function reset(): void {
  h.constructs.length = 0
  h.triggers.length = 0
  h.disposes = 0
}

describe('BUILTIN_INSTRUMENTS', () => {
  it('contributes the three uniquely-identified, grouped base built-ins', () => {
    const ids = BUILTIN_INSTRUMENTS.map((i) => i.id)
    expect(ids).toEqual(['poly-synth', 'fm-synth', 'drum-kit'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const inst of BUILTIN_INSTRUMENTS) {
      expect(inst.group).toBeTruthy()
      expect(inst.description.length).toBeGreaterThan(0)
      expect(typeof inst.createVoice).toBe('function')
      // Ids persist inside saved projects, so every one must be kebab-case.
      expect(inst.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
  })

  it('builds, triggers velocity-sensitively, and disposes every base voice', () => {
    for (const inst of BUILTIN_INSTRUMENTS) {
      reset()
      const voice = inst.createVoice(context())
      voice.trigger(60, 0.5, 0, 0.42)
      expect(h.triggers.length).toBeGreaterThan(0)
      // The velocity supplied by the engine must reach the underlying node — this
      // is the #111/#112 velocity-sensitivity guarantee.
      const flat = h.triggers.flatMap((t) => t.args)
      expect(flat).toContain(0.42)

      const built = h.constructs.length
      voice.dispose()
      // Every node the voice constructed is disposed.
      expect(h.disposes).toBe(built)
    }
  })
})

describe('the enhanced poly and fm synth voices', () => {
  it('play a pitched note name and forward duration/time/velocity', () => {
    for (const id of ['poly-synth', 'fm-synth']) {
      reset()
      const inst = BUILTIN_INSTRUMENTS.find((i) => i.id === id)!
      inst.createVoice(context()).trigger(67, 0.25, 1.5, 0.9)
      expect(h.triggers).toHaveLength(1)
      const [note, duration, time, velocity] = h.triggers[0].args
      expect(typeof note).toBe('string')
      expect(duration).toBe(0.25)
      expect(time).toBe(1.5)
      expect(velocity).toBe(0.9)
    }
  })
})

describe('the enhanced drum kit', () => {
  const drumKit = () => BUILTIN_INSTRUMENTS.find((i) => i.id === 'drum-kit')!

  it('builds a dedicated voice per drum role (kick + five noise voices)', () => {
    reset()
    drumKit().createVoice(context())
    expect(h.constructs.filter((c) => c === 'membrane')).toHaveLength(1)
    expect(h.constructs.filter((c) => c === 'noise')).toHaveLength(5)
  })

  it('routes the kick to the membrane voice and everything else to noise voices', () => {
    const cases: Array<{ pitch: number; kind: string }> = [
      { pitch: 36, kind: 'membrane' }, // kick
      { pitch: 38, kind: 'noise' }, // snare
      { pitch: 39, kind: 'noise' }, // clap
      { pitch: 42, kind: 'noise' }, // closed hat
      { pitch: 46, kind: 'noise' }, // open hat
      { pitch: 49, kind: 'noise' }, // crash cymbal
    ]
    for (const { pitch, kind } of cases) {
      reset()
      drumKit().createVoice(context()).trigger(pitch, 0.5, 0, 0.7)
      expect(h.triggers).toHaveLength(1)
      expect(h.triggers[0].kind).toBe(kind)
      // Velocity is the last argument for both the membrane and noise voices.
      expect(h.triggers[0].args.at(-1)).toBe(0.7)
    }
  })

  it('disposes every drum voice exactly once', () => {
    reset()
    const voice = drumKit().createVoice(context())
    const built = h.constructs.length
    voice.dispose()
    expect(h.disposes).toBe(built)
  })
})
