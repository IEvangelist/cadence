import { describe, expect, it } from 'vitest'
import { diatonicTriads, estimateKey, harmonize } from './harmony'
import type { SuggestedNote } from './types'

const mel = (pitches: number[], startAt = 0): SuggestedNote[] =>
  pitches.map((pitch, i) => ({
    pitch,
    start: startAt + i,
    duration: 1,
    velocity: 0.8,
  }))

describe('diatonicTriads', () => {
  it('builds the seven triads of C major', () => {
    const triads = diatonicTriads(0)
    expect(triads).toHaveLength(7)
    expect(triads[0]).toMatchObject({ roman: 'I', pitchClasses: [0, 4, 7] }) // C E G
    expect(triads[3]).toMatchObject({ roman: 'IV', pitchClasses: [5, 9, 0] }) // F A C
    expect(triads[4]).toMatchObject({ roman: 'V', pitchClasses: [7, 11, 2] }) // G B D
    expect(triads[5]).toMatchObject({ roman: 'vi', pitchClasses: [9, 0, 4] }) // A C E
  })

  it('transposes with the tonic', () => {
    // G major tonic triad is G B D.
    expect(diatonicTriads(7)[0].pitchClasses).toEqual([7, 11, 2])
  })
})

describe('estimateKey', () => {
  it('detects C major from a C-major melody', () => {
    expect(estimateKey(mel([60, 62, 64, 65, 67, 69, 71, 72]))).toBe(0)
  })

  it('detects G major from a G-major melody (contains F#)', () => {
    expect(estimateKey(mel([67, 69, 71, 72, 74, 76, 78, 79]))).toBe(7)
  })
})

describe('harmonize', () => {
  it('returns nothing for an empty melody', () => {
    expect(harmonize([])).toEqual([])
  })

  it('emits one diatonic triad per bar spanning the melody', () => {
    // Two bars of C-major melody.
    const melody = mel([60, 62, 64, 65, 67, 69, 71, 72])
    const chords = harmonize(melody, { beatsPerChord: 4 })

    // 8 beats / 4 = 2 chords × 3 tones = 6 notes.
    expect(chords).toHaveLength(6)

    const firstChord = chords.filter((n) => n.start === 0)
    expect(firstChord).toHaveLength(3)
    // Chord tones voiced from C3 (48) upward.
    for (const note of chords) {
      expect(note.pitch).toBeGreaterThanOrEqual(48)
      expect(note.pitch).toBeLessThan(72)
      expect(note.duration).toBe(4)
      expect(note.velocity).toBeGreaterThan(0)
    }
  })

  it('picks the tonic triad under a tonic-heavy bar', () => {
    // A bar dwelling on C, E, G should be harmonized with a C-major triad.
    const chords = harmonize(mel([60, 64, 67, 72]), { beatsPerChord: 4 })
    const pcs = new Set(chords.map((n) => ((n.pitch % 12) + 12) % 12))
    expect(pcs).toEqual(new Set([0, 4, 7]))
  })

  it('produces only valid, positive-duration notes', () => {
    const chords = harmonize(mel([60, 62, 64, 65, 67], 2), { beatsPerChord: 4 })
    for (const note of chords) {
      expect(Number.isFinite(note.pitch)).toBe(true)
      expect(note.pitch).toBeGreaterThanOrEqual(0)
      expect(note.pitch).toBeLessThanOrEqual(127)
      expect(note.duration).toBeGreaterThan(0)
      expect(note.start).toBeGreaterThanOrEqual(0)
    }
  })
})
