import { describe, expect, it } from 'vitest'
import { type MidiCapture, recordedNoteFrom } from './record'
import { MIN_NOTE_DURATION } from '../model/reducer'

const capture = (over: Partial<MidiCapture> = {}): MidiCapture => ({
  trackId: 'track_1',
  pitch: 60,
  startBeat: 2,
  velocity: 100,
  ...over,
})

describe('recordedNoteFrom', () => {
  it('uses transport-relative start and played duration, normalizing velocity', () => {
    const note = recordedNoteFrom(capture({ startBeat: 2, velocity: 127 }), 4)
    expect(note).toEqual({ pitch: 60, start: 2, duration: 2, velocity: 1 })
  })

  it('does not quantize by default (feel preserved)', () => {
    const note = recordedNoteFrom(capture({ startBeat: 2.1 }), 4)
    expect(note.start).toBeCloseTo(2.1, 5)
  })

  it('snaps only the start when quantize is opted in, keeping played length', () => {
    const note = recordedNoteFrom(capture({ startBeat: 2.1 }), 4, { enabled: true, grid: 1 })
    expect(note.start).toBe(2)
    // Duration is measured from the raw (unsnapped) start, not the snapped one.
    expect(note.duration).toBeCloseTo(1.9, 5)
  })

  it('floors very short notes to the minimum duration', () => {
    const note = recordedNoteFrom(capture({ startBeat: 2 }), 2.01)
    expect(note.duration).toBe(MIN_NOTE_DURATION)
  })

  it('guards a transport loop-wrap (end behind start) with the minimum duration', () => {
    const note = recordedNoteFrom(capture({ startBeat: 3 }), 1)
    expect(note.duration).toBe(MIN_NOTE_DURATION)
    expect(note.start).toBe(3)
  })

  it('clamps a negative start to zero', () => {
    const note = recordedNoteFrom(capture({ startBeat: -1 }), 1)
    expect(note.start).toBe(0)
  })
})
