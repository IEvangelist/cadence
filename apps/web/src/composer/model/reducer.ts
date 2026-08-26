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
import {
  type AutomationPoint,
  type AutomationTarget,
  clearLane,
  clearTrackLanes,
  removeLanePoint,
  writeLanePoint,
} from './automation'
import { quantizeBeat } from '../timing/timing'
import {
  type ProjectMasterMix,
  type ProjectMixInsert,
  type ProjectTrackMix,
  addMixInsert,
  ensureTrackMix,
  removeMixInsert,
  removeTrackMix,
  setMasterMix,
  setMixInsertEnabled,
  setTrackMix,
} from './mix'

export interface ComposerState {
  project: Project
  selectedTrackId: string
  selectedNoteIds: string[]
}

export type ComposerAction =
  | { type: 'load-project'; project: Project }
  | { type: 'sync-remote'; project: Project }
  | { type: 'recover-collaboration-backup'; project: Project }
  | { type: 'set-project-name'; name: string }
  | { type: 'set-tempo'; tempo: number }
  | { type: 'set-loop'; loop: Partial<LoopRegion> }
  | { type: 'toggle-loop' }
  | { type: 'set-length'; lengthBeats: number }
  | { type: 'add-track'; track: Track }
  | { type: 'remove-track'; trackId: string }
  | { type: 'select-track'; trackId: string }
  | { type: 'rename-track'; trackId: string; name: string }
  | { type: 'set-track-instrument'; trackId: string; instrumentId: InstrumentId }
  | { type: 'toggle-track-muted'; trackId: string }
  | { type: 'add-note'; trackId: string; note: Note }
  | { type: 'insert-notes'; trackId: string; notes: Note[] }
  | { type: 'update-note'; trackId: string; noteId: string; changes: Partial<Note> }
  | { type: 'remove-note'; trackId: string; noteId: string }
  | {
      type: 'quantize-notes'
      trackId: string
      grid: number
      strength: number
      noteIds?: string[]
    }
  | { type: 'select-notes'; noteIds: string[]; additive?: boolean }
  | { type: 'clear-selection' }
  | { type: 'write-automation-point'; target: AutomationTarget; trackId?: string; point: AutomationPoint }
  | { type: 'remove-automation-point'; target: AutomationTarget; trackId?: string; beat: number }
  | { type: 'clear-automation-lane'; target: AutomationTarget; trackId?: string }
  | {
      type: 'set-track-mix'
      trackId: string
      changes: Partial<Pick<ProjectTrackMix, 'gainDb' | 'pan' | 'solo'>>
    }
  | { type: 'add-mix-insert'; trackId: string; insert: ProjectMixInsert }
  | { type: 'remove-mix-insert'; trackId: string; insertId: string }
  | { type: 'set-mix-insert-enabled'; trackId: string; insertId: string; enabled: boolean }
  | { type: 'set-master-mix'; changes: Partial<ProjectMasterMix> }

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

/**
 * Keep the loop region covering the whole timeline. The transport "↻ Loop" is a
 * plain whole-song toggle (there is no A/B sub-region UI), so a frozen `loop.end`
 * would silence any note placed past it — e.g. the demo ships looping [0, 8) and
 * notes added to the right, or an AI melody appended after the existing one,
 * would fall outside the loop and never sound. Growing `end` with the timeline
 * keeps every note audible whether or not looping is currently enabled.
 */
function loopForLength(loop: LoopRegion, lengthBeats: number): LoopRegion {
  return loop.end >= lengthBeats ? loop : { ...loop, end: lengthBeats }
}

