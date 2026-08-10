/**
 * Pure mixer-automation sampling.
 *
 * Automation lanes ({@link AutomationLane}) hold ordered {@link AutomationPoint}s
 * (`beat` → `value`). At playback the engine samples every lane for the current
 * transport beat and pushes the interpolated values onto the mixer graph. Keeping
 * the maths here — free of Tone/React — makes it trivially unit-testable and lets
 * the same helpers drive both the audio graph and any future automation UI.
 */
import type { AutomationLane, AutomationPoint } from '../contract/mixing'

/**
 * Linear-interpolate a lane's value at `beat`. Points are assumed sorted by
 * `beat` (see {@link upsertPoint}). Before the first / after the last point the
 * value is clamped (held) to that endpoint. Returns `null` for an empty lane so
 * callers can leave the target's static value untouched.
 */
export function sampleLane(points: readonly AutomationPoint[], beat: number): number | null {
  if (points.length === 0) return null
  const first = points[0]
  if (beat <= first.beat) return first.value
  const last = points[points.length - 1]
  if (beat >= last.beat) return last.value

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const next = points[i]
    if (beat <= next.beat) {
      const span = next.beat - prev.beat
      if (span <= 0) return next.value
      const t = (beat - prev.beat) / span
      return prev.value + t * (next.value - prev.value)
    }
  }
  return last.value
}

/** The interpolated automation overrides for a single transport beat. */
export interface AutomationFrame {
  /** Track id → gain in dB. */
  trackGain: Map<string, number>
  /** Track id → pan (-1..+1). */
  trackPan: Map<string, number>
  /** Master gain in dB, or `null` when no master-gain lane is active. */
  masterGain: number | null
}

/** Sample every lane at `beat` into a frame the mixer graph can apply directly. */
export function sampleAutomation(
  lanes: readonly AutomationLane[],
  beat: number,
): AutomationFrame {
  const frame: AutomationFrame = {
    trackGain: new Map(),
    trackPan: new Map(),
    masterGain: null,
  }
  for (const lane of lanes) {
    const value = sampleLane(lane.points, beat)
    if (value === null) continue
    if (lane.target === 'trackGain' && lane.trackId) {
      frame.trackGain.set(lane.trackId, value)
    } else if (lane.target === 'trackPan' && lane.trackId) {
      frame.trackPan.set(lane.trackId, value)
    } else if (lane.target === 'masterGain') {
      frame.masterGain = value
    }
  }
  return frame
}

/**
 * Insert `point` into `points`, replacing any existing point at the same beat,
 * and return a new, beat-sorted array. Immutable so callers can treat lanes as
 * plain snapshots.
 */
export function upsertPoint(
  points: readonly AutomationPoint[],
  point: AutomationPoint,
): AutomationPoint[] {
  const rest = points.filter((existing) => existing.beat !== point.beat)
  return [...rest, point].sort((a, b) => a.beat - b.beat)
}
