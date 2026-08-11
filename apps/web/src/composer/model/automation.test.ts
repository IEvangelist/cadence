import { describe, expect, it } from 'vitest'
import {
  type AutomationLane,
  AUTOMATION_TARGETS,
  automationValueRange,
  clampAutomationValue,
  clearLane,
  clearTrackLanes,
  isTrackTarget,
  removeLanePoint,
  sanitizeAutomation,
  upsertPoint,
  writeLanePoint,
} from './automation'

describe('target helpers', () => {
  it('lists the automatable targets', () => {
    expect(AUTOMATION_TARGETS).toEqual(['trackGain', 'trackPan', 'masterGain'])
  })

  it('marks per-track targets', () => {
    expect(isTrackTarget('trackGain')).toBe(true)
    expect(isTrackTarget('trackPan')).toBe(true)
    expect(isTrackTarget('masterGain')).toBe(false)
  })

  it('exposes dB ranges for gains and -1..1 for pan', () => {
    expect(automationValueRange('trackGain')).toEqual({ min: -60, max: 6 })
    expect(automationValueRange('masterGain')).toEqual({ min: -60, max: 6 })
    expect(automationValueRange('trackPan')).toEqual({ min: -1, max: 1 })
  })

  it('clamps values into their target range', () => {
    expect(clampAutomationValue('trackGain', 99)).toBe(6)
    expect(clampAutomationValue('trackGain', -99)).toBe(-60)
    expect(clampAutomationValue('trackPan', 5)).toBe(1)
    expect(clampAutomationValue('trackPan', -5)).toBe(-1)
  })
})

describe('upsertPoint', () => {
  it('inserts a new point and keeps the lane beat-sorted', () => {
    const result = upsertPoint([{ beat: 0, value: 0 }, { beat: 8, value: 1 }], { beat: 4, value: 0.5 })
    expect(result.map((p) => p.beat)).toEqual([0, 4, 8])
  })

  it('replaces an existing point at the same beat', () => {
    expect(upsertPoint([{ beat: 4, value: 0 }], { beat: 4, value: -6 })).toEqual([{ beat: 4, value: -6 }])
  })

  it('does not mutate the input array', () => {
    const input = [{ beat: 0, value: 0 }]
    upsertPoint(input, { beat: 2, value: 1 })
    expect(input).toEqual([{ beat: 0, value: 0 }])
  })
})

describe('writeLanePoint', () => {
  it('creates a per-track lane carrying its trackId', () => {
    const lanes = writeLanePoint([], 'trackGain', 't1', { beat: 0, value: -6 })
    expect(lanes).toEqual([{ target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }] }])
  })

  it('creates a master lane without a trackId', () => {
    const lanes = writeLanePoint([], 'masterGain', undefined, { beat: 0, value: -3 })
    expect(lanes).toEqual([{ target: 'masterGain', points: [{ beat: 0, value: -3 }] }])
    expect('trackId' in lanes[0]).toBe(false)
  })

  it('replaces a point at the same beat and keeps points sorted', () => {
    let lanes = writeLanePoint([], 'trackGain', 't1', { beat: 4, value: 0 })
    lanes = writeLanePoint(lanes, 'trackGain', 't1', { beat: 0, value: -6 })
    lanes = writeLanePoint(lanes, 'trackGain', 't1', { beat: 4, value: -2 }) // replace @4
    expect(lanes).toHaveLength(1)
    expect(lanes[0].points).toEqual([{ beat: 0, value: -6 }, { beat: 4, value: -2 }])
  })

  it('keeps per-track lanes separate by trackId and target', () => {
    let lanes = writeLanePoint([], 'trackGain', 't1', { beat: 0, value: -6 })
    lanes = writeLanePoint(lanes, 'trackPan', 't1', { beat: 0, value: 0.5 })
    lanes = writeLanePoint(lanes, 'trackGain', 't2', { beat: 0, value: 0 })
    expect(lanes).toHaveLength(3)
  })

  it('clamps the value to the target range and the beat to >= 0', () => {
    const gain = writeLanePoint([], 'trackGain', 't1', { beat: -3, value: 999 })
    expect(gain[0].points).toEqual([{ beat: 0, value: 6 }])
    const pan = writeLanePoint([], 'trackPan', 't1', { beat: 2, value: -9 })
    expect(pan[0].points).toEqual([{ beat: 2, value: -1 }])
  })

  it('does not mutate the input lanes', () => {
    const input: AutomationLane[] = [{ target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: 0 }] }]
    writeLanePoint(input, 'trackGain', 't1', { beat: 2, value: -6 })
    expect(input[0].points).toEqual([{ beat: 0, value: 0 }])
  })
})

