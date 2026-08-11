/**
 * Expanded melodic instrument library — additional synth engines and presets.
 *
 * Each entry is a plain {@link InstrumentContribution}: descriptive metadata plus
 * a `createVoice` factory that builds a Tone.js voice. They are contributed by
 * the core plugin (see `builtins/index.ts`) through the exact same Plugin SDK
 * seam a third-party plugin would use, so they flow automatically into the
 * instrument registry, the picker, and the audio engine with no special-casing.
 *
 * Like the base built-ins, `tone` is imported at module scope but no audio node
 * is constructed until a factory runs, so importing this module in a non-audio
 * context (SSR, a metadata-only test) stays completely side-effect free.
 */
import * as Tone from 'tone'
import { pitchToName } from '../../model/project'
import type {
  InstrumentContribution,
  InstrumentVoice,
  InstrumentVoiceContext,
} from '../types'

/**
 * The minimal surface every melodic Tone voice exposes. Constructing the
 * concrete synth in each factory lets Tone infer the right type; this structural
 * type is only used to share the trigger/dispose plumbing below.
 */
interface MelodicSynth {
  triggerAttackRelease(
    note: string,
    duration: number,
    time: number,
    velocity: number,
  ): unknown
  dispose(): void
}

/** Wrap a constructed synth in the {@link InstrumentVoice} contract. */
function melodicVoice(synth: MelodicSynth): InstrumentVoice {
  return {
    trigger: (pitch, duration, time, velocity) => {
      synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity)
    },
    dispose: () => synth.dispose(),
  }
}

/**
 * Set an already-connected synth's output level (in dB) and wrap it as a voice.
 * Lets the newer library entries build a voice inline while keeping the exact
 * same connect → level → wrap plumbing the hand-written factories above use.
 */
function tuned(
  synth: MelodicSynth & { volume: { value: number } },
  volume: number,
): InstrumentVoice {
  synth.volume.value = volume
  return melodicVoice(synth)
}

/** Karplus-Strong knobs shared by the plucked-string voices below. */
interface PluckOptions {
  /** Noise burst at the pick attack (nominal 0.1–20 — higher is scratchier). */
  attackNoise: number
  /** Comb-filter cutoff in Hz — lower dampening reads as a softer, rounder string. */
  dampening: number
  /** Sustain/decay of the pluck, 0–1 — higher rings longer. */
  resonance: number
  /** Time in seconds the resonance ramps back to silence. */
  release: number
}

/**
 * Build a monophonic {@link Tone.PluckSynth} voice — a physical-modeled plucked
 * string (nylon/steel/electric guitars, harp, koto, banjo, upright bass). It is
 * inherently single-voiced, so these instruments are declared `polyphonic: false`.
 */
function pluck(
  ctx: InstrumentVoiceContext,
  options: PluckOptions,
  volume: number,
): InstrumentVoice {
  return tuned(new Tone.PluckSynth(options).connect(ctx.output), volume)
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function createElectricPiano(ctx: InstrumentVoiceContext): InstrumentVoice {
  // Classic FM electric-piano recipe: a low modulation index with a quick,
  // bell-like decay gives the tine "clunk" without a real sample.
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 12,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.4, sustain: 0.35, release: 1.4 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.002, decay: 0.18, sustain: 0, release: 0.2 },
  }).connect(ctx.output)
  synth.volume.value = -10
  return melodicVoice(synth)
}

function createTonewheelOrgan(ctx: InstrumentVoiceContext): InstrumentVoice {
  // A slightly detuned square stack approximates drawbar organ harmonics; the
  // near-instant attack/release gives the characteristic keyed-on/off response.
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsquare', count: 3, spread: 12 },
    envelope: { attack: 0.01, decay: 0.05, sustain: 1, release: 0.08 },
  }).connect(ctx.output)
  synth.volume.value = -14
  return melodicVoice(synth)
}

// ---------------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------------

function createWarmPad(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.6, decay: 0.3, sustain: 0.9, release: 1.8 },
  }).connect(ctx.output)
  synth.volume.value = -12
  return melodicVoice(synth)
}

function createStringEnsemble(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 25 },
    envelope: { attack: 0.35, decay: 0.2, sustain: 0.8, release: 1.2 },
  }).connect(ctx.output)
  synth.volume.value = -14
  return melodicVoice(synth)
}

