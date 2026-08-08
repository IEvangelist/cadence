import { describe, expect, it } from 'vitest'
import {
  STEPS_PER_QUARTER,
  beatsToSteps,
  midiToVelocity,
  noteSequenceToNotes,
  notesToNoteSequence,
  stepsToBeats,
  velocityToMidi,
} from './noteSequence'
import type { SuggestedNote } from './types'

describe('velocity mapping', () => {
  it('round-trips normalized velocity within one MIDI step', () => {
    for (const v of [0, 0.2, 0.5, 0.6, 0.8, 1]) {
      const back = midiToVelocity(velocityToMidi(v))
      expect(Math.abs(back - v)).toBeLessThanOrEqual(1 / 127 + 1e-9)
    }
  })

  it('never emits a silent (0) MIDI velocity for an audible note', () => {
    expect(velocityToMidi(0)).toBeGreaterThanOrEqual(1)
    expect(velocityToMidi(1)).toBe(127)
  })

  it('defaults missing MIDI velocity to a musical value', () => {
    expect(midiToVelocity(undefined)).toBeCloseTo(0.8, 5)
  })
})

describe('beats <-> steps', () => {
  it('is exact for grid-aligned beats', () => {
    expect(beatsToSteps(1)).toBe(STEPS_PER_QUARTER)
    expect(beatsToSteps(0.25)).toBe(1)
    expect(stepsToBeats(4)).toBe(1)
    expect(stepsToBeats(1)).toBe(0.25)
  })
})

describe('notesToNoteSequence', () => {
  it('quantizes, shifts to the origin, and records tempo + length', () => {
    const notes: SuggestedNote[] = [
      { pitch: 60, start: 2, duration: 1, velocity: 0.8 },
      { pitch: 64, start: 3, duration: 1, velocity: 0.6 },
    ]
    const seq = notesToNoteSequence(notes, { tempo: 120 })

    // Earliest note (beat 2) becomes step 0.
    expect(seq.notes[0]).toMatchObject({
      pitch: 60,
      quantizedStartStep: 0,
      quantizedEndStep: 4,
    })
    expect(seq.notes[1]).toMatchObject({
      pitch: 64,
      quantizedStartStep: 4,
      quantizedEndStep: 8,
    })
    expect(seq.quantizationInfo.stepsPerQuarter).toBe(STEPS_PER_QUARTER)
    expect(seq.totalQuantizedSteps).toBe(8)
    expect(seq.tempos).toEqual([{ time: 0, qpm: 120 }])
  })

  it('gives a zero-duration note at least one step', () => {
    const seq = notesToNoteSequence([{ pitch: 60, start: 0, duration: 0, velocity: 0.8 }])
    expect(seq.notes[0].quantizedEndStep).toBe(seq.notes[0].quantizedStartStep + 1)
  })

  it('honours an explicit origin and total length', () => {
    const seq = notesToNoteSequence([{ pitch: 60, start: 4, duration: 2, velocity: 0.5 }], {
      originBeats: 0,
      totalBeats: 8,
    })
    expect(seq.notes[0].quantizedStartStep).toBe(16)
    expect(seq.totalQuantizedSteps).toBe(32)
  })

  it('produces an empty sequence for no notes', () => {
    const seq = notesToNoteSequence([])
    expect(seq.notes).toEqual([])
    expect(seq.totalQuantizedSteps).toBe(0)
  })
})

describe('round-trip: notes -> NoteSequence -> notes', () => {
  it('preserves pitch and grid-aligned time, and velocity within quantization', () => {
    // All starts/durations are multiples of 1/4 beat, so time is lossless.
    const original: SuggestedNote[] = [
      { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
      { pitch: 62, start: 1, duration: 0.5, velocity: 0.6 },
      { pitch: 67, start: 1.5, duration: 0.25, velocity: 1 },
      { pitch: 72, start: 2, duration: 2, velocity: 0.4 },
    ]

    const seq = notesToNoteSequence(original, { originBeats: 0 })
    const round = noteSequenceToNotes(seq, { originBeats: 0 })

    expect(round).toHaveLength(original.length)
    original.forEach((note, i) => {
      expect(round[i].pitch).toBe(note.pitch)
      expect(round[i].start).toBeCloseTo(note.start, 10)
      expect(round[i].duration).toBeCloseTo(note.duration, 10)
      expect(Math.abs(round[i].velocity - note.velocity)).toBeLessThanOrEqual(1 / 127 + 1e-9)
    })
  })

  it('re-anchors to a non-zero origin so notes return to their timeline slot', () => {
    const original: SuggestedNote[] = [
      { pitch: 60, start: 8, duration: 1, velocity: 0.7 },
      { pitch: 64, start: 9, duration: 1, velocity: 0.7 },
    ]
    const origin = 8
    const seq = notesToNoteSequence(original, { originBeats: origin })
    const round = noteSequenceToNotes(seq, { originBeats: origin })

    expect(round.map((n) => n.start)).toEqual([8, 9])
    expect(round.map((n) => n.pitch)).toEqual([60, 64])
  })

  it('drops notes before fromStep (keeping only the generated tail)', () => {
    const seq = notesToNoteSequence(
      [
        { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
        { pitch: 62, start: 1, duration: 1, velocity: 0.8 },
        { pitch: 64, start: 2, duration: 1, velocity: 0.8 },
      ],
      { originBeats: 0 },
    )
    // Keep only notes starting at/after step 8 (beat 2).
    const tail = noteSequenceToNotes(seq, { originBeats: 0, fromStep: 8 })
    expect(tail).toHaveLength(1)
    expect(tail[0]).toMatchObject({ pitch: 64, start: 2 })
  })
})
