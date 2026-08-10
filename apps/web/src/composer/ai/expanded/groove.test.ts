import { describe, expect, it } from 'vitest'
import { GROOVE_PRESETS, applyGroove, findGroovePreset } from './groove'
import type { GrooveParams, SuggestedNote } from './types'

const phrase: SuggestedNote[] = [
  { pitch: 60, start: 0, duration: 0.5, velocity: 0.7 },
  { pitch: 62, start: 0.5, duration: 0.5, velocity: 0.7 }, // off-beat eighth
  { pitch: 64, start: 1, duration: 0.5, velocity: 0.7 },
  { pitch: 65, start: 1.5, duration: 0.5, velocity: 0.7 }, // off-beat eighth
]

function groove(overrides: Partial<GrooveParams> = {}): GrooveParams {
  return { swing: 0, humanizeTiming: 0, humanizeVelocity: 0, seed: 42, ...overrides }
}

describe('groove / humanize', () => {
  it('exposes named presets', () => {
    expect(GROOVE_PRESETS.length).toBeGreaterThanOrEqual(5)
    expect(GROOVE_PRESETS.map((p) => p.id)).toContain('swing-8')
  })

  it('preserves note count and pitches', () => {
    const out = applyGroove(phrase, groove({ swing: 0.5, humanizeTiming: 0.2, humanizeVelocity: 0.2 }))
    expect(out).toHaveLength(phrase.length)
    expect(out.map((n) => n.pitch)).toEqual(phrase.map((n) => n.pitch))
  })

  it('is a no-op on timing when all params are zero', () => {
    const out = applyGroove(phrase, groove())
    expect(out.map((n) => n.start)).toEqual(phrase.map((n) => n.start))
    expect(out.map((n) => n.velocity)).toEqual(phrase.map((n) => n.velocity))
  })

  it('swing delays off-beat eighths but not down-beats', () => {
    const out = applyGroove(phrase, groove({ swing: 1 }))
    expect(out[0].start).toBe(0) // down-beat unchanged
    expect(out[1].start).toBeGreaterThan(0.5) // off-beat delayed
    expect(out[2].start).toBe(1) // down-beat unchanged
    expect(out[3].start).toBeGreaterThan(1.5) // off-beat delayed
  })

  it('is deterministic for a given seed', () => {
    const params = groove({ humanizeTiming: 0.5, humanizeVelocity: 0.5 })
    expect(applyGroove(phrase, params)).toEqual(applyGroove(phrase, params))
  })

  it('produces different jitter for different seeds', () => {
    const a = applyGroove(phrase, groove({ humanizeTiming: 0.5, seed: 1 }))
    const b = applyGroove(phrase, groove({ humanizeTiming: 0.5, seed: 2 }))
    expect(a.map((n) => n.start)).not.toEqual(b.map((n) => n.start))
  })

  it('assigns jitter by musical position regardless of input order', () => {
    const reversed = [...phrase].reverse()
    const params = groove({ humanizeTiming: 0.4, humanizeVelocity: 0.4 })
    const forward = applyGroove(phrase, params)
    const back = applyGroove(reversed, params)
    // Match notes by pitch; the same note gets the same grooved start either way.
    for (const note of forward) {
      const twin = back.find((n) => n.pitch === note.pitch)
      expect(twin?.start).toBeCloseTo(note.start, 10)
      expect(twin?.velocity).toBeCloseTo(note.velocity, 10)
    }
  })

  it('never yields negative starts and clamps velocity', () => {
    const loud: SuggestedNote[] = [{ pitch: 60, start: 0, duration: 1, velocity: 0.99 }]
    for (const preset of GROOVE_PRESETS) {
      const out = applyGroove(loud, { ...preset, seed: 7 })
      for (const note of out) {
        expect(note.start).toBeGreaterThanOrEqual(0)
        expect(note.velocity).toBeGreaterThanOrEqual(0.05)
        expect(note.velocity).toBeLessThanOrEqual(1)
      }
    }
  })

  it('findGroovePreset resolves known ids and rejects unknown ones', () => {
    expect(findGroovePreset('tight')?.name).toBe('Tight')
    expect(findGroovePreset('nope')).toBeUndefined()
  })
})
