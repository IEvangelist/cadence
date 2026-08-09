/**
 * Pure, deterministic reducer for the composer. It owns the project document
 * plus lightweight editing selection. No side effects, no id generation, no
 * clock access — callers pass fully-formed notes/tracks so every transition is
 * reproducible in tests.
 */
import {
  BEATS_PER_BAR,
  type InstrumentId,
  type LoopRegion,
  type Note,
  type Project,
  type Track,
} from './project'

export interface ComposerState {
  project: Project
  selectedTrackId: string
  selectedNoteIds: string[]
}

export type ComposerAction =
  | { type: 'load-project'; project: Project }
  | { type: 'sync-remote'; project: Project }
  | { type: 'set-project-name'; name: string }
  | { type: 'set-tempo'; tempo: number }
  | { type: 'set-loop'; loop: Partial<LoopRegion> }
  | { type: 'set-length'; lengthBeats: number }
  | { type: 'add-track'; track: Track }
  | { type: 'remove-track'; trackId: string }
  | { type: 'select-track'; trackId: string }
  | { type: 'rename-track'; trackId: string; name: string }
  | { type: 'set-track-instrument'; trackId: string; instrumentId: InstrumentId }
  | { type: 'toggle-track-muted'; trackId: string }
  | { type: 'add-note'; trackId: string; note: Note }
  | { type: 'update-note'; trackId: string; noteId: string; changes: Partial<Note> }
  | { type: 'remove-note'; trackId: string; noteId: string }
  | { type: 'select-notes'; noteIds: string[]; additive?: boolean }
  | { type: 'clear-selection' }

/** Smallest allowed note length in beats (a 64th note). */
export const MIN_NOTE_DURATION = 1 / 16

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

function sanitizeNote(note: Note): Note {
  return {
    ...note,
    pitch: Math.round(clamp(note.pitch, 0, 127)),
    start: Math.max(0, note.start),
    duration: Math.max(MIN_NOTE_DURATION, note.duration),
    velocity: clamp(note.velocity, 0, 1),
  }
}

/** Grow the timeline so a note's end (rounded up to a bar) always fits. */
function lengthForNoteEnd(current: number, noteEnd: number): number {
  if (noteEnd <= current) return current
  return Math.ceil(noteEnd / BEATS_PER_BAR) * BEATS_PER_BAR
}

function mapTrack(
  project: Project,
  trackId: string,
  fn: (track: Track) => Track,
): Track[] {
  return project.tracks.map((track) => (track.id === trackId ? fn(track) : track))
}

export function composerReducer(
  state: ComposerState,
  action: ComposerAction,
): ComposerState {
  switch (action.type) {
    case 'load-project': {
      return {
        project: action.project,
        selectedTrackId: action.project.tracks[0]?.id ?? '',
        selectedNoteIds: [],
      }
    }

    case 'sync-remote': {
      // Adopt a converged project from a collaborator without disturbing this
      // editor's cursor: keep the selected track/notes when they still exist,
      // otherwise fall back to the first track / drop stale note ids.
      const project = action.project
      const selectedTrackId = project.tracks.some((t) => t.id === state.selectedTrackId)
        ? state.selectedTrackId
        : (project.tracks[0]?.id ?? '')
      const liveNoteIds = new Set(
        project.tracks
          .find((t) => t.id === selectedTrackId)
          ?.notes.map((n) => n.id) ?? [],
      )
      return {
        project,
        selectedTrackId,
        selectedNoteIds: state.selectedNoteIds.filter((id) => liveNoteIds.has(id)),
      }
    }

    case 'set-project-name': {
      return { ...state, project: { ...state.project, name: action.name } }
    }

    case 'set-tempo': {
      const tempo = clamp(Math.round(action.tempo), 20, 300)
      return { ...state, project: { ...state.project, tempo } }
    }

    case 'set-loop': {
      const loop = { ...state.project.loop, ...action.loop }
      if (loop.end < loop.start) loop.end = loop.start
      return { ...state, project: { ...state.project, loop } }
    }

    case 'set-length': {
      const lengthBeats = Math.max(BEATS_PER_BAR, action.lengthBeats)
      return { ...state, project: { ...state.project, lengthBeats } }
    }

    case 'add-track': {
      return {
        ...state,
        project: { ...state.project, tracks: [...state.project.tracks, action.track] },
        selectedTrackId: action.track.id,
        selectedNoteIds: [],
      }
    }

    case 'remove-track': {
      const tracks = state.project.tracks.filter((t) => t.id !== action.trackId)
      const selectedTrackId =
        state.selectedTrackId === action.trackId
          ? (tracks[0]?.id ?? '')
          : state.selectedTrackId
      return {
        ...state,
        project: { ...state.project, tracks },
        selectedTrackId,
        selectedNoteIds:
          state.selectedTrackId === action.trackId ? [] : state.selectedNoteIds,
      }
    }

    case 'select-track': {
      return { ...state, selectedTrackId: action.trackId, selectedNoteIds: [] }
    }

    case 'rename-track': {
      return {
        ...state,
        project: {
          ...state.project,
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            name: action.name,
          })),
        },
      }
    }

    case 'set-track-instrument': {
      return {
        ...state,
        project: {
          ...state.project,
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            instrumentId: action.instrumentId,
          })),
        },
      }
    }

    case 'toggle-track-muted': {
      return {
        ...state,
        project: {
          ...state.project,
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            muted: !t.muted,
          })),
        },
      }
    }

    case 'add-note': {
      const note = sanitizeNote(action.note)
      const lengthBeats = lengthForNoteEnd(
        state.project.lengthBeats,
        note.start + note.duration,
      )
      return {
        ...state,
        project: {
          ...state.project,
          lengthBeats,
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            notes: [...t.notes, note],
          })),
        },
        selectedNoteIds: [note.id],
      }
    }

    case 'update-note': {
      let end = state.project.lengthBeats
      const tracks = mapTrack(state.project, action.trackId, (t) => ({
        ...t,
        notes: t.notes.map((n) => {
          if (n.id !== action.noteId) return n
          const next = sanitizeNote({ ...n, ...action.changes, id: n.id })
          end = lengthForNoteEnd(end, next.start + next.duration)
          return next
        }),
      }))
      return { ...state, project: { ...state.project, lengthBeats: end, tracks } }
    }

    case 'remove-note': {
      return {
        ...state,
        project: {
          ...state.project,
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            notes: t.notes.filter((n) => n.id !== action.noteId),
          })),
        },
        selectedNoteIds: state.selectedNoteIds.filter((id) => id !== action.noteId),
      }
    }

    case 'select-notes': {
      const selectedNoteIds = action.additive
        ? Array.from(new Set([...state.selectedNoteIds, ...action.noteIds]))
        : action.noteIds
      return { ...state, selectedNoteIds }
    }

    case 'clear-selection': {
      return { ...state, selectedNoteIds: [] }
    }
  }
}

/** Build initial editing state around a project. */
export function initialState(project: Project): ComposerState {
  return {
    project,
    selectedTrackId: project.tracks[0]?.id ?? '',
    selectedNoteIds: [],
  }
}

/** Convenience selector: the currently selected track (or the first one). */
export function selectedTrack(state: ComposerState): Track | undefined {
  return (
    state.project.tracks.find((t) => t.id === state.selectedTrackId) ??
    state.project.tracks[0]
  )
}
