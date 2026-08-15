import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { AutomationLane } from './AutomationLane'
import { pointFromPointer } from './automationLaneGeometry'

const baseProps = {
  label: 'Volume',
  target: 'trackGain' as const,
  trackId: 't1',
  points: [
    { beat: 0, value: -6 },
    { beat: 4, value: 0 },
  ],
  lengthBeats: 8,
  snap: 1,
  positionBeats: 2,
  min: -60,
  max: 6,
  formatValue: (v: number) => `${v.toFixed(1)} dB`,
  onAddAtPlayhead: vi.fn(),
  onWritePoint: vi.fn(),
  onRemovePoint: vi.fn(),
  onClear: vi.fn(),
}

describe('pointFromPointer', () => {
  it('maps x to a snapped beat within the lane', () => {
    // 0.5 across an 8-beat lane = beat 4 (already on the grid).
    expect(pointFromPointer({ xRatio: 0.5, yRatio: 0, lengthBeats: 8, snap: 1, min: -60, max: 6 }).beat).toBe(4)
    // Snaps to the nearest whole beat.
    expect(pointFromPointer({ xRatio: 0.3, yRatio: 0, lengthBeats: 8, snap: 1, min: -60, max: 6 }).beat).toBe(2)
  })

  it('maps y top→bottom over max→min', () => {
    expect(pointFromPointer({ xRatio: 0, yRatio: 0, lengthBeats: 8, snap: 1, min: -60, max: 6 }).value).toBe(6)
    expect(pointFromPointer({ xRatio: 0, yRatio: 1, lengthBeats: 8, snap: 1, min: -60, max: 6 }).value).toBe(-60)
    expect(pointFromPointer({ xRatio: 0, yRatio: 0.5, lengthBeats: 8, snap: 1, min: -60, max: 6 }).value).toBe(-27)
  })

  it('clamps out-of-bounds ratios and never yields a negative beat', () => {
    const p = pointFromPointer({ xRatio: -1, yRatio: 2, lengthBeats: 8, snap: 1, min: -1, max: 1 })
    expect(p.beat).toBe(0)
    expect(p.value).toBe(-1)
  })

  it('honours a fractional snap grid', () => {
    // 0.1 * 8 = 0.8 -> nearest 0.5 = 1.0
    expect(pointFromPointer({ xRatio: 0.1, yRatio: 0, lengthBeats: 8, snap: 0.5, min: -60, max: 6 }).beat).toBe(1)
  })
})

describe('AutomationLane', () => {
  it('is an accessible labelled group', () => {
    render(<AutomationLane {...baseProps} />)
    expect(screen.getByRole('group', { name: 'Volume automation' })).toBeInTheDocument()
  })

  it('renders a remove button per point with a descriptive label', () => {
    coversInteractions('studio.automation.remove-point')
    render(<AutomationLane {...baseProps} />)
    const remove = screen.getByRole('button', { name: /Remove Volume point at beat 0/ })
    fireEvent.click(remove)
    expect(baseProps.onRemovePoint).toHaveBeenCalledWith(0)
  })

  it('adds a point at the playhead via the button', () => {
    coversInteractions('studio.automation.add-point')
    render(<AutomationLane {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add point' }))
    expect(baseProps.onAddAtPlayhead).toHaveBeenCalledTimes(1)
  })

  it('clears the lane', () => {
    coversInteractions('studio.automation.clear')
    render(<AutomationLane {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear Volume automation' }))
    expect(baseProps.onClear).toHaveBeenCalledTimes(1)
  })

  it('hides the Clear button when the lane is empty', () => {
    render(<AutomationLane {...baseProps} points={[]} />)
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
  })

  it('writes a point when the lane surface is clicked', () => {
    coversInteractions('studio.automation.lane')
    const onWritePoint = vi.fn()
    const { container } = render(<AutomationLane {...baseProps} onWritePoint={onWritePoint} />)
    const svg = container.querySelector('.automation-lane__graph') as SVGSVGElement
    svg.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    fireEvent.click(svg, { clientX: 50, clientY: 0 })
    // x 0.5 of 8 beats = beat 4, y 0 = max (6 dB).
    expect(onWritePoint).toHaveBeenCalledWith(4, 6)
  })
})
