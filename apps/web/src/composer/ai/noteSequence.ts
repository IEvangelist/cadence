/**
 * Conversion between the composer's note model and Magenta's quantized
 * `NoteSequence` — the lingua franca every Magenta model speaks.
 *
 * We keep our own minimal `NoteSequence` type (a structural subset of Magenta's
 * `INoteSequence`) so this module — and its round-trip tests — stay free of any
 * `@magenta/music` import. The Magenta provider passes these plain objects
 * straight to `MusicRNN`, which accepts the same shape.
 *
 * Time is quantized in *steps*: with the default `stepsPerQuarter = 4`, one
 * beat (quarter note) is four steps, i.e. a sixteenth-note grid. A round-trip
 * therefore preserves pitch and velocity, and preserves start/duration for any
 * note already aligned to that grid.
 */
import type { SuggestedNote } from './types'

/** Steps per quarter note used for quantization. Four = a 16th-note grid. */
export const STEPS_PER_QUARTER = 4

/** One note inside a quantized {@link NoteSequence}. */
export interface QuantizedNote {
  pitch: number
  quantizedStartStep: number
  quantizedEndStep: number
  /** MIDI velocity 1–127. */
  velocity?: number
  program?: number
  isDrum?: boolean
}

/** A structural subset of Magenta's `INoteSequence` (quantized form). */
export interface NoteSequence {
  notes: QuantizedNote[]
  quantizationInfo: { stepsPerQuarter: number }
  totalQuantizedSteps: number
  tempos?: Array<{ time: number; qpm: number }>
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Convert a normalized 0–1 velocity to MIDI 1–127. */
export function velocityToMidi(velocity: number): number {
  // Round to nearest, but never below 1 so a note is always audible in Magenta.
  return clamp(Math.round(clamp(velocity, 0, 1) * 127), 1, 127)
}

/**
 * Convert a MIDI 0–127 velocity back to normalized 0–1.
 *
 * Magenta `NoteSequence` notes carry a protobuf-default `velocity: 0` when the
 * model doesn't emit one — MusicRNN continuations do exactly this for every
 * note — and MIDI velocity 0 conventionally means "unset"/note-off rather than
 * an audible note at zero gain. Treat 0 (and null/undefined) as unset → an
 * audible default so generated notes actually sound. Mirrors the outbound floor
 * in {@link velocityToMidi}, which never emits below 1.
 */
export function midiToVelocity(velocity: number | undefined): number {
  if (!velocity) return 0.8
  return clamp(velocity / 127, 0, 1)
}

/** Beats → quantized steps (nearest step). */
export function beatsToSteps(beats: number, stepsPerQuarter = STEPS_PER_QUARTER): number {
  return Math.round(beats * stepsPerQuarter)
}

/** Quantized steps → beats. */
export function stepsToBeats(steps: number, stepsPerQuarter = STEPS_PER_QUARTER): number {
  return steps / stepsPerQuarter
}

export interface ToNoteSequenceOptions {
  stepsPerQuarter?: number
  tempo?: number
  /** Absolute beat position treated as step 0 (defaults to the earliest note). */
  originBeats?: number
  /** Explicit total length in beats; otherwise derived from the notes. */
  totalBeats?: number
}

/**
 * Build a quantized {@link NoteSequence} from composer notes.
 *
 * Notes are shifted so `originBeats` (default: the earliest note's start) maps
 * to step 0 — Magenta models expect a sequence that begins at the origin. The
 * shift is undone by {@link noteSequenceToNotes} via its `originBeats` option.
 */
export function notesToNoteSequence(
  notes: readonly SuggestedNote[],
  options: ToNoteSequenceOptions = {},
): NoteSequence {
  const stepsPerQuarter = options.stepsPerQuarter ?? STEPS_PER_QUARTER
  const origin =
    options.originBeats ??
    (notes.length > 0 ? Math.min(...notes.map((n) => n.start)) : 0)

  let maxEndStep = 0
  const quantizedNotes: QuantizedNote[] = notes.map((note) => {
    const startStep = beatsToSteps(note.start - origin, stepsPerQuarter)
    // A note always spans at least one step so start !== end after quantization.
    const endStep = Math.max(
      startStep + 1,
      beatsToSteps(note.start + note.duration - origin, stepsPerQuarter),
    )
    maxEndStep = Math.max(maxEndStep, endStep)
    return {
      pitch: Math.round(clamp(note.pitch, 0, 127)),
      quantizedStartStep: startStep,
      quantizedEndStep: endStep,
      velocity: velocityToMidi(note.velocity),
      program: 0,
      isDrum: false,
    }
  })

  const totalQuantizedSteps =
    options.totalBeats != null
      ? beatsToSteps(options.totalBeats, stepsPerQuarter)
      : maxEndStep

  const sequence: NoteSequence = {
    notes: quantizedNotes,
    quantizationInfo: { stepsPerQuarter },
    totalQuantizedSteps,
  }
  if (options.tempo != null) {
    sequence.tempos = [{ time: 0, qpm: options.tempo }]
  }
  return sequence
}

export interface FromNoteSequenceOptions {
  /** Absolute beat position that step 0 maps back to (inverse of the shift). */
  originBeats?: number
  /** Only keep notes at/after this step (used to drop the seed on `continue`). */
  fromStep?: number
}

/**
 * Convert a quantized {@link NoteSequence} back to composer notes, re-anchoring
 * step 0 at `originBeats`. Notes before `fromStep` are dropped — handy for
 * keeping only the *newly generated* tail of a continuation.
 */
export function noteSequenceToNotes(
  sequence: NoteSequence,
  options: FromNoteSequenceOptions = {},
): SuggestedNote[] {
  const stepsPerQuarter = sequence.quantizationInfo?.stepsPerQuarter ?? STEPS_PER_QUARTER
  const origin = options.originBeats ?? 0
  const fromStep = options.fromStep ?? Number.NEGATIVE_INFINITY

  return sequence.notes
    .filter((note) => note.quantizedStartStep >= fromStep)
    .map((note) => {
      const start = stepsToBeats(note.quantizedStartStep, stepsPerQuarter) + origin
      const duration = stepsToBeats(
        Math.max(1, note.quantizedEndStep - note.quantizedStartStep),
        stepsPerQuarter,
      )
      return {
        pitch: Math.round(clamp(note.pitch, 0, 127)),
        start,
        duration,
        velocity: midiToVelocity(note.velocity),
      }
    })
}
