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
]
