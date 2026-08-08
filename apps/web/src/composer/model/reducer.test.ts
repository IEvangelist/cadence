import { describe, expect, it } from 'vitest'
import {
  BEATS_PER_BAR,
  createEmptyProject,
  createNote,
  createTrack,
} from './project'
import {
  MIN_NOTE_DURATION,
  composerReducer,
  initialState,
  selectedTrack,
  type ComposerState,
} from './reducer'

function seed(): ComposerState {
  const project = createEmptyProject('p')
  project.tracks = [createTrack({ name: 'Synth' }, 'track_a')]
  return initialState(project)
}

describe('initialState', () => {
  it('selects the first track', () => {
    const state = seed()
    expect(state.selectedTrackId).toBe('track_a')
    expect(state.selectedNoteIds).toEqual([])
  })

  it('tolerates a project with no tracks', () => {
    const project = createEmptyProject('p')
    project.tracks = []
    expect(initialState(project).selectedTrackId).toBe('')
  })
})

describe('load-project', () => {
  it('replaces the project and reselects', () => {
    const other = createEmptyProject('other')
    other.tracks = [createTrack({}, 'x')]
    const state = composerReducer(seed(), { type: 'load-project', project: other })
    expect(state.project.id).toBe('other')
    expect(state.selectedTrackId).toBe('x')
  })
})

describe('project fields', () => {
  it('renames the project', () => {
    const state = composerReducer(seed(), { type: 'set-project-name', name: 'Song' })
    expect(state.project.name).toBe('Song')
  })

  it('clamps and rounds tempo', () => {
    expect(composerReducer(seed(), { type: 'set-tempo', tempo: 140.6 }).project.tempo).toBe(141)
    expect(composerReducer(seed(), { type: 'set-tempo', tempo: 5 }).project.tempo).toBe(20)
    expect(composerReducer(seed(), { type: 'set-tempo', tempo: 999 }).project.tempo).toBe(300)
  })

  it('merges loop and keeps end >= start', () => {
    const state = composerReducer(seed(), {
      type: 'set-loop',
      loop: { enabled: true, start: 8, end: 4 },
    })
    expect(state.project.loop.enabled).toBe(true)
    expect(state.project.loop.end).toBe(8)
  })

  it('sets length with a floor of one bar', () => {
    expect(composerReducer(seed(), { type: 'set-length', lengthBeats: 1 }).project.lengthBeats).toBe(
      BEATS_PER_BAR,
    )
    expect(composerReducer(seed(), { type: 'set-length', lengthBeats: 32 }).project.lengthBeats).toBe(
      32,
    )
  })
})

describe('tracks', () => {
  it('adds a track and selects it', () => {
    const state = composerReducer(seed(), {
      type: 'add-track',
      track: createTrack({ name: 'Bass' }, 'track_b'),
    })
    expect(state.project.tracks).toHaveLength(2)
    expect(state.selectedTrackId).toBe('track_b')
  })

  it('removes the selected track and reselects the first remaining', () => {
    let state = composerReducer(seed(), {
      type: 'add-track',
      track: createTrack({}, 'track_b'),
    })
    state = composerReducer(state, { type: 'remove-track', trackId: 'track_b' })
    expect(state.project.tracks).toHaveLength(1)
    expect(state.selectedTrackId).toBe('track_a')
  })

  it('keeps selection when removing a non-selected track', () => {
    let state = composerReducer(seed(), {
      type: 'add-track',
      track: createTrack({}, 'track_b'),
    })
    // track_b is now selected; remove track_a instead
    state = composerReducer(state, { type: 'remove-track', trackId: 'track_a' })
    expect(state.selectedTrackId).toBe('track_b')
  })

  it('renames, re-instruments, and mutes tracks', () => {
    let state = seed()
    state = composerReducer(state, { type: 'rename-track', trackId: 'track_a', name: 'Lead' })
    expect(selectedTrack(state)?.name).toBe('Lead')

    state = composerReducer(state, {
      type: 'set-track-instrument',
      trackId: 'track_a',
      instrumentId: 'drum-kit',
    })
    expect(selectedTrack(state)?.instrumentId).toBe('drum-kit')

    state = composerReducer(state, { type: 'toggle-track-muted', trackId: 'track_a' })
    expect(selectedTrack(state)?.muted).toBe(true)
    state = composerReducer(state, { type: 'toggle-track-muted', trackId: 'track_a' })
    expect(selectedTrack(state)?.muted).toBe(false)
  })

  it('selecting a track clears note selection', () => {
    let state = seed()
    state = composerReducer(state, { type: 'select-notes', noteIds: ['n1'] })
    state = composerReducer(state, { type: 'select-track', trackId: 'track_a' })
    expect(state.selectedNoteIds).toEqual([])
  })
})