function createGlassPad(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.AMSynth, {
    harmonicity: 2,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.8, decay: 0.4, sustain: 0.7, release: 2 },
    modulation: { type: 'square' },
  }).connect(ctx.output)
  synth.volume.value = -12
  return melodicVoice(synth)
}

// ---------------------------------------------------------------------------
// Bass
// ---------------------------------------------------------------------------

function createSubBass(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.4 },
    filter: { type: 'lowpass', Q: 1, rolloff: -24 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.4, baseFrequency: 80, octaves: 2 },
  }).connect(ctx.output)
  synth.volume.value = -6
  return melodicVoice(synth)
}

function createAcidBass(ctx: InstrumentVoiceContext): InstrumentVoice {
  // Resonant, sweeping low-pass over a sawtooth — the classic squelchy 303 bass.
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.3 },
    filter: { type: 'lowpass', Q: 6, rolloff: -24 },
    filterEnvelope: { attack: 0.01, decay: 0.25, sustain: 0.2, release: 0.3, baseFrequency: 120, octaves: 4 },
  }).connect(ctx.output)
  synth.volume.value = -8
  return melodicVoice(synth)
}

function createFmBass(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.FMSynth({
    harmonicity: 1,
    modulationIndex: 6,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.5, release: 0.3 },
    modulation: { type: 'square' },
    modulationEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.1, release: 0.2 },
  }).connect(ctx.output)
  synth.volume.value = -8
  return melodicVoice(synth)
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

function createSawLead(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.02, decay: 0.1, sustain: 0.7, release: 0.3 },
    filter: { type: 'lowpass', Q: 2, rolloff: -12 },
    filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.3, baseFrequency: 400, octaves: 3 },
  }).connect(ctx.output)
  synth.volume.value = -12
  return melodicVoice(synth)
}

function createSquareLead(ctx: InstrumentVoiceContext): InstrumentVoice {
  // A pulse lead with a touch of vibrato-friendly sustain — chiptune-ish.
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.01, decay: 0.1, sustain: 0.6, release: 0.2 },
    filter: { type: 'lowpass', Q: 1, rolloff: -12 },
    filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.2, baseFrequency: 600, octaves: 2 },
  }).connect(ctx.output)
  synth.volume.value = -14
  return melodicVoice(synth)
}

function createSupersawLead(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 5, spread: 40 },
    envelope: { attack: 0.02, decay: 0.15, sustain: 0.8, release: 0.4 },
  }).connect(ctx.output)
  synth.volume.value = -16
  return melodicVoice(synth)
}

// ---------------------------------------------------------------------------
// Mallets & Plucks
// ---------------------------------------------------------------------------

function createMarimba(ctx: InstrumentVoiceContext): InstrumentVoice {
  // A short, sine-y percussive envelope reads as a struck wooden bar.
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.3 },
  }).connect(ctx.output)
  synth.volume.value = -8
  return melodicVoice(synth)
}

function createMusicBox(ctx: InstrumentVoiceContext): InstrumentVoice {
  // High harmonicity + fast decay = the glassy, bell-like music-box tine.
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 8,
    modulationIndex: 2,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: 0.7, sustain: 0, release: 0.6 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
  }).connect(ctx.output)
  synth.volume.value = -10
  return melodicVoice(synth)
}

function createSynthPluck(ctx: InstrumentVoiceContext): InstrumentVoice {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3,
    modulationIndex: 8,
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.2 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
  }).connect(ctx.output)
  synth.volume.value = -10
  return melodicVoice(synth)
}

/**
 * Additional melodic instruments contributed by the core plugin, in menu order.
 * Grouped by `group` so the picker can present them as a categorized browser.
 */
