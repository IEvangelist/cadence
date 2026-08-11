/**
 * Pure geometry for the automation-lane editor — kept out of the component file
 * so the mapping between pointer position and automation values is unit-testable
 * and the component module only exports a component (react-refresh friendly).
 */
import type { AutomationPoint } from '../model/automation'

/** SVG viewBox is a unit square scaled to fill the lane; markers position in %. */
export const LANE_VIEW = 100

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/** Snap a raw beat to the grid, never below zero. */
export function snapBeat(rawBeat: number, snap: number): number {
  if (!(snap > 0)) return Math.max(0, rawBeat)
  return Math.max(0, Math.round(rawBeat / snap) * snap)
}

/**
 * Map a pointer position (as 0..1 ratios across the lane) to a snapped
 * {@link AutomationPoint}. `x` runs left→right over `[0, lengthBeats]`; `y` runs
 * top→bottom over `[max, min]` (top = loudest / hard-right).
 */
export function pointFromPointer(opts: {
  xRatio: number
  yRatio: number
  lengthBeats: number
  snap: number
  min: number
  max: number
}): AutomationPoint {
  const { xRatio, yRatio, lengthBeats, snap, min, max } = opts
  const beat = Math.min(lengthBeats, snapBeat(clamp01(xRatio) * lengthBeats, snap))
  const value = max - clamp01(yRatio) * (max - min)
  return { beat, value }
}

/** Horizontal position (%) of a beat within the lane. */
export function xPercent(beat: number, lengthBeats: number): number {
  return lengthBeats > 0 ? clamp01(beat / lengthBeats) * 100 : 0
}

/** Vertical position (%) of a value within the lane (top = max). */
export function yPercent(value: number, min: number, max: number): number {
  return max > min ? clamp01((max - value) / (max - min)) * 100 : 100
}
