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
  // The oscillator/envelope recipes give each default voice a musical ADSR and
  // (for the subtractive synth) a subtle detuned stack, so the two flagship
  // built-ins sound warm and dynamic rather than like raw, static waveforms.
  const synth = fm
    ? new Tone.PolySynth(Tone.FMSynth, {
        // A brighter carrier:modulator ratio with its own modulation envelope
        // gives a plucky, bell-like attack that opens up with velocity, then
        // settles into a sustaining body — far livelier than the bare default.
        harmonicity: 2.02,
        modulationIndex: 9,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.004, decay: 0.28, sustain: 0.55, release: 0.7 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.006, decay: 0.22, sustain: 0.12, release: 0.4 },
      }).connect(ctx.output)
    : new Tone.PolySynth(Tone.Synth, {
        // Three slightly-detuned triangles read as a warm, chorused analog stack;
        // the gentle attack and long release round off the transients so chords
        // and pads breathe instead of clicking on and off.
        oscillator: { type: 'fattriangle', count: 3, spread: 18 },
        envelope: { attack: 0.012, decay: 0.22, sustain: 0.65, release: 0.9 },
      }).connect(ctx.output)
  synth.volume.value = fm ? -9 : -8
  return {
    trigger: (pitch, duration, time, velocity) => {
      synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity)
    },
    dispose: () => synth.dispose(),
  }
}

/**
 * Build the default drum kit.
 *
 * The MVP kit routed every non-kick pitch through a single white-noise voice, so
 * the snare, claps, hats, and cymbals were indistinguishable. This kit instead
 * reads the General-MIDI drum map (see `instruments/registry.ts`) and gives each
 * role its own tuned voice: a pitched {@link Tone.MembraneSynth} kick plus a
 * family of {@link Tone.NoiseSynth} voices whose noise colour and decay separate
 * the crisp snare, the tight clap, the short closed hat, the looser open hat, and
 * the long, washy crash/ride. Every voice forwards `velocity`, so hard and soft
 * hits stay expressive. No samples are used, so the module stays offline- and
 * bundle-safe.
 */
function createDrumVoice(ctx: InstrumentVoiceContext): InstrumentVoice {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.045,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.42, sustain: 0.01, release: 1.2 },
  }).connect(ctx.output)
  const snare = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0 },
  }).connect(ctx.output)
  const clap = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.12, sustain: 0 },
  }).connect(ctx.output)
  const closedHat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.03, sustain: 0 },
  }).connect(ctx.output)
  const openHat = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.3, sustain: 0 },
  }).connect(ctx.output)
  const cymbal = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.9, sustain: 0 },
  }).connect(ctx.output)

  return {
    trigger: (pitch, duration, time, velocity) => {
      if (pitch <= 36) {
        // Kick (GM 35/36): repitch the membrane so its tuned thump tracks the note.
        kick.triggerAttackRelease(pitchToName(Math.min(pitch, 36)), duration, time, velocity)
      } else if (pitch <= 38) {
        snare.triggerAttackRelease(duration, time, velocity)
      } else if (pitch <= 40) {
        clap.triggerAttackRelease(duration, time, velocity)
      } else if (pitch <= 42) {
        closedHat.triggerAttackRelease(duration, time, velocity)
      } else if (pitch <= 46) {
        openHat.triggerAttackRelease(duration, time, velocity)
      } else {
        // Crash (49), ride (51), and other cymbals — a long, washy noise tail.
        cymbal.triggerAttackRelease(duration, time, velocity)
      }
    },
    dispose: () => {
      kick.dispose()
      snare.dispose()
      clap.dispose()
      closedHat.dispose()
      openHat.dispose()
      cymbal.dispose()
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
