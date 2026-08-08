import { describe, expect, it, vi } from 'vitest'
import {
  BEATS_PER_BAR,
  DEFAULT_PPQ,
  DEFAULT_TEMPO,
  SCHEMA_VERSION,
  TRACK_COLORS,
  createDemoProject,
  createEmptyProject,
  createNote,
  createTrack,
  isBlackKey,
  newId,
  pitchToName,
  trackColorForIndex,
} from './project'

describe('newId', () => {
  it('uses crypto.randomUUID when available and prefixes the value', () => {
    const id = newId('note')
    expect(id.startsWith('note_')).toBe(true)
    expect(id.length).toBeGreaterThan('note_'.length)
  })

  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId()))
    expect(ids.size).toBe(50)
  })

  it('falls back to Math.random when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {})
    const id = newId('x')
    expect(id.startsWith('x_')).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('pitchToName', () => {
  it('names middle C as C4', () => {
    expect(pitchToName(60)).toBe('C4')
  })

  it('names sharps and octaves', () => {
    expect(pitchToName(61)).toBe('C#4')
    expect(pitchToName(69)).toBe('A4')
    expect(pitchToName(21)).toBe('A0')
    expect(pitchToName(108)).toBe('C8')
  })
})

describe('isBlackKey', () => {
  it('classifies black and white keys', () => {
    expect(isBlackKey(61)).toBe(true) // C#4
    expect(isBlackKey(60)).toBe(false) // C4
    expect(isBlackKey(66)).toBe(true) // F#4
  })
})

describe('createNote', () => {
  it('fills defaults for duration and velocity', () => {
    const note = createNote({ pitch: 60, start: 0 }, 'note_1')
    expect(note).toEqual({
      id: 'note_1',
      pitch: 60,
      start: 0,
      duration: 1,
      velocity: 0.8,
    })
  })

  it('respects provided values', () => {
    const note = createNote({ pitch: 62, start: 2, duration: 0.5, velocity: 0.3 }, 'n')
    expect(note.duration).toBe(0.5)
    expect(note.velocity).toBe(0.3)
  })

  it('generates an id when none is supplied', () => {
    const note = createNote({ pitch: 60, start: 0 })
    expect(note.id.startsWith('note_')).toBe(true)
  })
})

describe('createTrack', () => {
  it('defaults to an empty poly-synth track', () => {
    const track = createTrack({}, 'track_1')
    expect(track.instrumentId).toBe('poly-synth')
    expect(track.notes).toEqual([])
    expect(track.muted).toBe(false)
    expect(track.color).toBe(TRACK_COLORS[0])
  })

  it('honors overrides', () => {
    const track = createTrack(
      { name: 'Bass', instrumentId: 'fm-synth', color: '#fff', muted: true },
      't',
    )
    expect(track).toMatchObject({
      name: 'Bass',
      instrumentId: 'fm-synth',
      color: '#fff',
      muted: true,
    })
  })
})

describe('trackColorForIndex', () => {
  it('cycles through the palette', () => {
    expect(trackColorForIndex(0)).toBe(TRACK_COLORS[0])
    expect(trackColorForIndex(TRACK_COLORS.length)).toBe(TRACK_COLORS[0])
    expect(trackColorForIndex(1)).toBe(TRACK_COLORS[1])
  })
})

describe('createEmptyProject', () => {
  it('has current schema, defaults, and one empty synth track', () => {
    const project = createEmptyProject('p1')
    expect(project.id).toBe('p1')
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(project.tempo).toBe(DEFAULT_TEMPO)
    expect(project.ppq).toBe(DEFAULT_PPQ)
    expect(project.tracks).toHaveLength(1)
    expect(project.tracks[0].notes).toEqual([])
    expect(project.loop.enabled).toBe(false)
  })
})

describe('createDemoProject', () => {
  it('ships two tracks with notes so first-run is not blank', () => {
    const project = createDemoProject('demo')
    expect(project.tracks).toHaveLength(2)
    const [synth, drums] = project.tracks
    expect(synth.instrumentId).toBe('poly-synth')
    expect(synth.notes.length).toBeGreaterThan(0)
    expect(drums.instrumentId).toBe('drum-kit')
    expect(drums.notes.length).toBeGreaterThan(0)
    expect(project.loop.enabled).toBe(true)
    expect(project.lengthBeats).toBe(BEATS_PER_BAR * 2)
  })

  it('places a kick on every beat', () => {
    const drums = createDemoProject().tracks[1]
    const kicks = drums.notes.filter((n) => n.pitch === 36)
    expect(kicks).toHaveLength(8)
  })
})
