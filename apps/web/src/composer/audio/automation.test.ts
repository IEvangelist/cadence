import { describe, expect, it } from 'vitest'
import { sampleAutomation, sampleLane, upsertPoint } from './automation'
import type { AutomationLane } from '../contract/mixing'

describe('sampleLane', () => {
  it('returns null for an empty lane', () => {
    expect(sampleLane([], 4)).toBeNull()
  })

  it('clamps to the first point before the lane starts', () => {
    expect(sampleLane([{ beat: 2, value: -6 }, { beat: 6, value: 0 }], 0)).toBe(-6)
  })

  it('clamps to the last point after the lane ends', () => {
    expect(sampleLane([{ beat: 2, value: -6 }, { beat: 6, value: 0 }], 10)).toBe(0)
  })

  it('linearly interpolates between two points', () => {
    // Halfway from beat 2 (-6) to beat 6 (+2) is -2.
    expect(sampleLane([{ beat: 2, value: -6 }, { beat: 6, value: 2 }], 4)).toBe(-2)
  })

  it('returns the exact value at a point', () => {
    expect(sampleLane([{ beat: 0, value: 1 }, { beat: 4, value: 5 }], 4)).toBe(5)
  })

  it('handles two points sharing a beat without dividing by zero', () => {
    expect(sampleLane([{ beat: 2, value: -3 }, { beat: 2, value: 4 }], 2)).toBe(-3)
  })
})

describe('sampleAutomation', () => {
  const lanes: AutomationLane[] = [
    { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }] },
    { target: 'trackPan', trackId: 't1', points: [{ beat: 0, value: 0.5 }] },
    { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
    { target: 'trackGain', trackId: 't2', points: [] }, // empty → skipped
    { target: 'trackGain', points: [{ beat: 0, value: 3 }] }, // no trackId → skipped
    { target: 'custom-thing', trackId: 't1', points: [{ beat: 0, value: 9 }] }, // unknown → skipped
  ]

  it('maps each supported target into the frame', () => {
    const frame = sampleAutomation(lanes, 0)
    expect(frame.trackGain.get('t1')).toBe(-6)
    expect(frame.trackPan.get('t1')).toBe(0.5)
    expect(frame.masterGain).toBe(-2)
  })

  it('skips empty lanes, trackless track lanes, and unknown targets', () => {
    const frame = sampleAutomation(lanes, 0)
    expect(frame.trackGain.has('t2')).toBe(false)
    expect(frame.trackGain.size).toBe(1)
    expect(frame.trackPan.size).toBe(1)
  })

  it('returns a null master when no master lane is present', () => {
    const frame = sampleAutomation(
      [{ target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: 0 }] }],
      0,
    )
    expect(frame.masterGain).toBeNull()
  })
})

describe('upsertPoint', () => {
  it('inserts a new point and keeps the lane beat-sorted', () => {
    const result = upsertPoint([{ beat: 0, value: 0 }, { beat: 8, value: 1 }], { beat: 4, value: 0.5 })
    expect(result.map((p) => p.beat)).toEqual([0, 4, 8])
  })

  it('replaces an existing point at the same beat', () => {
    const result = upsertPoint([{ beat: 4, value: 0 }], { beat: 4, value: -6 })
    expect(result).toEqual([{ beat: 4, value: -6 }])
  })

  it('does not mutate the input array', () => {
    const input = [{ beat: 0, value: 0 }]
    upsertPoint(input, { beat: 2, value: 1 })
    expect(input).toEqual([{ beat: 0, value: 0 }])
  })
})
