/**
 * Style transfer — reshape an existing phrase to a target production style.
 *
 * Unlike text-to-motif (which *creates* notes), style transfer *reinterprets*
 * the notes already on a track: it adjusts timing feel, articulation and
 * dynamics to evoke a named style, while preserving the melody's pitch content
 * and note count. It is a pure, deterministic map over the input notes — no
 * randomness, no model — so the same input always yields the same restyled
 * output. Pro-tier feature.
 */
import { type StyleDefinition, type StyleId, type SuggestedNote } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** The styles offered in the UI, in display order. */
export const STYLES: readonly StyleDefinition[] = [
  { id: 'lofi', name: 'Lo-fi', description: 'Soft, laid-back, slightly behind the beat' },
  { id: 'jazz-swing', name: 'Jazz swing', description: 'Swung eighths with accented downbeats' },
  { id: 'cinematic', name: 'Cinematic', description: 'Sustained, dynamic, expressive swells' },
  { id: 'edm', name: 'EDM', description: 'Tight quantized grid, punchy and staccato' },
]

/** The fraction of a beat represented by one eighth note. */
const EIGHTH = 0.5

/** How close to an off-beat eighth a note must be to count as "swingable". */
const SWING_TOLERANCE = 0.08

/** True when a start position sits on an off-beat eighth (the "&" of a beat). */
function isOffbeatEighth(start: number): boolean {
  const phase = start - Math.floor(start)
  return Math.abs(phase - EIGHTH) <= SWING_TOLERANCE
}

/** True when a start position sits on (or very near) a beat. */
function isDownbeat(start: number): boolean {
  const phase = start - Math.floor(start)
  return phase <= SWING_TOLERANCE || phase >= 1 - SWING_TOLERANCE
}

type StyleTransform = (note: SuggestedNote, index: number, notes: readonly SuggestedNote[]) => SuggestedNote

const TRANSFORMS: Record<StyleId, StyleTransform> = {
  // Softer velocities, legato tails, a touch of drag on the off-beats.
  lofi: (note) => ({
    pitch: note.pitch,
    start: note.start + (isOffbeatEighth(note.start) ? 0.03 : 0),
    duration: note.duration * 1.15,
    velocity: clamp(note.velocity * 0.65, 0.05, 1),
  }),
  // Push off-beat eighths toward a triplet feel; accent the downbeats.
  'jazz-swing': (note) => ({
    pitch: note.pitch,
    start: note.start + (isOffbeatEighth(note.start) ? 1 / 6 : 0),
    duration: note.duration,
    velocity: clamp(isDownbeat(note.start) ? note.velocity * 1.1 : note.velocity * 0.85, 0.05, 1),
  }),
  // Long, connected notes with a slow dynamic swell across the phrase.
  cinematic: (note, index, notes) => {
    const progress = notes.length > 1 ? index / (notes.length - 1) : 0
    // Swell up to the middle of the phrase, then ease back down.
    const swell = 1 - Math.abs(progress - 0.5)
    return {
      pitch: note.pitch,
      start: note.start,
      duration: note.duration * 1.6,
      velocity: clamp(0.45 + swell * 0.45, 0.05, 1),
    }
  },
  // Hard-quantize to the sixteenth grid, punchy uniform velocity, staccato.
  edm: (note) => ({
    pitch: note.pitch,
    start: Math.round(note.start * 4) / 4,
    duration: Math.min(note.duration, 0.25),
    velocity: clamp(isDownbeat(note.start) ? 0.95 : 0.8, 0.05, 1),
  }),
}

/**
 * Apply a named style to `notes`, returning a new array of the same length
 * (one output note per input note, pitches preserved). The input is not mutated.
 */
export function applyStyle(notes: readonly SuggestedNote[], styleId: StyleId): SuggestedNote[] {
  const transform = TRANSFORMS[styleId]
  return notes.map((note, index) => {
    const next = transform(note, index, notes)
    return {
      pitch: next.pitch,
      start: Math.max(0, next.start),
      duration: Math.max(GRID_FLOOR, next.duration),
      velocity: next.velocity,
    }
  })
}

/** Minimum duration so a restyled note never collapses to zero length. */
const GRID_FLOOR = 0.0625

/** Look up a style definition by id (undefined when unknown). */
export function findStyle(styleId: string): StyleDefinition | undefined {
  return STYLES.find((style) => style.id === styleId)
}
