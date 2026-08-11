/**
 * Automation model — types plus pure edit/sanitize helpers.
 *
 * An automation lane lets one mixer/track parameter (track volume, track pan, or
 * master gain) change over the transport timeline: each lane holds beat-sorted
 * {@link AutomationPoint}s that the audio layer samples and pushes onto the #44
 * mixer graph during playback. Lanes live on {@link Project.automation} so they
 * persist and serialize with the rest of the document.
 *
 * These shapes are STRUCTURALLY identical to the frozen `contract/mixing.ts`
 * `AutomationLane`/`AutomationPoint`, but are defined here (in the model) so the
 * project document stays self-contained and to avoid a type-only import cycle
 * (`model/project → contract/mixing → plugins/types → model/project`). A model
 * lane's stricter `target` is assignable to the contract's wider `string`, so the
 * audio sampler/controller accept `project.automation` directly.
 *
 * Every helper is pure and immutable so the reducer and persistence layers can
 * treat lanes as plain snapshots.
 */

/** The parameters the composer can automate. */
export type AutomationTarget = 'trackGain' | 'trackPan' | 'masterGain'

/** A single automation breakpoint: `value` at transport `beat`. */
export interface AutomationPoint {
  /** Transport position in beats (>= 0). */
  beat: number
  /** Target value at `beat` — dB for gains, -1..+1 for pan. */
  value: number
}

/** An ordered set of points driving one parameter (per-track, or master). */
export interface AutomationLane {
  target: AutomationTarget
  /** Present for per-track targets (`trackGain`/`trackPan`); omitted for master. */
  trackId?: string
  points: readonly AutomationPoint[]
}

/** All automatable targets, in display order. */
export const AUTOMATION_TARGETS: readonly AutomationTarget[] = [
  'trackGain',
  'trackPan',
  'masterGain',
]

/** dB range shared with the mixer gain/master controls. */
const GAIN_MIN = -60
const GAIN_MAX = 6
/** Pan range. */
const PAN_MIN = -1
const PAN_MAX = 1

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** True for the per-track targets (which require a `trackId`). */
export function isTrackTarget(target: AutomationTarget): boolean {
  return target === 'trackGain' || target === 'trackPan'
}

/** The valid value range for a target: dB for gains, -1..+1 for pan. */
export function automationValueRange(target: AutomationTarget): { min: number; max: number } {
  return target === 'trackPan' ? { min: PAN_MIN, max: PAN_MAX } : { min: GAIN_MIN, max: GAIN_MAX }
}

/** Clamp a value into its target's range. */
export function clampAutomationValue(target: AutomationTarget, value: number): number {
  const { min, max } = automationValueRange(target)
  return clamp(value, min, max)
}

/** A lane is identified by its `(target, trackId)` pair. */
function laneMatches(lane: AutomationLane, target: AutomationTarget, trackId?: string): boolean {
  return lane.target === target && lane.trackId === trackId
}

/** Build a lane, omitting `trackId` for master targets so it serializes cleanly. */
function makeLane(
  target: AutomationTarget,
  trackId: string | undefined,
  points: readonly AutomationPoint[],
): AutomationLane {
  return trackId === undefined ? { target, points } : { target, trackId, points }
}

/**
 * Insert `point` (replacing any point sharing its beat) and return a new,
 * beat-sorted point array. Immutable.
 */
export function upsertPoint(
  points: readonly AutomationPoint[],
  point: AutomationPoint,
): AutomationPoint[] {
  const rest = points.filter((existing) => existing.beat !== point.beat)
  return [...rest, point].sort((a, b) => a.beat - b.beat)
}

/**
 * Write (insert or replace) a point on the `(target, trackId)` lane, creating the
 * lane when it does not yet exist. The beat is clamped to `>= 0` and the value to
 * the target's range, so callers can pass raw UI input.
 */
export function writeLanePoint(
  lanes: readonly AutomationLane[],
  target: AutomationTarget,
  trackId: string | undefined,
  point: AutomationPoint,
): AutomationLane[] {
  const clamped: AutomationPoint = {
    beat: Math.max(0, point.beat),
    value: clampAutomationValue(target, point.value),
  }
  if (lanes.some((lane) => laneMatches(lane, target, trackId))) {
    return lanes.map((lane) =>
      laneMatches(lane, target, trackId)
        ? makeLane(target, trackId, upsertPoint(lane.points, clamped))
        : lane,
    )
  }
  return [...lanes, makeLane(target, trackId, [clamped])]
}

/**
 * Remove the point at `beat` from the `(target, trackId)` lane. A lane that loses
 * its last point is dropped entirely.
 */
export function removeLanePoint(
  lanes: readonly AutomationLane[],
  target: AutomationTarget,
  trackId: string | undefined,
  beat: number,
): AutomationLane[] {
  return lanes.flatMap((lane) => {
    if (!laneMatches(lane, target, trackId)) return [lane]
    const points = lane.points.filter((existing) => existing.beat !== beat)
    return points.length > 0 ? [makeLane(target, trackId, points)] : []
  })
}

/** Remove the whole `(target, trackId)` lane. */
export function clearLane(
  lanes: readonly AutomationLane[],
  target: AutomationTarget,
  trackId?: string,
): AutomationLane[] {
  return lanes.filter((lane) => !laneMatches(lane, target, trackId))
}

/** Drop every automation lane that touches `trackId` (used when a track is removed). */
export function clearTrackLanes(
  lanes: readonly AutomationLane[],
  trackId: string,
): AutomationLane[] {
  return lanes.filter((lane) => lane.trackId !== trackId)
}

function coercePoints(
  target: AutomationTarget,
  raw: readonly unknown[],
): AutomationPoint[] {
  // Dedupe by beat (a later point at the same beat wins) so a hand-edited or
  // buggy document can never carry two values for one instant.
  const byBeat = new Map<number, number>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const point = entry as Record<string, unknown>
    const { beat, value } = point
    if (typeof beat !== 'number' || !Number.isFinite(beat)) continue
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    byBeat.set(Math.max(0, beat), clampAutomationValue(target, value))
  }
  return [...byBeat.entries()]
    .map(([beat, value]) => ({ beat, value }))
    .sort((a, b) => a.beat - b.beat)
}

function coerceLane(raw: unknown): AutomationLane | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const target = record.target
  if (target !== 'trackGain' && target !== 'trackPan' && target !== 'masterGain') return null
  const trackId = typeof record.trackId === 'string' ? record.trackId : undefined
  // Per-track lanes are meaningless without a track to point at.
  if (isTrackTarget(target) && !trackId) return null
  const points = coercePoints(target, Array.isArray(record.points) ? record.points : [])
  // A lane with no valid points would never sound — drop it.
  if (points.length === 0) return null
  return makeLane(target, isTrackTarget(target) ? trackId : undefined, points)
}

/**
 * Normalize any stored/parsed value into a valid automation-lane array: unknown
 * targets, malformed/empty lanes, and out-of-range or non-finite points are
 * dropped or clamped. Non-array input (including a legacy document with no
 * `automation` field) yields `[]`.
 */
export function sanitizeAutomation(raw: unknown): AutomationLane[] {
  if (!Array.isArray(raw)) return []
  const lanes: AutomationLane[] = []
  for (const entry of raw) {
    const lane = coerceLane(entry)
    if (lane) lanes.push(lane)
  }
  return lanes
}
