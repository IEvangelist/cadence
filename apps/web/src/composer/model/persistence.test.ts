import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PPQ,
  DEFAULT_TEMPO,
  SCHEMA_VERSION,
  createDemoProject,
} from './project'
import {
  ProjectParseError,
  migrateProject,
  parseProject,
  serializeProject,
} from './persistence'

describe('serialize/parse round trip', () => {
  it('preserves a full project', () => {
    const project = createDemoProject('demo')
    const restored = parseProject(serializeProject(project))
    expect(restored).toEqual(project)
  })
})

describe('parseProject errors', () => {
  it('throws on invalid JSON', () => {
    expect(() => parseProject('{not json')).toThrow(ProjectParseError)
  })

  it('throws on non-object JSON', () => {
    expect(() => parseProject('42')).toThrow(ProjectParseError)
  })
})

describe('migrateProject', () => {
  it('upgrades a legacy document missing schemaVersion/loop/ppq', () => {
    const legacy = {
      id: 'old',
      name: 'Legacy',
      tempo: 90,
      tracks: [
        {
          id: 't',
          name: 'Keys',
          instrumentId: 'poly-synth',
          notes: [{ id: 'n', pitch: 62, start: 0, duration: 4 }],
        },
      ],
    }
    const project = migrateProject(legacy)
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(project.ppq).toBe(DEFAULT_PPQ)
    expect(project.tempo).toBe(90)
    // length grows to contain the 4-beat note (one bar).
    expect(project.lengthBeats).toBe(4)
    expect(project.loop.enabled).toBe(false)
    // missing velocity is defaulted.
    expect(project.tracks[0].notes[0].velocity).toBe(0.8)
  })

  it('coerces malformed fields to safe defaults', () => {
    const project = migrateProject({
      tracks: [
        {
          instrumentId: 'nonsense',
          notes: [{ pitch: 999, start: -5, duration: -1, velocity: 4 }],
        },
      ],
    })
    const note = project.tracks[0].notes[0]
    expect(project.tracks[0].instrumentId).toBe('poly-synth')
    // Pitch is rounded and clamped to the valid MIDI range 0–127 on load, so a
    // corrupted score can't inject an out-of-range pitch into live state.
    expect(note.pitch).toBe(127)
    expect(note.start).toBe(0)
    expect(note.duration).toBeGreaterThan(0)
    expect(note.velocity).toBe(1)
    expect(project.tempo).toBe(DEFAULT_TEMPO)
  })

  it('preserves a registry-known instrument id from the expanded library', () => {
    // Instruments contributed beyond the original three must round-trip through
    // load instead of being silently reset to the default poly synth. This is
    // the coercion that would otherwise break every newly added instrument.
    const project = migrateProject({
      tracks: [
        { instrumentId: 'electric-piano', notes: [] },
        { instrumentId: 'drum-kit-808', notes: [] },
        { instrumentId: 'grand-piano', notes: [] },
        { instrumentId: 'nylon-guitar', notes: [] },
        { instrumentId: 'saxophone', notes: [] },
        { instrumentId: 'drum-kit-trap', notes: [] },
      ],
    })
    expect(project.tracks[0].instrumentId).toBe('electric-piano')
    expect(project.tracks[1].instrumentId).toBe('drum-kit-808')
    expect(project.tracks[2].instrumentId).toBe('grand-piano')
    expect(project.tracks[3].instrumentId).toBe('nylon-guitar')
    expect(project.tracks[4].instrumentId).toBe('saxophone')
    expect(project.tracks[5].instrumentId).toBe('drum-kit-trap')
  })

  it('clamps a corrupted tempo into the playable range', () => {
    // Tempo 0 would make 60/bpm durations Infinity and freeze the playhead.
    expect(migrateProject({ tempo: 0 }).tempo).toBe(20)
    expect(migrateProject({ tempo: -40 }).tempo).toBe(20)
    expect(migrateProject({ tempo: 5000 }).tempo).toBe(300)
    // A valid stored tempo is preserved untouched.
    expect(migrateProject({ tempo: 128 }).tempo).toBe(128)
  })

  it('replaces a non-positive ppq to avoid divide-by-zero tick math', () => {
    expect(migrateProject({ ppq: 0 }).ppq).toBe(DEFAULT_PPQ)
    expect(migrateProject({ ppq: -1 }).ppq).toBe(DEFAULT_PPQ)
    expect(migrateProject({ ppq: 96 }).ppq).toBe(96)
  })

  it('supplies a default track when none exist', () => {
    const project = migrateProject({ name: 'Blank' })
    expect(project.tracks).toHaveLength(1)
    expect(project.tracks[0].notes).toEqual([])
  })

  it('rejects null', () => {
    expect(() => migrateProject(null)).toThrow(ProjectParseError)
  })
})

describe('automation persistence', () => {
  it('defaults a legacy document with no automation to an empty array', () => {
    expect(migrateProject({ name: 'Legacy' }).automation).toEqual([])
  })

  it('preserves and sanitizes valid automation lanes', () => {
    const project = migrateProject({
      name: 'Automated',
      tracks: [{ id: 't1', instrumentId: 'poly-synth', notes: [] }],
      automation: [
        { target: 'trackGain', trackId: 't1', points: [{ beat: 4, value: 0 }, { beat: 0, value: -6 }] },
        { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
      ],
    })
    expect(project.automation).toEqual([
      { target: 'trackGain', trackId: 't1', points: [{ beat: 0, value: -6 }, { beat: 4, value: 0 }] },
      { target: 'masterGain', points: [{ beat: 0, value: -2 }] },
    ])
  })

  it('drops malformed lanes and clamps out-of-range point values', () => {
    const project = migrateProject({
      automation: [
        { target: 'bogus', trackId: 't1', points: [{ beat: 0, value: 1 }] }, // unknown target
        { target: 'trackGain', points: [{ beat: 0, value: 0 }] }, // no trackId
        { target: 'trackGain', trackId: 't1', points: [] }, // empty
        { target: 'trackPan', trackId: 't1', points: [{ beat: 0, value: 9 }] }, // clamp -> 1
      ],
    })
    expect(project.automation).toEqual([
      { target: 'trackPan', trackId: 't1', points: [{ beat: 0, value: 1 }] },
    ])
  })

  it('round-trips automation through serialize/parse', () => {
    const project = migrateProject({
      tracks: [{ id: 't1', instrumentId: 'poly-synth', notes: [] }],
      automation: [{ target: 'trackPan', trackId: 't1', points: [{ beat: 2, value: 0.5 }] }],
    })
    expect(parseProject(serializeProject(project))).toEqual(project)
  })
})
