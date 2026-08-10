import { describe, expect, it } from 'vitest'
import { describeParams, interpretPrompt } from './prompt'
import { PITCH_CLASSES } from './types'

describe('interpretPrompt', () => {
  it('is deterministic for the same prompt', () => {
    expect(interpretPrompt('a bright happy melody')).toEqual(
      interpretPrompt('a bright happy melody'),
    )
  })

  it('maps sad/dark words to a minor scale', () => {
    expect(interpretPrompt('a sad, dark theme').scale).toBe('minor')
  })

  it('maps happy/bright words to a major scale', () => {
    expect(interpretPrompt('bright and happy').scale).toBe('major')
  })

  it('recognizes explicit modes', () => {
    expect(interpretPrompt('a dorian groove').scale).toBe('dorian')
    expect(interpretPrompt('mixolydian riff').scale).toBe('mixolydian')
    expect(interpretPrompt('bluesy lick').scale).toBe('blues')
    expect(interpretPrompt('folk tune').scale).toBe('pentatonic')
  })

  it('raises energy for high-energy words and lowers it for calm words', () => {
    expect(interpretPrompt('intense driving epic').energy).toBeGreaterThan(0.5)
    expect(interpretPrompt('calm gentle ambient').energy).toBeLessThan(0.5)
  })

  it('adjusts register from words', () => {
    expect(interpretPrompt('high bright sparkle').octave).toBe(5)
    expect(interpretPrompt('deep low bass').octave).toBe(3)
    expect(interpretPrompt('a plain melody').octave).toBe(4)
  })

  it('keeps density within 1..4', () => {
    const busy = interpretPrompt('busy dense frantic fast energetic')
    const sparse = interpretPrompt('sparse minimal slow simple')
    expect(busy.density).toBeGreaterThanOrEqual(1)
    expect(busy.density).toBeLessThanOrEqual(4)
    expect(sparse.density).toBeGreaterThanOrEqual(1)
    expect(sparse.density).toBeLessThanOrEqual(4)
    expect(busy.density).toBeGreaterThan(sparse.density)
  })

  it('parses an explicit key with accidentals when a scale word follows', () => {
    expect(interpretPrompt('melody in d minor').root).toBe(PITCH_CLASSES.indexOf('D'))
    expect(interpretPrompt('f# minor riff').root).toBe(PITCH_CLASSES.indexOf('F#'))
    expect(interpretPrompt('play in the key of g').root).toBe(PITCH_CLASSES.indexOf('G'))
  })

  it('does not treat stray note-letters in ordinary words as a key', () => {
    // "a bright melody" — the article "a" and letters inside "bright" must not
    // be read as an explicit key; the root falls back to the seed.
    const params = interpretPrompt('a bright melody')
    expect(params.root).toBe(params.seed % 12)
  })

  it('derives a stable root from the seed when no key is given', () => {
    const params = interpretPrompt('a mysterious motif')
    expect(params.root).toBeGreaterThanOrEqual(0)
    expect(params.root).toBeLessThanOrEqual(11)
  })

  it('adjusts length for short/long hints', () => {
    expect(interpretPrompt('a short idea').lengthBeats).toBe(4)
    expect(interpretPrompt('a long journey').lengthBeats).toBe(16)
    expect(interpretPrompt('an idea').lengthBeats).toBe(8)
  })

  it('handles an empty prompt without throwing', () => {
    const params = interpretPrompt('')
    expect(params.scale).toBe('major')
    expect(params.root).toBeGreaterThanOrEqual(0)
  })

  it('describeParams renders a readable key + scale', () => {
    const params = interpretPrompt('d minor')
    expect(describeParams(params)).toBe('D Minor')
  })
})
