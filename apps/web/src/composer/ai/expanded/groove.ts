/**
 * Groove & humanize — make a stiff, grid-aligned phrase feel played.
 *
 * Two complementary operations, applied together:
 *  - **Swing:** delay off-beat eighths toward a triplet feel (0 = straight).
 *  - **Humanize:** add small, *seeded* random jitter to start times and
 *    velocities so notes aren't robotically identical.
 *
 * Because the jitter is seeded, the result is reproducible: the same notes +
 * params + seed always produce the same groove. Note count and pitches are
 * preserved. Free-tier feature.
 */
import { mulberry32 } from './rng'
import { type GroovePreset, type GrooveParams, type SuggestedNote } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Named starting points for the groove controls. */
export const GROOVE_PRESETS: readonly GroovePreset[] = [
  { id: 'tight', name: 'Tight', description: 'Machine-tight, no swing', swing: 0, humanizeTiming: 0.02, humanizeVelocity: 0.05 },
  { id: 'swing-8', name: 'Swing 8ths', description: 'Classic eighth-note swing', swing: 0.55, humanizeTiming: 0.05, humanizeVelocity: 0.1 },
  { id: 'swing-16', name: 'Swing 16ths', description: 'Subtle sixteenth-note shuffle', swing: 0.3, humanizeTiming: 0.06, humanizeVelocity: 0.12 },
  { id: 'human', name: 'Human', description: 'Natural, lightly loose timing', swing: 0.15, humanizeTiming: 0.12, humanizeVelocity: 0.18 },
  { id: 'loose', name: 'Loose', description: 'Very relaxed, expressive feel', swing: 0.2, humanizeTiming: 0.2, humanizeVelocity: 0.28 },
]

const EIGHTH = 0.5
const SWING_TOLERANCE = 0.08

/** Maximum start jitter (in beats) at humanizeTiming = 1. */
const MAX_TIMING_JITTER = 0.18
/** Maximum velocity jitter at humanizeVelocity = 1. */
const MAX_VELOCITY_JITTER = 0.35

function isOffbeatEighth(start: number): boolean {
  const phase = start - Math.floor(start)
  return Math.abs(phase - EIGHTH) <= SWING_TOLERANCE
}

/**
 * Apply swing + humanization to `notes`, returning a new same-length array.
 * Notes are processed in a stable start-time order so the seeded jitter is
 * independent of the input array order. Pitches and durations are preserved.
 */
export function applyGroove(
  notes: readonly SuggestedNote[],
  params: GrooveParams,
): SuggestedNote[] {
  const next = mulberry32(params.seed)
  const swing = clamp(params.swing, 0, 1)
  const timing = clamp(params.humanizeTiming, 0, 1)
  const velocity = clamp(params.humanizeVelocity, 0, 1)

  // Order the jitter stream deterministically by musical position, then map the
  // results back onto the original notes so we return them in input order.
  const order = notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.start - b.note.start || a.index - b.index)

  const grooved = new Array<SuggestedNote>(notes.length)
  for (const { note, index } of order) {
    // Swing: nudge off-beat eighths later by up to a triplet's worth.
    const swingShift = isOffbeatEighth(note.start) ? swing * (1 / 6) : 0
    const timingJitter = (next() * 2 - 1) * timing * MAX_TIMING_JITTER
    const velocityJitter = (next() * 2 - 1) * velocity * MAX_VELOCITY_JITTER

    grooved[index] = {
      pitch: note.pitch,
      start: Math.max(0, note.start + swingShift + timingJitter),
      duration: note.duration,
      velocity: clamp(note.velocity + velocityJitter, 0.05, 1),
    }
  }

  return grooved
}

/** Look up a preset by id (undefined when unknown). */
export function findGroovePreset(id: string): GroovePreset | undefined {
  return GROOVE_PRESETS.find((preset) => preset.id === id)
}
