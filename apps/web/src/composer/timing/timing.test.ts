import { describe, expect, it } from 'vitest'
import { MAX_PITCH, MIN_PITCH } from '../model/project'
import {
  DEFAULT_LAYOUT,
  PITCH_ROWS,
  beatToX,
  beatsToBarsBeatsSixteenths,
  beatsToSeconds,
  noteRect,
  pitchToRow,
  playheadBeat,
  rowToPitch,
  secondsPerBeat,
  secondsToBeats,
  snap,
  snapFloor,
  xToBeat,
  yToPitch,
} from './timing'

describe('tempo conversions', () => {
  it('computes seconds per beat', () => {
    expect(secondsPerBeat(120)).toBe(0.5)
    expect(secondsPerBeat(60)).toBe(1)
  })

  it('converts beats <-> seconds symmetrically', () => {
    expect(beatsToSeconds(4, 120)).toBe(2)
    expect(secondsToBeats(2, 120)).toBe(4)
    expect(secondsToBeats(beatsToSeconds(3.5, 90), 90)).toBeCloseTo(3.5)
  })
})

describe('snap', () => {
  it('snaps to the nearest division', () => {
    expect(snap(0.3, 0.25)).toBe(0.25)
    expect(snap(0.4, 0.25)).toBe(0.5)
    expect(snap(1.1, 1)).toBe(1)
  })

  it('floors when requested', () => {
    expect(snapFloor(0.9, 0.5)).toBe(0.5)
    expect(snapFloor(1.9, 1)).toBe(1)
  })

  it('never returns negative and passes through when grid <= 0', () => {
    expect(snap(-5, 0.25)).toBe(0)
    expect(snap(2.345, 0)).toBe(2.345)
    expect(snapFloor(2.345, 0)).toBe(2.345)
    expect(snapFloor(-1, 0)).toBe(0)
  })
})

describe('pitch <-> row', () => {
  it('puts the highest pitch at the top row', () => {
    expect(pitchToRow(MAX_PITCH)).toBe(0)
    expect(pitchToRow(MIN_PITCH)).toBe(PITCH_ROWS - 1)
  })

  it('inverts and clamps to the piano range', () => {
    expect(rowToPitch(0)).toBe(MAX_PITCH)
    expect(rowToPitch(PITCH_ROWS - 1)).toBe(MIN_PITCH)
    expect(rowToPitch(-100)).toBe(MAX_PITCH)
    expect(rowToPitch(9999)).toBe(MIN_PITCH)
  })
})

describe('pixel geometry', () => {
  it('maps beats and x symmetrically', () => {
    expect(beatToX(2)).toBe(2 * DEFAULT_LAYOUT.beatWidth)
    expect(xToBeat(DEFAULT_LAYOUT.beatWidth * 3)).toBe(3)
    expect(xToBeat(-10)).toBe(0)
  })

  it('maps y to pitch via the row height', () => {
    expect(yToPitch(0)).toBe(MAX_PITCH)
    expect(yToPitch(DEFAULT_LAYOUT.rowHeight)).toBe(MAX_PITCH - 1)
  })

  it('produces a note rectangle with a minimum width', () => {
    const rect = noteRect({ pitch: MAX_PITCH, start: 1, duration: 2 })
    expect(rect.left).toBe(DEFAULT_LAYOUT.beatWidth)
    expect(rect.top).toBe(0)
    expect(rect.width).toBe(2 * DEFAULT_LAYOUT.beatWidth)
    expect(rect.height).toBe(DEFAULT_LAYOUT.rowHeight)

    const tiny = noteRect({ pitch: MAX_PITCH, start: 0, duration: 0 })
    expect(tiny.width).toBe(2)
  })
})

describe('playheadBeat', () => {
  it('tracks linear time with no loop', () => {
    expect(playheadBeat(1, 120)).toBe(2)
    expect(playheadBeat(-1, 120)).toBe(0)
  })

  it('wraps within an active loop', () => {
    const loop = { enabled: true, start: 4, end: 8 }
    // 6 beats elapsed -> inside first pass
    expect(playheadBeat(beatsToSeconds(6, 120), 120, loop)).toBe(6)
    // 10 beats elapsed -> wrapped: 4 + ((10-4) % 4) = 6
    expect(playheadBeat(beatsToSeconds(10, 120), 120, loop)).toBe(6)
    // before the loop start it stays linear
    expect(playheadBeat(beatsToSeconds(2, 120), 120, loop)).toBe(2)
  })

  it('ignores a disabled or empty loop', () => {
    expect(playheadBeat(beatsToSeconds(10, 120), 120, { enabled: false, start: 0, end: 4 })).toBe(10)
    expect(playheadBeat(beatsToSeconds(10, 120), 120, { enabled: true, start: 4, end: 4 })).toBe(10)
  })
})

describe('beatsToBarsBeatsSixteenths', () => {
  it('formats whole beats', () => {
    expect(beatsToBarsBeatsSixteenths(0)).toBe('0:0:0')
    expect(beatsToBarsBeatsSixteenths(4)).toBe('1:0:0')
    expect(beatsToBarsBeatsSixteenths(6)).toBe('1:2:0')
  })

  it('formats sub-beat (sixteenth) positions', () => {
    expect(beatsToBarsBeatsSixteenths(2.5)).toBe('0:2:2')
    expect(beatsToBarsBeatsSixteenths(0.25)).toBe('0:0:1')
  })

  it('clamps negatives to zero', () => {
    expect(beatsToBarsBeatsSixteenths(-2)).toBe('0:0:0')
  })
})
