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
    expect(note.pitch).toBe(999) // rounded but not clamped here; engine clamps at play
    expect(note.start).toBe(0)
    expect(note.duration).toBeGreaterThan(0)
    expect(note.velocity).toBe(1)
    expect(project.tempo).toBe(DEFAULT_TEMPO)
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
