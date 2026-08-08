import { describe, expect, it } from 'vitest'
import {
  createEmptyProject,
  createNote,
  createTrack,
  type Note,
  type Project,
} from '../model/project'
import {
  MusicXmlImportError,
  musicXmlToProject,
  projectToMusicXml,
} from './musicxml'

function buildProject(): Project {
  const project = createEmptyProject('p1')
  project.name = 'Notation'
  project.tempo = 128
  project.tracks = [
    createTrack(
      {
        name: 'Synth',
        instrumentId: 'poly-synth',
        notes: [
          createNote({ pitch: 60, start: 0, duration: 1 }, 'a'), // C4
          createNote({ pitch: 64, start: 1, duration: 0.5 }, 'b'), // E4
          createNote({ pitch: 67, start: 2, duration: 2 }, 'c'), // G4
          createNote({ pitch: 62, start: 3, duration: 2 }, 'd'), // D4 crosses barline
        ],
      },
      't1',
    ),
    createTrack(
      {
        name: 'Drums',
        instrumentId: 'drum-kit',
        notes: [createNote({ pitch: 36, start: 0, duration: 0.5 }, 'e')],
      },
      't2',
    ),
  ]
  return project
}

const sortNotes = (notes: Note[]): Note[] =>
  [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)

describe('projectToMusicXml', () => {
  it('produces a score-partwise document with a part per track', () => {
    const xml = projectToMusicXml(buildProject())
    expect(xml).toContain('<score-partwise version="4.0">')
    expect(xml).toContain('<part-name>Synth</part-name>')
    expect(xml).toContain('<part-name>Drums</part-name>')
    expect(xml).toContain('<sound tempo="128"/>')
    expect(xml).toContain('<divisions>480</divisions>')
  })

  it('escapes XML-special characters in names', () => {
    const project = createEmptyProject('p')
    project.name = 'Rock & <Roll>'
    const xml = projectToMusicXml(project)
    expect(xml).toContain('Rock &amp; &lt;Roll&gt;')
  })
})

describe('project -> musicxml -> project round trip', () => {
  it('preserves tempo', () => {
    const restored = musicXmlToProject(projectToMusicXml(buildProject()))
    expect(restored.tempo).toBe(128)
  })

  it('preserves note pitch, start, and duration (merging ties across barlines)', () => {
    const restored = musicXmlToProject(projectToMusicXml(buildProject()))
    const notes = sortNotes(restored.tracks[0].notes)
    expect(notes.map((n) => ({ pitch: n.pitch, start: n.start, duration: n.duration }))).toEqual([
      { pitch: 60, start: 0, duration: 1 },
      { pitch: 64, start: 1, duration: 0.5 },
      { pitch: 67, start: 2, duration: 2 },
      { pitch: 62, start: 3, duration: 2 },
    ])
  })

  it('preserves track count and maps a drum part to drum-kit', () => {
    const restored = musicXmlToProject(projectToMusicXml(buildProject()))
    expect(restored.tracks).toHaveLength(2)
    expect(restored.tracks[0].instrumentId).toBe('poly-synth')
    expect(restored.tracks[1].instrumentId).toBe('drum-kit')
    expect(restored.tracks[1].notes).toHaveLength(1)
    expect(restored.tracks[1].notes[0].pitch).toBe(36)
  })

  it('round-trips a chord (simultaneous notes) at the same start', () => {
    const project = createEmptyProject('chord')
    project.tracks = [
      createTrack(
        {
          name: 'Chord',
          notes: [
            createNote({ pitch: 60, start: 0, duration: 2 }, 'c1'),
            createNote({ pitch: 64, start: 0, duration: 2 }, 'c2'),
            createNote({ pitch: 67, start: 0, duration: 2 }, 'c3'),
          ],
        },
        't',
      ),
    ]
    const restored = musicXmlToProject(projectToMusicXml(project))
    const notes = sortNotes(restored.tracks[0].notes)
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67])
    expect(notes.every((n) => n.start === 0 && n.duration === 2)).toBe(true)
  })

  it('preserves sharps (black keys)', () => {
    const project = createEmptyProject('sharps')
    project.tracks = [
      createTrack(
        { name: 'Sharps', notes: [createNote({ pitch: 61, start: 0, duration: 1 }, 's')] },
        't',
      ),
    ]
    const restored = musicXmlToProject(projectToMusicXml(project))
    expect(restored.tracks[0].notes[0].pitch).toBe(61) // C#4
  })

  it('honors id and name overrides and reads the work title otherwise', () => {
    const xml = projectToMusicXml(buildProject())
    expect(musicXmlToProject(xml).name).toBe('Notation')
    const overridden = musicXmlToProject(xml, { id: 'forced', name: 'Custom' })
    expect(overridden.id).toBe('forced')
    expect(overridden.name).toBe('Custom')
  })

  it('round-trips an empty project to a single track with no notes', () => {
    const restored = musicXmlToProject(projectToMusicXml(createEmptyProject('e')))
    expect(restored.tracks).toHaveLength(1)
    expect(restored.tracks[0].notes).toEqual([])
  })
})

