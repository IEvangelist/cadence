import { describe, expect, it } from 'vitest'
import {
  createDemoProject,
  createEmptyProject,
  createNote,
  createTrack,
  type Project,
} from '../model/project'
import {
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  ProjectFileError,
  fileToProject,
  projectToFile,
  type ProjectFileEnvelope,
} from './projectFile'

function buildProject(): Project {
  const project = createEmptyProject('p1')
  project.name = 'Portable'
  project.tempo = 132
  project.tracks = [
    createTrack(
      {
        name: 'Lead',
        instrumentId: 'fm-synth',
        notes: [
          createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'a'),
          createNote({ pitch: 67, start: 1.5, duration: 0.25, velocity: 0.42 }, 'b'),
        ],
      },
      't1',
    ),
  ]
  return project
}

describe('projectToFile', () => {
  it('writes a self-describing, versioned envelope', () => {
    const text = projectToFile(buildProject(), 1234)
    const parsed = JSON.parse(text) as ProjectFileEnvelope
    expect(parsed.format).toBe(PROJECT_FILE_FORMAT)
    expect(parsed.version).toBe(PROJECT_FILE_VERSION)
    expect(parsed.exportedAt).toBe(1234)
    expect(parsed.project.name).toBe('Portable')
    expect(PROJECT_FILE_EXTENSION).toBe('.cadence.json')
  })
})

describe('project -> file -> project round trip', () => {
  it('preserves the full model exactly', () => {
    const project = buildProject()
    const restored = fileToProject(projectToFile(project))
    expect(restored).toEqual(project)
  })

  it('round-trips the richer demo project', () => {
    const demo = createDemoProject('demo')
    const restored = fileToProject(projectToFile(demo))
    expect(restored.tracks.map((t) => t.notes.length)).toEqual(
      demo.tracks.map((t) => t.notes.length),
    )
    expect(restored.tempo).toBe(demo.tempo)
    expect(restored.loop).toEqual(demo.loop)
  })

  it('honors id and name overrides on import', () => {
    const restored = fileToProject(projectToFile(buildProject()), {
      id: 'forced',
      name: 'Copy',
    })
    expect(restored.id).toBe('forced')
    expect(restored.name).toBe('Copy')
  })

  it('accepts a bare (un-enveloped) project document', () => {
    const project = buildProject()
    const restored = fileToProject(JSON.stringify(project))
    expect(restored.name).toBe('Portable')
    expect(restored.tracks[0].notes).toHaveLength(2)
  })
})

describe('fileToProject guards malformed input', () => {
  it('throws a typed ProjectFileError on invalid JSON', () => {
    expect(() => fileToProject('{ not json')).toThrow(ProjectFileError)
  })

  it('throws a typed ProjectFileError on a non-object document', () => {
    expect(() => fileToProject('42')).toThrow(ProjectFileError)
  })

  it('throws a typed ProjectFileError on a foreign envelope format', () => {
    const foreign = JSON.stringify({ format: 'something-else', project: {} })
    expect(() => fileToProject(foreign)).toThrow(ProjectFileError)
  })
})
