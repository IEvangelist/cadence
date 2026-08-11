import { describe, expect, it } from 'vitest'
import {
  DRUM_MAP,
  drumLabel,
  getInstrument,
  listInstruments,
} from './registry'

describe('INSTRUMENTS registry', () => {
  it('offers at least two selectable instruments', () => {
    expect(listInstruments().length).toBeGreaterThanOrEqual(2)
  })

  it('has unique ids and non-empty metadata', () => {
    const instruments = listInstruments()
    const ids = instruments.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const inst of instruments) {
      expect(inst.name.length).toBeGreaterThan(0)
      expect(inst.description.length).toBeGreaterThan(0)
    }
  })

  it('includes both a synth and a drum instrument', () => {
    const kinds = new Set(listInstruments().map((i) => i.kind))
    expect(kinds.has('synth')).toBe(true)
    expect(kinds.has('drum')).toBe(true)
  })

  it('exposes a large, grouped built-in catalog', () => {
    // The Studio Pro library grew the built-ins into a broad, professional
    // palette; guard both the size and that every entry is picker-groupable.
    const instruments = listInstruments()
    expect(instruments.length).toBeGreaterThanOrEqual(40)
    for (const inst of instruments) {
      expect(inst.group).toBeTruthy()
    }
  })

  it('resolves representative ids from each added family to themselves', () => {
    // These ids persist inside saved projects, so each must resolve back to
    // itself (not fall through to the poly-synth default).
    for (const id of [
      'grand-piano',
      'nylon-guitar',
      'upright-bass',
      'violin',
      'trumpet',
      'vibraphone',
      'timpani',
      'drum-kit-trap',
    ]) {
      expect(getInstrument(id).id).toBe(id)
    }
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
