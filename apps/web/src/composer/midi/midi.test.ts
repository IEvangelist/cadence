import { describe, expect, it } from 'vitest'
import {
  createDemoProject,
  createEmptyProject,
  createNote,
  createTrack,
  type Project,
} from '../model/project'
import { MidiImportError, midiBytesToProject, projectToMidiBytes } from './midi'

function buildProject(): Project {
  const project = createEmptyProject('p1')
  project.name = 'Round Trip'
  project.tempo = 128
  project.tracks = [
    createTrack(
      {
        name: 'Synth',
        instrumentId: 'poly-synth',
        notes: [
          createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'a'),
          createNote({ pitch: 64, start: 1, duration: 0.5, velocity: 0.6 }, 'b'),
          createNote({ pitch: 67, start: 2, duration: 2, velocity: 0.75 }, 'c'),
        ],
      },
      'track_synth',
    ),
    createTrack(
      {
        name: 'Drums',
        instrumentId: 'drum-kit',
        notes: [createNote({ pitch: 36, start: 0, duration: 0.5, velocity: 0.9 }, 'd')],
      },
      'track_drums',
    ),
  ]
  return project
}

describe('projectToMidiBytes', () => {
  it('produces a non-empty MIDI byte stream with the SMF header', () => {
    const bytes = projectToMidiBytes(buildProject())
    expect(bytes.length).toBeGreaterThan(0)
    // "MThd" magic number for a Standard MIDI File header chunk.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x4d, 0x54, 0x68, 0x64])
  })
})

describe('project -> midi -> project round trip', () => {
  it('preserves tempo', () => {
    const project = buildProject()
    const restored = midiBytesToProject(projectToMidiBytes(project))
    expect(restored.tempo).toBe(128)
  })

  it('preserves note pitch, timing, and velocity', () => {
    const project = buildProject()
    const restored = midiBytesToProject(projectToMidiBytes(project))
    const notes = restored.tracks[0].notes
    expect(notes).toHaveLength(3)
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67])
    expect(notes.map((n) => n.start)).toEqual([0, 1, 2])
    expect(notes.map((n) => n.duration)).toEqual([1, 0.5, 2])
    expect(notes[0].velocity).toBeCloseTo(0.8, 1)
  })

  it('preserves track count and maps the drum channel to drum-kit', () => {
    const restored = midiBytesToProject(projectToMidiBytes(buildProject()))
    expect(restored.tracks).toHaveLength(2)
    expect(restored.tracks[1].instrumentId).toBe('drum-kit')
    expect(restored.tracks[0].instrumentId).toBe('poly-synth')
  })

  it('round-trips the richer demo project note counts', () => {
    const demo = createDemoProject('demo')
    const restored = midiBytesToProject(projectToMidiBytes(demo))
    const originalCounts = demo.tracks.map((t) => t.notes.length)
    const restoredCounts = restored.tracks.map((t) => t.notes.length)
    expect(restoredCounts).toEqual(originalCounts)
  })

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const bytes = projectToMidiBytes(buildProject())
    const copy = bytes.slice()
    const restored = midiBytesToProject(
      copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength),
    )
    expect(restored.tracks[0].notes).toHaveLength(3)
  })
})

describe('midiBytesToProject options and edges', () => {
  it('honors id and name overrides', () => {
    const bytes = projectToMidiBytes(buildProject())
    const restored = midiBytesToProject(bytes, { id: 'forced', name: 'Custom' })
    expect(restored.id).toBe('forced')
    expect(restored.name).toBe('Custom')
  })

  it('falls back to a single empty track when there are no notes', () => {
    const empty = createEmptyProject('e')
    const restored = midiBytesToProject(projectToMidiBytes(empty))
    expect(restored.tracks).toHaveLength(1)
    expect(restored.tracks[0].notes).toEqual([])
    expect(restored.tempo).toBe(empty.tempo)
  })
})

describe('midiBytesToProject guards malformed input', () => {
  it('throws a typed MidiImportError on non-MIDI bytes', () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    expect(() => midiBytesToProject(garbage)).toThrow(MidiImportError)
  })

  it('throws a typed MidiImportError on an empty buffer', () => {
    expect(() => midiBytesToProject(new Uint8Array())).toThrow(MidiImportError)
  })
})
