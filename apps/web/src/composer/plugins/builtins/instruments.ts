/**
 * Built-in instruments, expressed as Plugin SDK contributions.
 *
 * These voice factories were previously hard-coded inside `audio/engine.ts`.
 * Moving them here — behind the same {@link InstrumentContribution} contract a
 * third-party plugin uses — proves the seam is real: the engine now resolves
 * *every* voice (built-in or plugin) through the host, with no special-casing.
 *
 * `tone` is imported at module scope but no node is constructed until a factory
 * runs, so importing this module in a non-audio context (or a test that never
 * builds a voice) stays side-effect free.
 */
import * as Tone from 'tone'
import { pitchToName } from '../../model/project'
import type {
  InstrumentContribution,
  InstrumentVoice,
  InstrumentVoiceContext,
} from '../types'

function createSynthVoice(ctx: InstrumentVoiceContext, fm: boolean): InstrumentVoice {
  // Each branch constructs a concrete voice so Tone can infer the correct
  // PolySynth type (FMSynth is not a Synth subclass, so a union would not type).
  const synth = fm
    ? new Tone.PolySynth(Tone.FMSynth).connect(ctx.output)
    : new Tone.PolySynth(Tone.Synth).connect(ctx.output)
  synth.volume.value = -8
  return {
    trigger: (pitch, duration, time, velocity) => {
      synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity)
    },
    dispose: () => synth.dispose(),
  }
}

function createDrumVoice(ctx: InstrumentVoiceContext): InstrumentVoice {
  const kick = new Tone.MembraneSynth().connect(ctx.output)
  const noise = new Tone.NoiseSynth().connect(ctx.output)
  return {
    trigger: (pitch, duration, time, velocity) => {
      if (pitch <= 36) {
        kick.triggerAttackRelease('C1', duration, time, velocity)
      } else {
        // snares, claps, and hats all use the noise voice in the MVP kit.
        noise.triggerAttackRelease(duration, time, velocity)
      }
    },
    dispose: () => {
      kick.dispose()
      noise.dispose()
    },
  }
}

/** The three built-in instruments, in menu order. */
export const BUILTIN_INSTRUMENTS: InstrumentContribution[] = [
  {
    id: 'poly-synth',
    name: 'Poly Synth',
    kind: 'synth',
    description: 'A warm polyphonic subtractive synth — chords and pads.',
    polyphonic: true,
    group: 'Synths',
    createVoice: (ctx) => createSynthVoice(ctx, false),
  },
  {
    id: 'fm-synth',
    name: 'FM Synth',
    kind: 'synth',
    description: 'A bright FM voice for leads, bells, and plucks.',
    polyphonic: true,
    group: 'Synths',
    createVoice: (ctx) => createSynthVoice(ctx, true),
  },
  {
    id: 'drum-kit',
    name: 'Drum Kit',
    kind: 'drum',
    description: 'A basic sampler-style kit: kick, snare, and hats.',
    polyphonic: true,
    group: 'Drums',
    createVoice: (ctx) => createDrumVoice(ctx),
  },
]
