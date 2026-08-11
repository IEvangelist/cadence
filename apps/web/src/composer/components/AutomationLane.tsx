import { useRef } from 'react'
import type { AutomationPoint, AutomationTarget } from '../model/automation'
import { LANE_VIEW, pointFromPointer, xPercent, yPercent } from './automationLaneGeometry'

export interface AutomationLaneProps {
  /** Human label for the parameter, e.g. `Volume`, `Pan`, `Master gain`. */
  label: string
  target: AutomationTarget
  /** Present for per-track lanes; omitted for master targets. */
  trackId?: string
  points: readonly AutomationPoint[]
  /** Horizontal span of the lane in beats (the project length). */
  lengthBeats: number
  /** Grid (beats) drawn points snap to. */
  snap: number
  /** Current transport position in beats (drives the playhead tick). */
  positionBeats: number
  /** Value range for the parameter (dB for gains, -1..+1 for pan). */
  min: number
  max: number
  /** Render a value for labels/readouts (e.g. `-6.0 dB`, `L42`). */
  formatValue: (value: number) => string
  /** Write the parameter's current live value as a point at the playhead. */
  onAddAtPlayhead: () => void
  /** Add or replace a point at an explicit beat/value (drawing on the lane). */
  onWritePoint: (beat: number, value: number) => void
  /** Remove the point at `beat`. */
  onRemovePoint: (beat: number) => void
  /** Clear every point on the lane. */
  onClear: () => void
}

/**
 * An accessible draw/edit surface for one automation lane (#44 mixer parameter).
 *
 * The lane is a compact SVG plot of beat-sorted points over the project timeline;
 * clicking it adds or replaces a point at the pointer (snapped to the grid). Every
 * action also has a real, labelled control for keyboard/AT users: an "Add at
 * playhead" button, a ≥24px remove button per point (with a descriptive
 * `aria-label`), and a "Clear" button. It is presentational — all edits flow up
 * through the callbacks, which dispatch reducer actions so automation persists.
 */
export function AutomationLane({
  label,
  target,
  points,
  lengthBeats,
  snap,
  positionBeats,
  min,
  max,
  formatValue,
  onAddAtPlayhead,
  onWritePoint,
  onRemovePoint,
  onClear,
}: AutomationLaneProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  const sorted = [...points].sort((a, b) => a.beat - b.beat)
  const polyline = sorted
    .map((p) => `${xPercent(p.beat, lengthBeats)},${yPercent(p.value, min, max)}`)
    .join(' ')
  const playheadX = xPercent(positionBeats, lengthBeats)

  const handleLaneClick = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const point = pointFromPointer({
      xRatio: (event.clientX - rect.left) / rect.width,
      yRatio: (event.clientY - rect.top) / rect.height,
      lengthBeats,
      snap,
      min,
      max,
    })
    onWritePoint(point.beat, point.value)
  }

  return (
    <div className="automation-lane" role="group" aria-label={`${label} automation`}>
      <div className="automation-lane__head">
        <span className="automation-lane__label">{label}</span>
        <div className="automation-lane__actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onAddAtPlayhead}
          >
            Add point
          </button>
          {sorted.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={onClear}
              aria-label={`Clear ${label} automation`}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="automation-lane__plot">
        <svg
          ref={svgRef}
          className="automation-lane__graph"
          viewBox={`0 0 ${LANE_VIEW} ${LANE_VIEW}`}
          preserveAspectRatio="none"
          role="presentation"
          onClick={handleLaneClick}
        >
          {sorted.length >= 2 && (
            <polyline className="automation-lane__line" points={polyline} vectorEffect="non-scaling-stroke" />
          )}
          <line
            className="automation-lane__playhead"
            x1={playheadX}
            y1={0}
            x2={playheadX}
            y2={LANE_VIEW}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {sorted.map((point) => (
          <button
            key={point.beat}
            type="button"
            className="automation-lane__point"
            style={{
              left: `${xPercent(point.beat, lengthBeats)}%`,
              top: `${yPercent(point.value, min, max)}%`,
            }}
            aria-label={`Remove ${label} point at beat ${point.beat} (${formatValue(point.value)})`}
            onClick={() => onRemovePoint(point.beat)}
          />
        ))}
      </div>

      <p className="automation-lane__hint">
        {sorted.length === 0
          ? 'No automation — click the lane or "Add point".'
          : `${sorted.length} ${sorted.length === 1 ? 'point' : 'points'} · ${target === 'trackPan' ? 'pan' : 'level'}`}
      </p>
    </div>
  )
}
