import { describe, expect, it } from 'vitest'
import { generateMotif } from './textToMotif'
import { interpretPrompt } from './prompt'
import { type MotifParams, SCALES } from './types'

function params(overrides: Partial<MotifParams> = {}): MotifParams {
  return {
    root: 0,
    scale: 'major',
    octave: 4,
    density: 2,
    lengthBeats: 8,
    energy: 0.5,
    seed: 123456,
    ...overrides,
  }
}

describe('generateMotif', () => {
  it('is deterministic for identical params', () => {
    expect(generateMotif(params())).toEqual(generateMotif(params()))
  })

  it('produces at least one note', () => {
    expect(generateMotif(params()).length).toBeGreaterThan(0)
  })

  it('always returns a note even for the sparsest, shortest request', () => {
    const notes = generateMotif(params({ density: 1, lengthBeats: 2, energy: 0.1, seed: 1 }))
    expect(notes.length).toBeGreaterThanOrEqual(1)
  })

  it('keeps pitches in MIDI range and velocities in 0.1..1', () => {
    for (const note of generateMotif(params({ energy: 1 }))) {
      expect(note.pitch).toBeGreaterThanOrEqual(0)
      expect(note.pitch).toBeLessThanOrEqual(127)
      expect(note.velocity).toBeGreaterThanOrEqual(0.1)
      expect(note.velocity).toBeLessThanOrEqual(1)
      expect(note.duration).toBeGreaterThan(0)
    }
  })

  it('is monophonic: notes never overlap', () => {
    const notes = generateMotif(params({ density: 4, lengthBeats: 16 }))
    for (let i = 1; i < notes.length; i += 1) {
      const prev = notes[i - 1]
      expect(notes[i].start).toBeGreaterThanOrEqual(prev.start + prev.duration - 1e-9)
    }
  })

  it('anchors notes at regionStart', () => {
    const notes = generateMotif(params(), { regionStart: 10 })
    for (const note of notes) expect(note.start).toBeGreaterThanOrEqual(10)
    expect(notes[0].start).toBeGreaterThanOrEqual(10)
  })

  it('stays within the requested length window', () => {
    const lengthBeats = 8
    const notes = generateMotif(params({ lengthBeats, density: 4 }), { regionStart: 0 })
    for (const note of notes) {
      expect(note.start).toBeLessThan(lengthBeats)
    }
  })

  it('produces on-scale pitches for a mid-range root (no clamping)', () => {
    const scale = SCALES.minor
    const notes = generateMotif(params({ scale: 'minor', root: 2, octave: 4 }))
    const root = (4 + 1) * 12 + 2
    for (const note of notes) {
      const degree = ((note.pitch - root) % 12 + 12) % 12
      expect(scale).toContain(degree)
    }
  })

  it('varies across seeds', () => {
    const a = generateMotif(params({ seed: 1 }))
    const b = generateMotif(params({ seed: 999999 }))
    expect(a).not.toEqual(b)
  })

  it('integrates with interpretPrompt end-to-end', () => {
    const motif = generateMotif(interpretPrompt('a fast energetic melody in d minor'))
    expect(motif.length).toBeGreaterThan(0)
  })
})
