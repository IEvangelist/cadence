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

describe('sync-remote', () => {
  it('adopts the converged project but preserves a still-valid selection', () => {
    const start = seed()
    const withNote = composerReducer(start, {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 0 }, 'n1'),
    })
    expect(withNote.selectedNoteIds).toEqual(['n1'])

    // A remote copy that still contains track_a and note n1.
    const remote = createEmptyProject('p')
    const track = createTrack({ name: 'Synth' }, 'track_a')
    track.notes = [createNote({ pitch: 62, start: 0 }, 'n1')]
    remote.tracks = [track]

    const synced = composerReducer(withNote, { type: 'sync-remote', project: remote })
    expect(synced.project.tracks[0].notes[0].pitch).toBe(62)
    expect(synced.selectedTrackId).toBe('track_a')
    expect(synced.selectedNoteIds).toEqual(['n1'])
  })

  it('falls back to the first track and drops stale note selection', () => {
    const start = composerReducer(seed(), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 0 }, 'gone'),
    })

    // The remote project replaced the tracks entirely.
    const remote = createEmptyProject('p')
    remote.tracks = [createTrack({ name: 'New' }, 'track_z')]

    const synced = composerReducer(start, { type: 'sync-remote', project: remote })
    expect(synced.selectedTrackId).toBe('track_z')
    expect(synced.selectedNoteIds).toEqual([])
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

