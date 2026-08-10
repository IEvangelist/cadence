/**
 * Expanded percussion library — additional drum kits.
 *
 * Each kit is an {@link InstrumentContribution} of kind `drum`, so it reads the
 * same drum-map pitches the base kit does (kick ≤ 36, snare/clap in the 37–40
 * range, hats above). Kits are built from Tone's `MembraneSynth` (kick) and
 * `NoiseSynth` voices (snare/hat), tuned per kit for a distinct character — no
 * external samples, so the module stays offline- and bundle-safe.
 *
 * As with the melodic voices, no audio node is constructed until a factory runs,
 * keeping module import side-effect free.
 */
import * as Tone from 'tone'
import type {
  InstrumentContribution,
  InstrumentVoice,
  InstrumentVoiceContext,
} from '../types'

/** Tunable knobs that give each kit its character. */
interface DrumKitOptions {
  /** Kick drum pitch envelope decay — longer = boomier. */
  pitchDecay: number
  /** Kick pitch sweep range in octaves. */
  octaves: number
  /** Root note the kick is tuned to. */
  kickNote: string
  /** Noise colour used for the snare body. */
  snareNoise: 'white' | 'pink' | 'brown'
  /** Snare amplitude decay in seconds. */
  snareDecay: number
  /** Hi-hat amplitude decay in seconds. */
  hatDecay: number
}

function createKitVoice(
  ctx: InstrumentVoiceContext,
  opts: DrumKitOptions,
): InstrumentVoice {
  const kick = new Tone.MembraneSynth({
    pitchDecay: opts.pitchDecay,
    octaves: opts.octaves,
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.2 },
  }).connect(ctx.output)
  const snare = new Tone.NoiseSynth({
    noise: { type: opts.snareNoise },
    envelope: { attack: 0.001, decay: opts.snareDecay, sustain: 0 },
  }).connect(ctx.output)
  const hat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: opts.hatDecay, sustain: 0 },
  }).connect(ctx.output)

  return {
    trigger: (pitch, duration, time, velocity) => {
      if (pitch <= 36) {
        kick.triggerAttackRelease(opts.kickNote, duration, time, velocity)
      } else if (pitch <= 40) {
        snare.triggerAttackRelease(duration, time, velocity)
      } else {
        // Hats are short regardless of the written note length.
        hat.triggerAttackRelease(Math.min(duration, 0.05), time, velocity)
      }
    },
    dispose: () => {
      kick.dispose()
      snare.dispose()
      hat.dispose()
    },
  }
}

/** Additional drum kits contributed by the core plugin, in menu order. */
export const DRUM_KIT_INSTRUMENTS: InstrumentContribution[] = [
  {
    id: 'drum-kit-808',
    name: '808 Kit',
    kind: 'drum',
    description: 'A booming 808-style kit: long sub kick, snappy claps, tight hats.',
    polyphonic: true,
    group: 'Drums',
    createVoice: (ctx) =>
      createKitVoice(ctx, {
        pitchDecay: 0.08,
        octaves: 6,
        kickNote: 'C1',
        snareNoise: 'white',
        snareDecay: 0.2,
        hatDecay: 0.04,
      }),
  },
  {
    id: 'drum-kit-acoustic',
    name: 'Acoustic Kit',
    kind: 'drum',
    description: 'A natural acoustic kit: punchy kick, warm snare, softer hats.',
    polyphonic: true,
    group: 'Drums',
    createVoice: (ctx) =>
      createKitVoice(ctx, {
        pitchDecay: 0.03,
        octaves: 4,
        kickNote: 'C2',
        snareNoise: 'pink',
        snareDecay: 0.18,
        hatDecay: 0.06,
      }),
  },
]