describe('removeLanePoint', () => {
  it('removes a point and keeps the lane when others remain', () => {
    const lanes: AutomationLane[] = [
      { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }, { beat: 4, value: 0 }] },
    ]
    const result = removeLanePoint(lanes, 'trackGain', 't1', 0)
    expect(result[0].points).toEqual([{ beat: 4, value: 0 }])
  })

  it('drops the lane when its last point is removed', () => {
    const lanes: AutomationLane[] = [
      { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }] },
      { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
    ]
    const result = removeLanePoint(lanes, 'trackGain', 't1', 0)
    expect(result).toEqual([{ target: 'masterGain', points: [{ beat: 0, value: -2 }] }])
  })

  it('is a no-op for a missing beat', () => {
    const lanes: AutomationLane[] = [
      { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }] },
    ]
    expect(removeLanePoint(lanes, 'trackGain', 't1', 99)).toEqual(lanes)
  })
})

describe('clearLane / clearTrackLanes', () => {
  const lanes: AutomationLane[] = [
    { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }] },
    { target: 'trackPan', trackId: 't1', points: [{ beat: 0, value: 0.5 }] },
    { target: 'trackGain', trackId: 't2', points: [{ beat: 0, value: 0 }] },
    { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
  ]

  it('removes a single matching lane', () => {
    const result = clearLane(lanes, 'trackGain', 't1')
    expect(result).toHaveLength(3)
    expect(result.some((l) => l.target === 'trackGain' && l.trackId === 't1')).toBe(false)
  })

  it('removes the master lane when trackId is omitted', () => {
    expect(clearLane(lanes, 'masterGain')).toHaveLength(3)
  })

  it('removes every lane belonging to a track', () => {
    const result = clearTrackLanes(lanes, 't1')
    expect(result.map((l) => l.trackId)).toEqual(['t2', undefined])
  })
})

describe('sanitizeAutomation', () => {
  it('returns [] for non-array / legacy input', () => {
    expect(sanitizeAutomation(undefined)).toEqual([])
    expect(sanitizeAutomation(null)).toEqual([])
    expect(sanitizeAutomation({})).toEqual([])
  })

  it('drops unknown targets, empty lanes, and track lanes without a trackId', () => {
    const result = sanitizeAutomation([
      { target: 'reverbMix', trackId: 't1', points: [{ beat: 0, value: 1 }] }, // unknown
      { target: 'trackGain', trackId: 't1', points: [] }, // empty
      { target: 'trackGain', points: [{ beat: 0, value: 0 }] }, // missing trackId
      { target: 'masterGain', points: [{ beat: 0, value: -2 }] }, // valid
    ])
    expect(result).toEqual([{ target: 'masterGain', points: [{ beat: 0, value: -2 }] }])
  })

  it('clamps values, drops non-finite points, dedupes beats, and sorts', () => {
    const result = sanitizeAutomation([
      {
        target: 'trackGain',
        trackId: 't1',
        points: [
          { beat: 8, value: 0 },
          { beat: 0, value: 999 }, // clamp -> 6
          { beat: 0, value: -3 }, // later dup at beat 0 wins
          { beat: 4, value: Number.NaN }, // dropped
          { beat: -2, value: 2 }, // beat clamped -> 0 ... dedupes with beat 0 (this is last -> wins)
        ],
      },
    ])
    // Beats 0 and -2 both normalize to 0; the last one written wins (value 2).
    expect(result).toEqual([
      { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: 2 }, { beat: 8, value: 0 }] },
    ])
  })

  it('preserves valid track and master lanes', () => {
    const input = [
      { target: 'trackPan', trackId: 't1', points: [{ beat: 2, value: 0.5 }] },
      { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
    ]
    expect(sanitizeAutomation(input)).toEqual(input)
  })
})