/** Furthest note end (in beats) across every track; 0 for an empty project. */
function contentEnd(project: Project): number {
  let end = 0
  for (const track of project.tracks) {
    for (const note of track.notes) {
      const noteEnd = note.start + note.duration
      if (noteEnd > end) end = noteEnd
    }
  }
  return end
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
      // Self-heal a project loaded from storage / a share link so it always plays
      // all the way through. Two stale shapes are repaired here (both local-only —
      // the CRDT `sync-remote` path below stays PURE so collaboration echo-safety
      // and convergence are unaffected):
      //   1. `lengthBeats` froze behind the actual notes — e.g. a doc saved before
      //      the timeline-grows-with-notes invariant, or one hand-edited/imported —
      //      so recompute it from the furthest note end.
      //   2. `loop.end` froze behind the timeline — the "↻ Loop" toggle is a plain
      //      whole-song loop, so a short `loop.end` silences every note past it.
      // Growing length first, then the loop to cover it, guarantees playback reaches
      // the last note however the project was produced.
      const incoming = action.project
      const lengthBeats = lengthForNoteEnd(incoming.lengthBeats, contentEnd(incoming))
      const project = {
        ...incoming,
        lengthBeats,
        loop: loopForLength(incoming.loop, lengthBeats),
      }
      return {
        project,
        selectedTrackId: project.tracks[0]?.id ?? '',
        selectedNoteIds: [],
      }
    }

    case 'sync-remote': {
      // Adopt a converged project from a collaborator without disturbing this
      // editor's cursor: keep the selected track/notes when they still exist,
      // otherwise fall back to the first track / drop stale note ids. Automation
      // is NOT carried by the CRDT binding yet, so preserve this editor's local
      // lanes or mix rather than letting a remote sync wipe them (single-user for
      // now). Neither field is carried by the CRDT binding.
      const project = {
        ...action.project,
        automation: state.project.automation,
        mix: state.project.mix,
      }
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

    case 'recover-collaboration-backup': {
      // One-shot full serialized recovery. Unlike routine CRDT sync, this must
      // adopt non-CRDT fields (mix/automation) rather than preserve the stale
      // bootstrap state. PR #190 will move those fields into shared CRDT state.
      const project = action.project
      const selectedTrackId = project.tracks.some(
        (track) => track.id === state.selectedTrackId,
      )
        ? state.selectedTrackId
        : (project.tracks[0]?.id ?? '')
      const liveNoteIds = new Set(
        project.tracks
          .find((track) => track.id === selectedTrackId)
          ?.notes.map((note) => note.id) ?? [],
      )
      return {
        project,
        selectedTrackId,
        selectedNoteIds: state.selectedNoteIds.filter((id) =>
          liveNoteIds.has(id),
        ),
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

    case 'toggle-loop': {
      return {
        ...state,
        project: {
          ...state.project,
          loop: { ...state.project.loop, enabled: !state.project.loop.enabled },
        },
      }
    }

    case 'set-length': {
      const lengthBeats = Math.max(BEATS_PER_BAR, action.lengthBeats)
      return {
        ...state,
        project: {
          ...state.project,
          lengthBeats,
          loop: loopForLength(state.project.loop, lengthBeats),
        },
      }
    }

    case 'add-track': {
      return {
        ...state,
        project: {
          ...state.project,
          tracks: [...state.project.tracks, action.track],
          mix: ensureTrackMix(state.project.mix, action.track.id),
        },
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
        project: {
          ...state.project,
          tracks,
          // Drop any automation lanes that pointed at the removed track.
          automation: clearTrackLanes(state.project.automation ?? [], action.trackId),
          mix: removeTrackMix(state.project.mix, action.trackId),
        },
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
          loop: loopForLength(state.project.loop, lengthBeats),
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            notes: [...t.notes, note],
          })),
        },
        selectedNoteIds: [note.id],
      }
    }

    case 'insert-notes': {
      // Commit a batch (e.g. an accepted AI suggestion) in a single transition:
      // every note is sanitized/clamped like `add-note`, the timeline grows to
      // fit the latest end, and the whole batch becomes the selection. Doing this
      // in one dispatch keeps it a single undo step and — unlike looping
      // `add-note` — leaves ALL inserted notes selected instead of just the last,
      // so the accept path can reveal and highlight the region it just placed.
      if (action.notes.length === 0) return state
      const notes = action.notes.map(sanitizeNote)
      let lengthBeats = state.project.lengthBeats
      for (const note of notes) {
        lengthBeats = lengthForNoteEnd(lengthBeats, note.start + note.duration)
      }
      return {
        ...state,
        project: {
          ...state.project,
          lengthBeats,
          loop: loopForLength(state.project.loop, lengthBeats),
          tracks: mapTrack(state.project, action.trackId, (t) => ({
            ...t,
            notes: [...t.notes, ...notes],
          })),
        },
        selectedNoteIds: notes.map((note) => note.id),
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
      return { ...state, project: { ...state.project, lengthBeats: end, loop: loopForLength(state.project.loop, end), tracks } }
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

    case 'quantize-notes': {
      // Snap note starts toward the chosen grid by `strength` (0..1). When
      // `noteIds` is given only those notes move (quantize the selection);
      // otherwise every note in the track is quantized. Durations are left
      // untouched so this is a pure timing nudge — the audio path is unaffected
      // beyond the usual reschedule that follows any note-data change.
      const grid = action.grid
      if (grid <= 0) return state
      const only = action.noteIds ? new Set(action.noteIds) : null
      let end = state.project.lengthBeats
      const tracks = mapTrack(state.project, action.trackId, (t) => ({
        ...t,
        notes: t.notes.map((n) => {
          if (only && !only.has(n.id)) return n
          const next = sanitizeNote({
            ...n,
            start: quantizeBeat(n.start, grid, action.strength),
          })
          end = lengthForNoteEnd(end, next.start + next.duration)
          return next
        }),
      }))
      return {
        ...state,
        project: {
          ...state.project,
          lengthBeats: end,
          loop: loopForLength(state.project.loop, end),
          tracks,
        },
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

    case 'write-automation-point': {
      return {
        ...state,
        project: {
          ...state.project,
          automation: writeLanePoint(
            state.project.automation ?? [],
            action.target,
            action.trackId,
            action.point,
          ),
        },
      }
    }

    case 'remove-automation-point': {
      return {
        ...state,
        project: {
          ...state.project,
          automation: removeLanePoint(
            state.project.automation ?? [],
            action.target,
            action.trackId,
            action.beat,
          ),
        },
      }
    }

    case 'clear-automation-lane': {
      return {
        ...state,
        project: {
          ...state.project,
          automation: clearLane(state.project.automation ?? [], action.target, action.trackId),
        },
      }
    }

    case 'set-track-mix': {
      return {
        ...state,
        project: {
          ...state.project,
          mix: setTrackMix(state.project.mix, action.trackId, action.changes),
        },
      }
    }

    case 'add-mix-insert': {
      return {
        ...state,
        project: {
          ...state.project,
          mix: addMixInsert(state.project.mix, action.trackId, action.insert),
        },
      }
    }

    case 'remove-mix-insert': {
      return {
        ...state,
        project: {
          ...state.project,
          mix: removeMixInsert(state.project.mix, action.trackId, action.insertId),
        },
      }
    }

    case 'set-mix-insert-enabled': {
      return {
        ...state,
        project: {
          ...state.project,
          mix: setMixInsertEnabled(
            state.project.mix,
            action.trackId,
            action.insertId,
            action.enabled,
          ),
        },
      }
    }

    case 'set-master-mix': {
      return {
        ...state,
        project: {
          ...state.project,
          mix: setMasterMix(state.project.mix, action.changes),
        },
      }
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
