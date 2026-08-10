/**
 * Text-to-motif generator.
 *
 * Turns {@link MotifParams} (usually distilled from a prompt by
 * `interpretPrompt`) into a short, musically coherent, monophonic phrase in the
 * composer's own note vocabulary ({@link SuggestedNote}). Generation is a seeded
 * random walk over scale degrees on a sixteenth-note grid — fully deterministic,
 * dependency-free, and instant. The result is handed to the composer controller's
 * `insertNotes`, so it is sanitized/clamped by the same reducer as every note.
 */
import { mulberry32, randInt } from './rng'
import { type MotifParams, type SuggestedNote, SCALES } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** A sixteenth-note grid (quarter of a beat). */
const GRID = 0.25

export interface GenerateMotifOptions {
  /** Beat position where the motif should start (defaults to 0). */
  regionStart?: number
}

/**
 * Generate a deterministic motif from `params`. Notes never overlap (monophonic)
 * and always include at least one note, so the caller can rely on a usable phrase.
 */
export function generateMotif(
  params: MotifParams,
  options: GenerateMotifOptions = {},
): SuggestedNote[] {
  const regionStart = options.regionStart ?? 0
  const next = mulberry32(params.seed)
  const scale = SCALES[params.scale]
  const rootMidi = (params.octave + 1) * 12 + params.root
  // Two octaves of scale degrees give the walk room to breathe.
  const ladder: number[] = []
  for (let octave = 0; octave < 2; octave += 1) {
    for (const degree of scale) ladder.push(degree + octave * 12)
  }

  const totalSteps = Math.max(1, Math.round(params.lengthBeats / GRID))
  // Probability a given grid slot starts a note, scaled by density (1–4).
  const onset = clamp(0.28 + params.density * 0.16, 0.3, 0.95)
  const maxDurationSteps = Math.max(1, Math.round(2 + params.energy * 3))

  const notes: SuggestedNote[] = []
  let ladderIndex = Math.floor(ladder.length / 4) // start low-ish in the range

  for (let step = 0; step < totalSteps; ) {
    if (next() > onset) {
      step += 1
      continue
    }
    // Random walk: small melodic steps, occasional leaps on higher energy.
    const move = randInt(next, -2, 2) + (next() < params.energy * 0.3 ? randInt(next, -3, 3) : 0)
    ladderIndex = clamp(ladderIndex + move, 0, ladder.length - 1)
    const pitch = clamp(rootMidi + ladder[ladderIndex], 0, 127)

    const durationSteps = Math.min(randInt(next, 1, maxDurationSteps), totalSteps - step)
    const duration = durationSteps * GRID
    const velocity = clamp(0.5 + params.energy * 0.35 + (next() - 0.5) * 0.12, 0.1, 1)

    notes.push({ pitch, start: regionStart + step * GRID, duration, velocity })
    step += durationSteps
  }

  if (notes.length === 0) {
    notes.push({
      pitch: clamp(rootMidi, 0, 127),
      start: regionStart,
      duration: 1,
      velocity: clamp(0.5 + params.energy * 0.3, 0.1, 1),
    })
  }

  return notes
}
