import { describe, expect, it } from 'vitest'
import { STYLES, applyStyle, findStyle } from './styleTransfer'
import type { SuggestedNote } from './types'

const phrase: SuggestedNote[] = [
  { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
  { pitch: 62, start: 0.5, duration: 0.5, velocity: 0.8 }, // off-beat eighth
  { pitch: 64, start: 1, duration: 1, velocity: 0.8 },
  { pitch: 67, start: 2, duration: 2, velocity: 0.8 },
]

describe('style transfer', () => {
  it('exposes four named styles', () => {
    expect(STYLES).toHaveLength(4)
    expect(STYLES.map((s) => s.id)).toEqual(['lofi', 'jazz-swing', 'cinematic', 'edm'])
  })

  it('preserves note count and pitch content for every style', () => {
    for (const style of STYLES) {
      const out = applyStyle(phrase, style.id)
      expect(out).toHaveLength(phrase.length)
      expect(out.map((n) => n.pitch)).toEqual(phrase.map((n) => n.pitch))
    }
  })

  it('does not mutate the input', () => {
    const snapshot = JSON.parse(JSON.stringify(phrase))
    applyStyle(phrase, 'edm')
    expect(phrase).toEqual(snapshot)
  })

  it('is deterministic', () => {
    expect(applyStyle(phrase, 'jazz-swing')).toEqual(applyStyle(phrase, 'jazz-swing'))
  })

  it('lo-fi softens velocities and extends durations', () => {
    const out = applyStyle(phrase, 'lofi')
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i].velocity).toBeLessThan(phrase[i].velocity)
      expect(out[i].duration).toBeGreaterThan(phrase[i].duration)
    }
  })

  it('jazz swing delays off-beat eighths', () => {
    const out = applyStyle(phrase, 'jazz-swing')
    // Index 1 is the off-beat eighth at 0.5 — it should move later.
    expect(out[1].start).toBeGreaterThan(phrase[1].start)
    // Down-beat notes keep their start.
    expect(out[0].start).toBe(phrase[0].start)
  })

  it('cinematic lengthens durations', () => {
    const out = applyStyle(phrase, 'cinematic')
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i].duration).toBeGreaterThan(phrase[i].duration)
    }
  })

  it('edm hard-quantizes to the sixteenth grid and shortens notes', () => {
    const swung: SuggestedNote[] = [{ pitch: 60, start: 0.31, duration: 2, velocity: 0.5 }]
    const out = applyStyle(swung, 'edm')
    expect(out[0].start).toBe(0.25)
    expect(out[0].duration).toBeLessThanOrEqual(0.25)
  })

  it('never yields negative starts or zero-length notes', () => {
    for (const style of STYLES) {
      for (const note of applyStyle(phrase, style.id)) {
        expect(note.start).toBeGreaterThanOrEqual(0)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.velocity).toBeGreaterThan(0)
        expect(note.velocity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('findStyle resolves known ids and rejects unknown ones', () => {
    expect(findStyle('lofi')?.name).toBe('Lo-fi')
    expect(findStyle('nope')).toBeUndefined()
  })
})