describe('loop follows the timeline (whole-song loop)', () => {
  // The "↻ Loop" transport control is a plain whole-song toggle — there is no
  // A/B sub-region UI — so a frozen loop.end silences any note placed past it
  // (e.g. the demo ships looping [0, 8) and notes added to the right, or an AI
  // melody appended after the existing one, would never sound). loop.end must
  // grow with the timeline so every note stays inside the loop and audible.
  function loopedSeed(end = 8): ComposerState {
    const project = createEmptyProject('p')
    project.tracks = [createTrack({ name: 'Synth' }, 'track_a')]
    project.lengthBeats = end
    project.loop = { enabled: true, start: 0, end }
    return initialState(project)
  }

  it('grows loop.end when a note is added past it', () => {
    const state = composerReducer(loopedSeed(8), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 12, duration: 1 }, 'n1'),
    })
    expect(state.project.lengthBeats).toBeGreaterThanOrEqual(13)
    expect(state.project.loop.end).toBe(state.project.lengthBeats)
  })

  it('grows loop.end when a batch (accepted AI melody) is inserted past it', () => {
    const state = composerReducer(loopedSeed(8), {
      type: 'insert-notes',
      trackId: 'track_a',
      notes: [
        createNote({ pitch: 60, start: 8, duration: 1 }, 'a'),
        createNote({ pitch: 64, start: 10, duration: 1 }, 'b'),
        createNote({ pitch: 67, start: 12, duration: 1 }, 'c'),
      ],
    })
    expect(state.project.loop.end).toBe(state.project.lengthBeats)
    expect(state.project.loop.end).toBeGreaterThanOrEqual(13)
  })

  it('grows loop.end when a note is resized past it', () => {
    let state = composerReducer(loopedSeed(8), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 4, duration: 1 }, 'n1'),
    })
    state = composerReducer(state, {
      type: 'update-note',
      trackId: 'track_a',
      noteId: 'n1',
      changes: { duration: 12 },
    })
    expect(state.project.loop.end).toBe(state.project.lengthBeats)
    expect(state.project.loop.end).toBeGreaterThanOrEqual(16)
  })

  it('leaves a loop that already covers the note untouched', () => {
    const state = composerReducer(loopedSeed(16), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 60, start: 2, duration: 1 }, 'n1'),
    })
    expect(state.project.loop.end).toBe(16)
  })

  it('self-heals a stale loaded project whose loop.end froze behind the timeline', () => {
    // A project saved before this invariant: old code grew lengthBeats on edits
    // but left loop.end at 8, so a note at beat 18 would be silent on load.
    const stale = createEmptyProject('stale')
    stale.tracks = [createTrack({ name: 'Synth' }, 'track_a')]
    stale.lengthBeats = 20
    stale.loop = { enabled: true, start: 0, end: 8 }
    const state = composerReducer(seed(), { type: 'load-project', project: stale })
    expect(state.project.loop.end).toBe(20)
  })

  it('recomputes lengthBeats + loop.end when loaded notes run past a stale stored length', () => {
    // The "still doesn't play all the way through" report: a saved project whose
    // stored lengthBeats AND loop.end both froze at 8 while a note actually runs
    // to beat 37. Length is recomputed from the furthest note (rounded up to a
    // bar → 40) and the loop grows to cover it, so playback reaches the last note.
    const stale = createEmptyProject('stale')
    const track = createTrack({ name: 'Synth' }, 'track_a')
    track.notes = [createNote({ pitch: 60, start: 36, duration: 1 }, 'n1')]
    stale.tracks = [track]
    stale.lengthBeats = 8
    stale.loop = { enabled: true, start: 0, end: 8 }
    const state = composerReducer(seed(), { type: 'load-project', project: stale })
    expect(state.project.lengthBeats).toBe(40)
    expect(state.project.loop.end).toBe(40)
  })

  it('does NOT grow loop.end on sync-remote (CRDT convergence stays echo-safe)', () => {
    // The collaboration path must adopt a converged doc verbatim — growing
    // loop.end here would emit a spurious update and break echo-safety.
    const remote = createEmptyProject('p')
    remote.tracks = [createTrack({ name: 'Synth' }, 'track_a')]
    remote.lengthBeats = 20
    remote.loop = { enabled: true, start: 0, end: 8 }
    const state = composerReducer(seed(), { type: 'sync-remote', project: remote })
    expect(state.project.loop.end).toBe(8)
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

describe('quantize-notes', () => {
  function withNotes(): ComposerState {
    let state = seed()
    for (const note of [
      createNote({ pitch: 60, start: 0.24, duration: 1 }, 'n1'),
      createNote({ pitch: 62, start: 1.1, duration: 1 }, 'n2'),
      createNote({ pitch: 64, start: 2.4, duration: 1 }, 'n3'),
    ]) {
      state = composerReducer(state, { type: 'add-note', trackId: 'track_a', note })
    }
    return state
  }

  it('snaps every note in the track to the grid at full strength', () => {
    const state = composerReducer(withNotes(), {
      type: 'quantize-notes',
      trackId: 'track_a',
      grid: 1,
      strength: 1,
    })
    expect(state.project.tracks[0].notes.map((n) => n.start)).toEqual([0, 1, 2])
  })

  it('only moves the given notes when noteIds is provided', () => {
    const state = composerReducer(withNotes(), {
      type: 'quantize-notes',
      trackId: 'track_a',
      grid: 1,
      strength: 1,
      noteIds: ['n2'],
    })
    const [n1, n2, n3] = state.project.tracks[0].notes
    expect(n1.start).toBeCloseTo(0.24)
    expect(n2.start).toBe(1)
    expect(n3.start).toBeCloseTo(2.4)
  })

  it('eases notes partway at intermediate strength', () => {
    const state = composerReducer(withNotes(), {
      type: 'quantize-notes',
      trackId: 'track_a',
      grid: 1,
      strength: 0.5,
    })
    // n1: 0.24 -> nearest 0, half strength -> 0.12
    expect(state.project.tracks[0].notes[0].start).toBeCloseTo(0.12)
  })

  it('is a no-op for a non-positive grid', () => {
    const before = withNotes()
    const after = composerReducer(before, {
      type: 'quantize-notes',
      trackId: 'track_a',
      grid: 0,
      strength: 1,
    })
    expect(after).toBe(before)
  })

  it('preserves note durations and ids', () => {
    const state = composerReducer(withNotes(), {
      type: 'quantize-notes',
      trackId: 'track_a',
      grid: 1,
      strength: 1,
    })
    expect(state.project.tracks[0].notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    expect(state.project.tracks[0].notes.every((n) => n.duration === 1)).toBe(true)
  })
})

describe('insert-notes', () => {
  it('appends the whole batch and selects every inserted note', () => {
    const state = composerReducer(seed(), {
      type: 'insert-notes',
      trackId: 'track_a',
      notes: [
        createNote({ pitch: 60, start: 0, duration: 1 }, 'n1'),
        createNote({ pitch: 64, start: 1, duration: 1 }, 'n2'),
        createNote({ pitch: 67, start: 2, duration: 1 }, 'n3'),
      ],
    })
    expect(state.project.tracks[0].notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
    // Unlike a loop of add-note (which selects only the last), the whole batch
    // is selected so the accept path can reveal and highlight the region.
    expect(state.selectedNoteIds).toEqual(['n1', 'n2', 'n3'])
  })

  it('preserves notes already on the track', () => {
    let state = composerReducer(seed(), {
      type: 'add-note',
      trackId: 'track_a',
      note: createNote({ pitch: 48, start: 0, duration: 1 }, 'existing'),
    })
    state = composerReducer(state, {
      type: 'insert-notes',
      trackId: 'track_a',
      notes: [createNote({ pitch: 72, start: 4, duration: 1 }, 'n1')],
    })
    expect(state.project.tracks[0].notes.map((n) => n.id)).toEqual(['existing', 'n1'])
    expect(state.selectedNoteIds).toEqual(['n1'])
  })

  it('sanitizes every inserted note', () => {
    const state = composerReducer(seed(), {
      type: 'insert-notes',
      trackId: 'track_a',
      notes: [createNote({ pitch: 200, start: -3, duration: 0, velocity: 5 }, 'n1')],
    })
    const note = state.project.tracks[0].notes[0]
    expect(note.pitch).toBe(127)
    expect(note.start).toBe(0)
    expect(note.duration).toBe(MIN_NOTE_DURATION)
    expect(note.velocity).toBe(1)
  })

  it('grows the timeline to fit the latest note end', () => {
    const state = composerReducer(seed(), {
      type: 'insert-notes',
      trackId: 'track_a',
      notes: [
        createNote({ pitch: 60, start: 0, duration: 1 }, 'n1'),
        createNote({ pitch: 62, start: 30, duration: 2 }, 'n2'),
      ],
    })
    expect(state.project.lengthBeats).toBe(32)
  })

  it('is a no-op for an empty batch', () => {
    const before = seed()
    const after = composerReducer(before, {
      type: 'insert-notes',
      trackId: 'track_a',
      notes: [],
    })
    expect(after).toBe(before)
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