describe('notes', () => {
  it('adds a sanitized note and selects it', () => {
    const state = composerReducer(seed(), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 200, start: -3, duration: 0, velocity: 5 }, 'n1'),
    })
    const note = state.project.tracks[0].notes[0]
    expect(note.pitch).toBe(127)
    expect(note.start).toBe(0)
    expect(note.duration).toBe(MIN_NOTE_DURATION)
    expect(note.velocity).toBe(1)
    expect(state.selectedNoteIds).toEqual(['n1'])
  })

  it('grows the timeline to fit a late note', () => {
    const state = composerReducer(seed(), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 30, duration: 2 }, 'n1'),
    })
    // 30 + 2 = 32 already bar-aligned
    expect(state.project.lengthBeats).toBe(32)
  })

  it('updates a note and preserves its id', () => {
    let state = composerReducer(seed(), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 0, duration: 1 }, 'n1'),
    })
    state = composerReducer(state, {
      type: 'update-note',
      trackId: 'track_a',
      noteId: 'n1',
      changes: { pitch: 64, start: 2 },
    })
    const note = state.project.tracks[0].notes[0]
    expect(note.id).toBe('n1')
    expect(note.pitch).toBe(64)
    expect(note.start).toBe(2)
  })

  it('leaves other notes untouched on update', () => {
    let state = seed()
    state = composerReducer(state, {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 0 }, 'n1'),
    })
    state = composerReducer(state, {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 62, start: 1 }, 'n2'),
    })
    state = composerReducer(state, {
      type: 'update-note',
      trackId: 'track_a',
      noteId: 'n1',
      changes: { pitch: 65 },
    })
    const [n1, n2] = state.project.tracks[0].notes
    expect(n1.pitch).toBe(65)
    expect(n2.pitch).toBe(62)
  })

  it('removes a note and drops it from selection', () => {
    let state = composerReducer(seed(), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 0 }, 'n1'),
    })
    state = composerReducer(state, { type: 'remove-note', trackId: 'track_a', noteId: 'n1' })
    expect(state.project.tracks[0].notes).toEqual([])
    expect(state.selectedNoteIds).toEqual([])
  })
})

describe('selection', () => {
  it('replaces selection by default', () => {
    let state = composerReducer(seed(), { type: 'select-notes', noteIds: ['a', 'b'] })
    state = composerReducer(state, { type: 'select-notes', noteIds: ['c'] })
    expect(state.selectedNoteIds).toEqual(['c'])
  })

  it('adds to selection when additive, de-duplicating', () => {
    let state = composerReducer(seed(), { type: 'select-notes', noteIds: ['a'] })
    state = composerReducer(state, {
      type: 'select-notes',
      noteIds: ['a', 'b'],
      additive: true,
    })
    expect(state.selectedNoteIds).toEqual(['a', 'b'])
  })

  it('clears selection', () => {
    let state = composerReducer(seed(), { type: 'select-notes', noteIds: ['a'] })
    state = composerReducer(state, { type: 'clear-selection' })
    expect(state.selectedNoteIds).toEqual([])
  })
})
