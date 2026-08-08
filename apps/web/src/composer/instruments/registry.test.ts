import { describe, expect, it } from 'vitest'
import {
  DRUM_MAP,
  INSTRUMENTS,
  drumLabel,
  getInstrument,
} from './registry'

describe('INSTRUMENTS registry', () => {
  it('offers at least two selectable instruments', () => {
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(2)
  })

  it('has unique ids and non-empty metadata', () => {
    const ids = INSTRUMENTS.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const inst of INSTRUMENTS) {
      expect(inst.name.length).toBeGreaterThan(0)
      expect(inst.description.length).toBeGreaterThan(0)
    }
  })

  it('includes both a synth and a drum instrument', () => {
    const kinds = new Set(INSTRUMENTS.map((i) => i.kind))
    expect(kinds.has('synth')).toBe(true)
    expect(kinds.has('drum')).toBe(true)
  })
})

describe('getInstrument', () => {
  it('resolves a known id', () => {
    expect(getInstrument('fm-synth').name).toBe('FM Synth')
  })

  it('falls back to the first instrument for an unknown id', () => {
    // deliberately cast an invalid id to exercise the fallback branch
    expect(getInstrument('mystery' as never).id).toBe('poly-synth')
  })
})

describe('drumLabel', () => {
  it('names mapped drum pitches', () => {
    expect(drumLabel(36)).toBe('Kick')
    expect(drumLabel(38)).toBe('Snare')
    expect(DRUM_MAP[42]).toBe('Closed Hat')
  })

  it('returns undefined for unmapped pitches', () => {
    expect(drumLabel(60)).toBeUndefined()
  })
})