describe('musicXmlToProject guards malformed input', () => {
  it('throws a typed MusicXmlImportError on non-XML text', () => {
    expect(() => musicXmlToProject('this is not xml <<<')).toThrow(MusicXmlImportError)
  })

  it('throws a typed MusicXmlImportError on XML that is not a score', () => {
    expect(() => musicXmlToProject('<root><child/></root>')).toThrow(MusicXmlImportError)
  })
})

describe('musicXmlToProject sanitizes malformed numeric content', () => {
  // Build a parseable score-partwise document with a single measure whose notes
  // carry the given raw <note> markup. This slips past the parse/guard checks and
  // exercises the numeric-coercion path.
  const score = (notesMarkup: string): string =>
    `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Synth</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>480</divisions></attributes>
      ${notesMarkup}
    </measure>
  </part>
</score-partwise>`

  const assertSane = (project: Project): void => {
    expect(Number.isFinite(project.lengthBeats)).toBe(true)
    expect(Number.isFinite(project.loop.start)).toBe(true)
    expect(Number.isFinite(project.loop.end)).toBe(true)
    expect(project.loop.end).toBeGreaterThanOrEqual(project.loop.start)
    for (const track of project.tracks) {
      for (const note of track.notes) {
        expect(Number.isFinite(note.pitch)).toBe(true)
        expect(note.pitch).toBeGreaterThanOrEqual(0)
        expect(note.pitch).toBeLessThanOrEqual(127)
        expect(Number.isFinite(note.start)).toBe(true)
        expect(note.start).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(note.duration)).toBe(true)
        expect(note.duration).toBeGreaterThan(0)
      }
    }
  }

  it('clamps a non-numeric <duration> (never NaN)', () => {
    const project = musicXmlToProject(
      score('<note><pitch><step>C</step><octave>4</octave></pitch><duration>abc</duration></note>'),
    )
    assertSane(project)
  })

  it('clamps a missing <duration> (never NaN)', () => {
    const project = musicXmlToProject(
      score('<note><pitch><step>C</step><octave>4</octave></pitch></note>'),
    )
    assertSane(project)
  })

  it('clamps an out-of-range pitch (octave-9 B# is MIDI 132)', () => {
    const project = musicXmlToProject(
      score(
        '<note><pitch><step>B</step><alter>1</alter><octave>9</octave></pitch><duration>480</duration></note>',
      ),
    )
    assertSane(project)
    expect(project.tracks[0].notes[0].pitch).toBe(127)
  })

  it('clamps a negative start produced by a backup exceeding prior forward', () => {
    const project = musicXmlToProject(
      score(
        '<forward><duration>480</duration></forward>' +
          '<backup><duration>1920</duration></backup>' +
          '<note><pitch><step>C</step><octave>4</octave></pitch><duration>480</duration></note>',
      ),
    )
    assertSane(project)
  })
})