export const SYNTH_VOICE_INSTRUMENTS: InstrumentContribution[] = [
  {
    id: 'electric-piano',
    name: 'Electric Piano',
    kind: 'synth',
    description: 'An FM tine electric piano — bell-like attack, mellow body.',
    polyphonic: true,
    group: 'Keys',
    createVoice: createElectricPiano,
  },
  {
    id: 'tonewheel-organ',
    name: 'Tonewheel Organ',
    kind: 'synth',
    description: 'A drawbar-style organ with keyed-on/off response.',
    polyphonic: true,
    group: 'Keys',
    createVoice: createTonewheelOrgan,
  },
  {
    id: 'warm-pad',
    name: 'Warm Pad',
    kind: 'synth',
    description: 'A soft triangle pad with a slow swell — lush backgrounds.',
    polyphonic: true,
    group: 'Pads',
    createVoice: createWarmPad,
  },
  {
    id: 'string-ensemble',
    name: 'String Ensemble',
    kind: 'synth',
    description: 'A detuned sawtooth string section for sustained chords.',
    polyphonic: true,
    group: 'Pads',
    createVoice: createStringEnsemble,
  },
  {
    id: 'glass-pad',
    name: 'Glass Pad',
    kind: 'synth',
    description: 'An airy AM pad with a shimmering, glassy top.',
    polyphonic: true,
    group: 'Pads',
    createVoice: createGlassPad,
  },
  {
    id: 'sub-bass',
    name: 'Sub Bass',
    kind: 'synth',
    description: 'A deep sine sub for the low end — round and clean.',
    polyphonic: false,
    group: 'Bass',
    createVoice: createSubBass,
  },
  {
    id: 'acid-bass',
    name: 'Acid Bass',
    kind: 'synth',
    description: 'A resonant, squelchy 303-style saw bass.',
    polyphonic: false,
    group: 'Bass',
    createVoice: createAcidBass,
  },
  {
    id: 'fm-bass',
    name: 'FM Bass',
    kind: 'synth',
    description: 'A punchy FM bass with a tight, percussive attack.',
    polyphonic: false,
    group: 'Bass',
    createVoice: createFmBass,
  },
  {
    id: 'saw-lead',
    name: 'Saw Lead',
    kind: 'synth',
    description: 'A cutting monophonic sawtooth lead.',
    polyphonic: false,
    group: 'Leads',
    createVoice: createSawLead,
  },
  {
    id: 'square-lead',
    name: 'Square Lead',
    kind: 'synth',
    description: 'A hollow pulse lead with a chiptune character.',
    polyphonic: false,
    group: 'Leads',
    createVoice: createSquareLead,
  },
  {
    id: 'supersaw-lead',
    name: 'Supersaw Lead',
    kind: 'synth',
    description: 'A wide stack of detuned saws — big, modern leads.',
    polyphonic: true,
    group: 'Leads',
    createVoice: createSupersawLead,
  },
  {
    id: 'marimba',
    name: 'Marimba',
    kind: 'synth',
    description: 'A struck wooden mallet with a short, woody decay.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: createMarimba,
  },
  {
    id: 'music-box',
    name: 'Music Box',
    kind: 'synth',
    description: 'A delicate, glassy music-box tine.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: createMusicBox,
  },
  {
    id: 'synth-pluck',
    name: 'Synth Pluck',
    kind: 'synth',
    description: 'A bright FM pluck for arps and staccato lines.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: createSynthPluck,
  },

  // -------------------------------------------------------------------------
  // Keys — acoustic & electric keyboards
  // -------------------------------------------------------------------------
  {
    id: 'grand-piano',
    name: 'Grand Piano',
    kind: 'synth',
    description: 'An acoustic grand approximation — bright hammered attack over a long, singing body.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2.5,
          modulationIndex: 6,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 1.6, sustain: 0.12, release: 1 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.4 },
        }).connect(ctx.output),
        -9,
      ),
  },
  {
    id: 'bright-piano',
    name: 'Bright Piano',
    kind: 'synth',
    description: 'A brilliant CP-style electric grand — glassy, forward, and cutting in a mix.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 10,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 1.2, sustain: 0.1, release: 0.9 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.3 },
        }).connect(ctx.output),
        -10,
      ),
  },
  {
    id: 'rhodes',
    name: 'Rhodes',
    kind: 'synth',
    description: 'A soft, singing tine electric piano — mellow bark with a long sustain.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 1,
          modulationIndex: 4,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.004, decay: 1.2, sustain: 0.3, release: 1.2 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.4 },
        }).connect(ctx.output),
        -10,
      ),
  },
  {
    id: 'wurlitzer',
    name: 'Wurlitzer',
    kind: 'synth',
    description: 'A reedy electric piano with a barky midrange — vintage soul and pop.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2,
          modulationIndex: 8,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 0.8, sustain: 0.25, release: 0.8 },
          modulation: { type: 'square' },
          modulationEnvelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
        }).connect(ctx.output),
        -10,
      ),
  },
  {
    id: 'clavinet',
    name: 'Clavinet',
    kind: 'synth',
    description: 'A tight, funky plucked keyboard — percussive attack with a short bite.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.003, decay: 0.18, sustain: 0.15, release: 0.12 },
        }).connect(ctx.output),
        -12,
      ),
  },
  {
    id: 'harpsichord',
    name: 'Harpsichord',
    kind: 'synth',
    description: 'A baroque plucked keyboard — bright, quick decay with no sustain.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.25 },
        }).connect(ctx.output),
        -12,
      ),
  },
  {
    id: 'accordion',
    name: 'Accordion',
    kind: 'synth',
    description: 'A reedy free-bellows voice — sustained, slightly detuned double reeds.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsquare', count: 2, spread: 8 },
          envelope: { attack: 0.05, decay: 0.1, sustain: 1, release: 0.2 },
        }).connect(ctx.output),
        -14,
      ),
  },

  // -------------------------------------------------------------------------
  // Guitars & Plucked — Karplus-Strong physical models (monophonic)
  // -------------------------------------------------------------------------
  {
    id: 'nylon-guitar',
    name: 'Nylon Guitar',
    kind: 'synth',
    description: 'A soft classical nylon-string guitar — warm, rounded plucks.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 0.8, dampening: 3000, resonance: 0.7, release: 1 }, -6),
  },
  {
    id: 'steel-guitar',
    name: 'Steel Guitar',
    kind: 'synth',
    description: 'A bright acoustic steel-string guitar — crisp attack, ringing body.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 1.2, dampening: 5000, resonance: 0.8, release: 1.2 }, -6),
  },
  {
    id: 'clean-electric-guitar',
    name: 'Clean Electric Guitar',
    kind: 'synth',
    description: 'A clean electric guitar — smooth attack with a long, sustaining ring.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 0.5, dampening: 4200, resonance: 0.9, release: 1.6 }, -7),
  },
  {
    id: 'muted-electric-guitar',
    name: 'Muted Electric Guitar',
    kind: 'synth',
    description: 'A palm-muted electric guitar — short, thumpy, percussive chugs.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 0.6, dampening: 1400, resonance: 0.35, release: 0.3 }, -6),
  },
  {
    id: 'harp',
    name: 'Concert Harp',
    kind: 'synth',
    description: 'A concert harp — delicate, glassy plucks with a long shimmering decay.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 0.4, dampening: 6000, resonance: 0.95, release: 2.4 }, -7),
  },
  {
    id: 'koto',
    name: 'Koto',
    kind: 'synth',
    description: 'A Japanese koto — bright, twangy plucked strings with a woody body.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 1, dampening: 3600, resonance: 0.82, release: 1.4 }, -7),
  },
  {
    id: 'banjo',
    name: 'Banjo',
    kind: 'synth',
    description: 'A bluegrass banjo — snappy, bright plucks with a short, twangy decay.',
    polyphonic: false,
    group: 'Guitars & Plucked',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 1.6, dampening: 5200, resonance: 0.55, release: 0.5 }, -8),
  },

  // -------------------------------------------------------------------------
  // Bass — acoustic & electric basses
  // -------------------------------------------------------------------------
  {
    id: 'upright-bass',
    name: 'Upright Bass',
    kind: 'synth',
    description: 'A plucked acoustic double bass — round, woody, and warm.',
    polyphonic: false,
    group: 'Bass',
    createVoice: (ctx) =>
      pluck(ctx, { attackNoise: 0.6, dampening: 1800, resonance: 0.6, release: 1 }, -4),
  },
  {
    id: 'finger-bass',
    name: 'Finger Bass',
    kind: 'synth',
    description: 'A fingered electric bass — smooth attack with a rounded low end.',
    polyphonic: false,
    group: 'Bass',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.2 },
          filter: { type: 'lowpass', Q: 1, rolloff: -24 },
          filterEnvelope: { attack: 0.01, decay: 0.18, sustain: 0.25, release: 0.2, baseFrequency: 90, octaves: 2.5 },
        }).connect(ctx.output),
        -6,
      ),
  },
  {
    id: 'picked-bass',
    name: 'Picked Bass',
    kind: 'synth',
    description: 'A picked electric bass — brighter, snappier attack with more definition.',
    polyphonic: false,
    group: 'Bass',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.2 },
          filter: { type: 'lowpass', Q: 2, rolloff: -24 },
          filterEnvelope: { attack: 0.005, decay: 0.15, sustain: 0.3, release: 0.2, baseFrequency: 160, octaves: 2.5 },
        }).connect(ctx.output),
        -7,
      ),
  },
  {
    id: 'slap-bass',
    name: 'Slap Bass',
    kind: 'synth',
    description: 'A slap-and-pop electric bass — bright, resonant snap with a fast filter.',
    polyphonic: false,
    group: 'Bass',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'square' },
          envelope: { attack: 0.005, decay: 0.12, sustain: 0.3, release: 0.2 },
          filter: { type: 'lowpass', Q: 4, rolloff: -24 },
          filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.2, baseFrequency: 300, octaves: 3 },
        }).connect(ctx.output),
        -8,
      ),
  },
  {
    id: 'reese-bass',
    name: 'Reese Bass',
    kind: 'synth',
    description: 'A detuned, growling saw bass — the classic dark, moving drum-and-bass low end.',
    polyphonic: false,
    group: 'Bass',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'fatsawtooth', count: 2, spread: 30 },
          envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.3 },
          filter: { type: 'lowpass', Q: 3, rolloff: -24 },
          filterEnvelope: { attack: 0.02, decay: 0.2, sustain: 0.4, release: 0.3, baseFrequency: 100, octaves: 2.5 },
        }).connect(ctx.output),
        -8,
      ),
  },

  // -------------------------------------------------------------------------
  // Strings — bowed solos, pizzicato & sections
  // -------------------------------------------------------------------------
  {
    id: 'violin',
    name: 'Solo Violin',
    kind: 'synth',
    description: 'A bowed solo violin — slow swelling attack with an expressive vibrato.',
    polyphonic: false,
    group: 'Strings',
    createVoice: (ctx) =>
      tuned(
        new Tone.DuoSynth({
          harmonicity: 1.5,
          vibratoAmount: 0.35,
          vibratoRate: 5.5,
          voice0: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.12, decay: 0.1, sustain: 0.9, release: 0.4 },
          },
          voice1: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.12, decay: 0.1, sustain: 0.9, release: 0.4 },
          },
        }).connect(ctx.output),
        -12,
      ),
  },
  {
    id: 'cello',
    name: 'Solo Cello',
    kind: 'synth',
    description: 'A bowed solo cello — deep, rich, and singing with a warm vibrato.',
    polyphonic: false,
    group: 'Strings',
    createVoice: (ctx) =>
      tuned(
        new Tone.DuoSynth({
          harmonicity: 1,
          vibratoAmount: 0.3,
          vibratoRate: 4.5,
          voice0: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.15, decay: 0.1, sustain: 0.9, release: 0.5 },
          },
          voice1: {
            oscillator: { type: 'sine' },
            envelope: { attack: 0.15, decay: 0.1, sustain: 0.9, release: 0.5 },
          },
        }).connect(ctx.output),
        -11,
      ),
  },
  {
    id: 'pizzicato-strings',
    name: 'Pizzicato Strings',
    kind: 'synth',
    description: 'Plucked string section — short, staccato stabs with no sustain.',
    polyphonic: true,
    group: 'Strings',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.2 },
        }).connect(ctx.output),
        -10,
      ),
  },
  {
    id: 'chamber-strings',
    name: 'Chamber Strings',
    kind: 'synth',
    description: 'A small bowed string ensemble — intimate, sustained, and detuned.',
    polyphonic: true,
    group: 'Strings',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
          envelope: { attack: 0.25, decay: 0.2, sustain: 0.8, release: 1 },
        }).connect(ctx.output),
        -15,
      ),
  },
  {
    id: 'cinematic-strings',
    name: 'Cinematic Strings',
    kind: 'synth',
    description: 'A huge, lush film-score string section — slow swells and a long tail.',
    polyphonic: true,
    group: 'Strings',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 4, spread: 35 },
          envelope: { attack: 0.6, decay: 0.3, sustain: 0.85, release: 2 },
        }).connect(ctx.output),
        -16,
      ),
  },

  // -------------------------------------------------------------------------
  // Brass & Winds — filtered-saw brass and reedy/breathy winds
  // -------------------------------------------------------------------------
  {
    id: 'trumpet',
    name: 'Trumpet',
    kind: 'synth',
    description: 'A bright solo trumpet — brassy, forward, with a quick blown attack.',
    polyphonic: false,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.2 },
          filter: { type: 'lowpass', Q: 1, rolloff: -12 },
          filterEnvelope: { attack: 0.06, decay: 0.2, sustain: 0.6, release: 0.2, baseFrequency: 500, octaves: 2.5 },
        }).connect(ctx.output),
        -12,
      ),
  },
  {
    id: 'trombone',
    name: 'Trombone',
    kind: 'synth',
    description: 'A solo trombone — round, low brass with a smooth, slower attack.',
    polyphonic: false,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.08, decay: 0.1, sustain: 0.8, release: 0.25 },
          filter: { type: 'lowpass', Q: 1, rolloff: -12 },
          filterEnvelope: { attack: 0.08, decay: 0.2, sustain: 0.6, release: 0.25, baseFrequency: 300, octaves: 2 },
        }).connect(ctx.output),
        -11,
      ),
  },
  {
    id: 'french-horn',
    name: 'French Horn',
    kind: 'synth',
    description: 'A mellow French horn — warm, dark brass that blends into pads.',
    polyphonic: true,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 2, spread: 12 },
          envelope: { attack: 0.12, decay: 0.2, sustain: 0.8, release: 0.5 },
        }).connect(ctx.output),
        -14,
      ),
  },
  {
    id: 'brass-section',
    name: 'Brass Section',
    kind: 'synth',
    description: 'A punchy brass ensemble — bold, stabby horns for hits and lines.',
    polyphonic: true,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 3, spread: 20 },
          envelope: { attack: 0.06, decay: 0.15, sustain: 0.85, release: 0.3 },
        }).connect(ctx.output),
        -15,
      ),
  },
  {
    id: 'saxophone',
    name: 'Saxophone',
    kind: 'synth',
    description: 'A reedy solo saxophone — breathy, expressive, with a gentle vibrato.',
    polyphonic: false,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.DuoSynth({
          harmonicity: 1,
          vibratoAmount: 0.2,
          vibratoRate: 5,
          voice0: {
            oscillator: { type: 'sawtooth' },
            envelope: { attack: 0.06, decay: 0.15, sustain: 0.8, release: 0.3 },
          },
          voice1: {
            oscillator: { type: 'square' },
            envelope: { attack: 0.06, decay: 0.15, sustain: 0.8, release: 0.3 },
          },
        }).connect(ctx.output),
        -13,
      ),
  },
  {
    id: 'flute',
    name: 'Flute',
    kind: 'synth',
    description: 'An airy solo flute — soft, breathy tone with a gentle attack.',
    polyphonic: false,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.08, decay: 0.1, sustain: 0.9, release: 0.2 },
          filter: { type: 'lowpass', Q: 1, rolloff: -12 },
          filterEnvelope: { attack: 0.08, decay: 0.1, sustain: 0.8, release: 0.2, baseFrequency: 800, octaves: 1.5 },
        }).connect(ctx.output),
        -12,
      ),
  },
  {
    id: 'clarinet',
    name: 'Clarinet',
    kind: 'synth',
    description: 'A woody clarinet — hollow, square-ish reed tone with a smooth attack.',
    polyphonic: false,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'square' },
          envelope: { attack: 0.06, decay: 0.1, sustain: 0.85, release: 0.2 },
          filter: { type: 'lowpass', Q: 1, rolloff: -12 },
          filterEnvelope: { attack: 0.06, decay: 0.1, sustain: 0.8, release: 0.2, baseFrequency: 500, octaves: 1.5 },
        }).connect(ctx.output),
        -13,
      ),
  },
  {
    id: 'oboe',
    name: 'Oboe',
    kind: 'synth',
    description: 'A bright, nasal oboe — thin double-reed tone that sings over a section.',
    polyphonic: false,
    group: 'Brass & Winds',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.05, decay: 0.1, sustain: 0.85, release: 0.2 },
          filter: { type: 'lowpass', Q: 2, rolloff: -12 },
          filterEnvelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.2, baseFrequency: 900, octaves: 1.5 },
        }).connect(ctx.output),
        -14,
      ),
  },

  // -------------------------------------------------------------------------
  // Leads — extra monophonic synth leads
  // -------------------------------------------------------------------------
  {
    id: 'hard-lead',
    name: 'Hard Lead',
    kind: 'synth',
    description: 'An aggressive resonant saw lead — bright, cutting, and in-your-face.',
    polyphonic: false,
    group: 'Leads',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'sawtooth' },
          envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 },
          filter: { type: 'lowpass', Q: 4, rolloff: -24 },
          filterEnvelope: { attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.2, baseFrequency: 500, octaves: 3.5 },
        }).connect(ctx.output),
        -13,
      ),
  },
  {
    id: 'mellow-lead',
    name: 'Mellow Lead',
    kind: 'synth',
    description: 'A soft triangle lead — smooth and rounded for gentle melodic lines.',
    polyphonic: false,
    group: 'Leads',
    createVoice: (ctx) =>
      tuned(
        new Tone.MonoSynth({
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.4 },
          filter: { type: 'lowpass', Q: 1, rolloff: -12 },
          filterEnvelope: { attack: 0.03, decay: 0.2, sustain: 0.6, release: 0.4, baseFrequency: 300, octaves: 2 },
        }).connect(ctx.output),
        -12,
      ),
  },

  // -------------------------------------------------------------------------
  // Pads — extra sustained textures
  // -------------------------------------------------------------------------
  {
    id: 'analog-pad',
    name: 'Analog Pad',
    kind: 'synth',
    description: 'A classic detuned analog pad — warm, wide, and slowly evolving.',
    polyphonic: true,
    group: 'Pads',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
          envelope: { attack: 0.7, decay: 0.4, sustain: 0.8, release: 2 },
        }).connect(ctx.output),
        -14,
      ),
  },
  {
    id: 'choir-pad',
    name: 'Choir Pad',
    kind: 'synth',
    description: 'A breathy vocal-style pad — soft, airy "aahs" for lush backgrounds.',
    polyphonic: true,
    group: 'Pads',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.AMSynth, {
          harmonicity: 1.5,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.5, decay: 0.3, sustain: 0.9, release: 1.8 },
          modulation: { type: 'triangle' },
        }).connect(ctx.output),
        -13,
      ),
  },

  // -------------------------------------------------------------------------
  // Mallets & Plucks — tuned percussion
  // -------------------------------------------------------------------------
  {
    id: 'vibraphone',
    name: 'Vibraphone',
    kind: 'synth',
    description: 'A mellow struck-metal vibraphone — warm, bell-like, with a long ring.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3,
          modulationIndex: 3,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 1.2, sustain: 0.1, release: 1.4 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
        }).connect(ctx.output),
        -10,
      ),
  },
  {
    id: 'glockenspiel',
    name: 'Glockenspiel',
    kind: 'synth',
    description: 'A bright struck-metal glockenspiel — sparkling, high, bell-like tines.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 6,
          modulationIndex: 4,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.8, sustain: 0, release: 0.6 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
        }).connect(ctx.output),
        -12,
      ),
  },
  {
    id: 'xylophone',
    name: 'Xylophone',
    kind: 'synth',
    description: 'A bright wooden xylophone — hard, knocky mallet with a short decay.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.Synth, {
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.001, decay: 0.35, sustain: 0, release: 0.2 },
        }).connect(ctx.output),
        -9,
      ),
  },
  {
    id: 'kalimba',
    name: 'Kalimba',
    kind: 'synth',
    description: 'A thumb-piano kalimba — soft, round metallic plinks with a gentle decay.',
    polyphonic: true,
    group: 'Mallets & Plucks',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 2,
          modulationIndex: 3,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 0.6, sustain: 0, release: 0.5 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2 },
        }).connect(ctx.output),
        -11,
      ),
  },

  // -------------------------------------------------------------------------
  // Percussion — pitched percussion
  // -------------------------------------------------------------------------
  {
    id: 'steel-drum',
    name: 'Steel Drum',
    kind: 'synth',
    description: 'A Caribbean steel pan — bright, metallic, pitched percussion.',
    polyphonic: true,
    group: 'Percussion',
    createVoice: (ctx) =>
      tuned(
        new Tone.PolySynth(Tone.FMSynth, {
          harmonicity: 3.5,
          modulationIndex: 6,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.003, decay: 0.5, sustain: 0.1, release: 0.5 },
          modulation: { type: 'sine' },
          modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 },
        }).connect(ctx.output),
        -11,
      ),
  },
  {
    id: 'timpani',
    name: 'Timpani',
    kind: 'synth',
    description: 'A pitched orchestral timpani — deep, resonant, tuned drum booms.',
    polyphonic: false,
    group: 'Percussion',
    createVoice: (ctx) =>
      tuned(
        new Tone.MembraneSynth({
          pitchDecay: 0.08,
          octaves: 3,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.001, decay: 0.9, sustain: 0.01, release: 1.2 },
        }).connect(ctx.output),
        -6,
      ),
  },
]
