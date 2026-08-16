/**
 * useComposer — the orchestration hook wiring the pure reducer to the audio
 * engine and persistence. Components stay presentational; all side effects
 * (scheduling, autosave, MIDI I/O, playhead polling) live here behind a small
 * controller object. The engine and store are injectable so the whole thing is
 * unit-testable without Web Audio.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  type InstrumentId,
  type Note,
  type Project,
  createDemoProject,
  createEmptyProject,
  createNote,
  createTrack,
  newId,
  trackColorForIndex,
} from '../model/project'
import {
  type ComposerAction,
  type ComposerState,
  composerReducer,
  initialState,
  selectedTrack as selectSelectedTrack,
} from '../model/reducer'
import { type HistoryController, createHistoryController } from '../model/history'
import { selectVisibleTrackIds } from '../model/trackVisibility'
import type { AutomationPoint, AutomationTarget } from '../model/automation'
import {
  type ProjectStore,
  type StoredProjectMeta,
  type SyncStorage,
  createProjectStore,
} from '../model/storage'
import { migrateProject } from '../model/persistence'
import { midiBytesToProject, projectToMidiBytes } from '../midi/midi'
import { fileToProject, projectToFile } from '../formats/projectFile'
import { musicXmlToProject, projectToMusicXml } from '../formats/musicxml'
import { type OfflineRenderer, renderProjectToWav } from '../formats/audioExport'
import { defaultPluginHost } from '../plugins/defaultHost'
import type { FormatContribution } from '../plugins/types'
import {
  type ShareSnapshot,
  createShareSnapshot,
  decodeProjectFromFragment,
} from '../formats/share'
import { type AudioEngine, type TransportState, createAudioEngine } from '../audio/engine'
import type { MixerController } from '../audio/mixerController'
import { type MidiAccessLike, type MidiInputInfo, normalizeVelocity } from '../midi/webMidi'
import { type MidiCapture, recordedNoteFrom } from '../midi/record'
import {
  type ProjectActionMessage,
  type ProjectHydrationState,
  type ProjectReplacementRequest,
  type ProjectReplacementResult,
  type ProjectReplacementState,
  type ProjectSaveState,
  type RecentProjectsState,
  initialSaveState,
} from '../model/projectLifecycle'
import type { SongTemplate } from '../templates'
import {
  clearProjectRecoveryChain,
  defaultRecoveryStorage,
  newRecoveryLineageId,
  readProjectRecovery,
  writeProjectRecovery,
} from '../model/recovery'
import { useMidiInput } from './useMidiInput'

/** Beats a live-MIDI monitor note rings for (matches the preview default). */
const MIDI_MONITOR_DURATION = 0.5

export interface UseComposerOptions {
  createEngine?: () => AudioEngine
  store?: ProjectStore
  initialProject?: Project
  /** Autosave debounce in ms. 0 saves synchronously (handy for tests). */
  autosaveDelay?: number
  /** Injected offline audio renderer for WAV export (mockable in tests). */
  audioRenderer?: OfflineRenderer
  /**
   * Whether the current user's entitlements watermark audio exports. Defaults to
   * `true` (the safe, free-tier default); paid entitlements set it to `false` for
   * byte-clean exports. Server-authoritative — this only drives the export.
   */
  watermarkExports?: boolean
  /**
   * Whether live MIDI hardware input is enabled. Defaults to `true`; pass `false`
   * to fully opt out (the UI then reports MIDI as unsupported/off).
   */
  midiEnabled?: boolean
  /** Injectable Web MIDI access request for tests/e2e (defaults to navigator). */
  requestMidiAccess?: () => Promise<MidiAccessLike | null>
  /** Router-owned hash used to import a shared project on Studio mount. */
  sharedProjectHash?: string
  /** Called after a shared project hash is imported so the router can replace it. */
  onSharedProjectConsumed?: () => void
  /** Changes when the injected store switches between local and remote backends. */
  storeRevision?: unknown
  /** Synchronous crash-recovery storage; defaults to localStorage in the app. */
  recoveryStorage?: SyncStorage | null
  /** Stable persistence identity, e.g. local anonymous or one remote user id. */
  recoveryScope?: string | null
}

/**
 * A request to scroll a set of just-inserted notes into view. `token` increases
 * on every insert so consumers can react to *repeat* inserts of the same notes;
 * `noteIds` is empty until the first insert of the session.
 */
export interface NoteRevealRequest {
  noteIds: string[]
  token: number
}

export interface ProjectTransition {
  project: Project
  group: string | null
  boundary: number
  kind: 'mutation' | 'replacement'
}

/**
 * Live MIDI hardware input surface (#111). INTERNAL — the frozen public
 * {@link ComposerPublicApi} intentionally excludes it.
 */
export interface ComposerMidi {
  /** Whether Web MIDI exists in this browser; `false` hides/disables the UI. */
  supported: boolean
  /** Currently connected input devices. */
  inputs: MidiInputInfo[]
  /** Chosen input id (auto-selected to the first device when unset). */
  selectedInputId: string | null
  selectInput: (id: string | null) => void
  /** True when the selected device is present and receiving. */
  connected: boolean
  /** Whether record-arm is engaged. */
  armed: boolean
  toggleArmed: () => void
  /** Whether recorded notes snap to the transport grid (opt-in, off by default). */
  quantize: boolean
  setQuantize: (on: boolean) => void
}

export interface ComposerController {
  state: ComposerState
  project: Project
  selectedTrackId: string
  transportState: TransportState
  positionBeats: number
  snap: number
  setSnap: (grid: number) => void
  savedProjects: StoredProjectMeta[]
  recentProjectsState: RecentProjectsState
  refreshSavedProjects: () => Promise<void>
  status: string
  actionMessage: ProjectActionMessage | null
  hydration: ProjectHydrationState
  saveState: ProjectSaveState
  replacement: ProjectReplacementState
  audioReady: boolean
  isDirty: boolean
  isFlushing: boolean
  flushAutosave: () => Promise<void>
  settleActivePersistence: () => Promise<void>
  beginPersistenceTransition: () => void
  retryHydration: () => void
  continueToStartCenter: () => void
  retrySave: () => Promise<void>
  requestProjectReplacement: (
    request: ProjectReplacementRequest,
  ) => Promise<ProjectReplacementResult>
  retryProjectReplacement: () => Promise<ProjectReplacementResult>
  discardProjectReplacement: () => Promise<ProjectReplacementResult>
  cancelProjectReplacement: () => void
  discardAutosaveRecovery: () => void
  replaceWithBlank: () => Promise<ProjectReplacementResult>
  replaceWithDemo: () => Promise<ProjectReplacementResult>
  replaceWithTemplate: (template: SongTemplate) => Promise<ProjectReplacementResult>
  openStoredProject: (id: string) => Promise<ProjectReplacementResult>
  replaceWithMidi: (bytes: ArrayBuffer, name?: string) => Promise<ProjectReplacementResult>
  replaceWithMusicXml: (xml: string, name?: string) => Promise<ProjectReplacementResult>
  replaceWithProjectFile: (text: string, name?: string) => Promise<ProjectReplacementResult>
  replaceWithPluginFormat: (
    id: string,
    data: string,
    name?: string,
  ) => Promise<ProjectReplacementResult>
  /** Show a transient status message (used by the CommandApi `notify`). */
  notify: (message: string) => void
  notifyError: (message: string) => void

  /**
   * Single-user document history (#156): a bounded, gesture-coalescing undo
   * stack over LOCAL document mutations only (never selection/view state).
   * `load-project`/restore/import/remote-sync reset it rather than becoming
   * ordinary undo steps. INTERNAL to the app — deliberately excluded from the
   * frozen public {@link ComposerPublicApi} contract surface until undo/redo is
   * separately specced there. While a collaboration session is active, use
   * {@link setHistoryEnabled} to disable this stack so a single click can't
   * drive both the local history AND the collaborative `Y.UndoManager`
   * (`useCollaboration`'s `CollaborationState.undo`/`redo`) at once.
   */
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  /**
   * Enable/disable the single-user history stack. Callers that own the
   * collaboration lifecycle (e.g. the component wiring `useCollaboration`)
   * should disable this while a collaborative session is active/writable, and
   * re-enable it once collaboration ends. Always clears any retained entries
   * on either transition, since they may no longer correspond to a document
   * this controller advanced itself. INTERNAL — not part of
   * {@link ComposerPublicApi}.
   */
  setHistoryEnabled: (enabled: boolean) => void
  /** Group of the latest document mutation for collaborative capture coalescing. */
  historyCaptureGroup: string | null
  /** Monotonic explicit capture boundary (pointer-up/field commit/project switch). */
  historyCaptureBoundary: number
  /** Finish the current local/collaborative gesture capture group. */
  stopHistoryCapture: () => void
  /** Subscribe to every local document transition before React can batch renders. */
  subscribeProjectTransitions: (
    listener: (transition: ProjectTransition) => void,
  ) => () => void

  play: () => void
  pause: () => void
  stop: () => void
  togglePlay: () => void
  setTempo: (bpm: number) => void
  toggleLoop: () => void

  addNoteAt: (trackId: string, pitch: number, start: number, duration?: number) => void
  insertNotes: (
    trackId: string,
    notes: Array<{ pitch: number; start: number; duration: number; velocity: number }>,
  ) => void
  updateNote: (trackId: string, noteId: string, changes: Partial<Note>) => void
  removeNote: (trackId: string, noteId: string) => void
  /**
   * Quantize note starts toward `grid` by `strength` (0..1). Pass `noteIds` to
   * quantize just those notes (the current selection); omit it to quantize every
   * note in the track. INTERNAL to the app — not part of the frozen public
   * {@link ComposerController} contract surface.
   */
  quantizeNotes: (
    trackId: string,
    options: { grid: number; strength: number; noteIds?: string[] },
  ) => void
  selectNote: (noteId: string | null) => void
  previewNote: (pitch: number) => void
  /**
   * Latest "reveal these notes" request, bumped whenever a batch is inserted
   * (e.g. an accepted AI suggestion). The `token` monotonically increases so the
   * piano roll can scroll the freshly inserted region into view exactly once per
   * insert — without fighting the user's own scrolling. INTERNAL to the app; not
   * part of the frozen public {@link ComposerController} contract surface.
   */
  revealRequest: NoteRevealRequest

  addTrack: () => void
  removeTrack: (trackId: string) => void
  selectTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  setInstrument: (trackId: string, instrumentId: InstrumentId) => void
  toggleMute: (trackId: string) => void

  /**
   * Ids of the tracks the piano roll draws (#131 multi-track view): the selected
   * track (always, so it stays editable) plus any others toggled on as read-only
   * context. Memoized so unrelated renders don't recompute the overlay. INTERNAL
   * to the app — deliberately EPHEMERAL view state (not serialized into
   * `project`), so it needs no schema bump, and excluded from the frozen public
   * {@link ComposerPublicApi} contract surface.
   */
  visibleTrackIds: string[]
  /**
   * Toggle a track's read-only presence on the piano roll. The selected track is
   * always visible regardless, so toggling it is a no-op for the current view.
   */
  toggleTrackVisibility: (trackId: string) => void
  /** Show every track (`true`) or collapse back to just the selected one (`false`). */
  setAllTracksVisible: (visible: boolean) => void

  /**
   * Write (or replace) an automation point on a `(target, trackId)` lane. Master
   * targets omit `trackId`. Dispatches a reducer action so the edit persists via
   * autosave. INTERNAL to the app — not part of the frozen public
   * {@link ComposerPublicApi} contract surface, and deliberately applied on the
   * #44 mixer side, never the frozen #97 note-playback seam.
   */
  writeAutomationPoint: (
    target: AutomationTarget,
    trackId: string | undefined,
    point: AutomationPoint,
  ) => void
  /** Remove the automation point at `beat` from a `(target, trackId)` lane. */
  removeAutomationPoint: (
    target: AutomationTarget,
    trackId: string | undefined,
    beat: number,
  ) => void
  /** Clear an entire automation lane. */
  clearAutomationLane: (target: AutomationTarget, trackId?: string) => void

  setProjectName: (name: string) => void
  newProject: () => void
  loadDemo: () => void
  /**
   * Load a fully-formed in-memory {@link Project} (e.g. a built-in "house dub"
   * quick-start template) as a NEW project. INTERNAL to the app — not part of the
   * frozen public {@link ComposerController} contract surface.
   *
   * This reuses the existing `load-project` reducer path (same self-healing
   * length/loop as file/MIDI import) rather than inventing a parallel loader, and
   * is deliberately audio-neutral: it touches neither the engine nor the audio
   * subscribe effect (#97). It stamps a fresh project id so autosave treats the
   * template as a new document, and bumps the note-reveal request so the piano
   * roll scrolls the loaded arrangement into view (#98/#101), leaving it
   * immediately playable.
   */
  loadProjectSnapshot: (project: Project) => void
  /**
   * Adopt a project converged from a remote collaborator (Yjs CRDT). Unlike
   * {@link loadProject} this preserves the local cursor selection when it is
   * still valid, so live edits from peers don't yank the caret around.
   */
  applyRemoteProject: (project: Project) => void
  saveProject: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  importMidi: (bytes: ArrayBuffer, name?: string) => void
  exportMidi: () => Uint8Array
  exportMusicXml: () => string
  importMusicXml: (xml: string, name?: string) => void
  exportProjectFile: () => string
  importProjectFile: (text: string, name?: string) => void
  exportWav: () => Promise<Uint8Array | null>
  exportMp3: () => Promise<Uint8Array | null>
  shareSnapshot: () => ShareSnapshot
  /** File formats contributed through the plugin host (built-in + plugins). */
  formats: FormatContribution[]
  /** Export via a host-registered format; returns its bytes/text (or null). */
  exportFormat: (id: string) => string | Uint8Array | null
  /** Import via a host-registered format id. */
  importFormat: (id: string, data: string, name?: string) => void
  /** The #44 mixer controller (per-track strips, inserts, master bus, automation). */
  mixer: MixerController
  /**
   * Live MIDI hardware input (#111). INTERNAL to the app — deliberately excluded
   * from the frozen public {@link ComposerPublicApi} contract surface.
   */
  midi: ComposerMidi
}

function defaultProject(options: UseComposerOptions): Project {
  return options.initialProject ?? createEmptyProject('project_bootstrap')
}

/**
 * Single-user history bound (#156). A generous cap — far more than a real
 * editing session needs — that still keeps the retained snapshots bounded.
 */
const HISTORY_LIMIT = 100

/**
 * Actions that REPLACE the whole document (load/restore/import/remote-sync).
 * These reset/rebase single-user history rather than becoming ordinary undo
 * steps — undoing into a just-loaded/just-synced document would be surprising
 * and, for `sync-remote`, would fight the CRDT rather than the local reducer.
 */
const HISTORY_RESET_ACTIONS = new Set<ComposerAction['type']>([
  'load-project',
  'sync-remote',
])

/**
 * Actions that touch selection/view only, never the document. Excluded from
 * history entirely (per #156: "document mutations only, not selection/view").
 */
const HISTORY_IGNORED_ACTIONS = new Set<ComposerAction['type']>([
  'select-track',
  'select-notes',
  'clear-selection',
])

/**
 * Group key for coalescing continuous pointer/slider gestures into one undo
 * entry (#156). Only genuinely continuous edits get a key — dragging a note,
 * dragging an automation point, sliding tempo/loop — so a rapid burst of the
 * SAME gesture collapses, while discrete one-shot commands (add/remove a note,
 * rename a track, add/remove a track…) always get their own entry.
 */
function historyGroupKey(action: ComposerAction): string | undefined {
  switch (action.type) {
    case 'update-note':
      return `update-note:${action.trackId}:${action.noteId}`
    case 'write-automation-point':
      return `automation-point:${action.target}:${action.trackId ?? 'master'}`
    case 'set-tempo':
      return 'set-tempo'
    case 'set-loop':
      return 'set-loop'
    case 'rename-track':
      return `rename-track:${action.trackId}`
    case 'set-project-name':
      return 'set-project-name'
    default:
      return undefined
  }
}

/**
 * Apply an undone/redone project snapshot without disturbing the CURRENT
 * selection (undo/redo cover document mutations only — see #156). Mirrors the
 * cursor-preservation in the reducer's `sync-remote` case, but — unlike that
 * case — restores the snapshot's OWN automation lanes rather than overwriting
 * them with the live ones, since a single-user undo must fully revert the
 * document (including an undone automation edit).
 */
function applyHistorySnapshot(state: ComposerState, project: Project): ComposerState {
  const selectedTrackId = project.tracks.some((t) => t.id === state.selectedTrackId)
    ? state.selectedTrackId
    : (project.tracks[0]?.id ?? '')
  const liveNoteIds = new Set(
    project.tracks.find((t) => t.id === selectedTrackId)?.notes.map((n) => n.id) ?? [],
  )
  return {
    project,
    selectedTrackId,
    selectedNoteIds: state.selectedNoteIds.filter((id) => liveNoteIds.has(id)),
  }
}

/** Internal action applying a history-controller snapshot (undo/redo). */
interface HistoryApplyAction {
  type: '__history-apply'
  project: Project
}

type InternalComposerAction = ComposerAction | HistoryApplyAction

/**
 * Wraps the pure `composerReducer` so `useReducer` can also apply undo/redo
 * snapshots. Stays outside the component (and `composerReducer` untouched) so
 * the reducer stays pure and reusable; `applyHistorySnapshot` is the only extra
 * case, and it never touches `historyRef` itself (recording is a SEPARATE
 * effect in the hook body, driven off `state.project`, so it runs exactly once
 * per commit rather than inside the reducer call).
 */
function composerReducerWithHistory(
  state: ComposerState,
  action: InternalComposerAction,
): ComposerState {
  if (action.type === '__history-apply') return applyHistorySnapshot(state, action.project)
  return composerReducer(state, action)
}

export function useComposer(options: UseComposerOptions = {}): ComposerController {
  const autosaveDelay = options.autosaveDelay ?? 800
  const [store] = useState<ProjectStore>(() => options.store ?? createProjectStore())
  const [recoveryStorage] = useState<SyncStorage | null>(() =>
    options.initialProject
      ? null
      : options.recoveryStorage === undefined
        ? defaultRecoveryStorage()
        : options.recoveryStorage,
  )

  const [state, rawDispatch] = useReducer(
    composerReducerWithHistory,
    options,
    (opts) => initialState(defaultProject(opts)),
  )
  // Keep a ref to the latest project so event handlers read fresh data without
  // widening their dependency lists. The ref is written in an effect (not during
  // render) to satisfy the React Compiler ref rules. Declared before the
  // history wiring below since `dispatch` closes over it.
  const projectRef = useRef(state.project)
  const stateRef = useRef(state)
  useEffect(() => {
    projectRef.current = state.project
    stateRef.current = state
  }, [state])
  // #156 single-user history: a bounded, gesture-coalescing undo/redo stack
  // over document mutations only. Lazily created once via the
  // ref-is-still-null check (the documented pattern for one-time ref init).
  const historyRef = useRef<HistoryController<Project> | null>(null)
  if (historyRef.current === null) {
    historyRef.current = createHistoryController<Project>({ limit: HISTORY_LIMIT })
  }
  // Disabled while a collaboration session owns undo/redo via its own
  // `Y.UndoManager` (see `setHistoryEnabled`) — see the interface doc on
  // `ComposerController.setHistoryEnabled`.
  const historyEnabledRef = useRef(true)
  const historyCaptureBoundaryRef = useRef(0)
  const projectTransitionListenersRef = useRef(
    new Set<(transition: ProjectTransition) => void>(),
  )
  // Mirrors `historyRef`'s `canUndo()`/`canRedo()` into real React state —
  // reading a ref's `.current` during render (e.g. inline in the returned
  // object) is not safe, so every mutation point below explicitly syncs these
  // two flags instead of the render body computing them itself.
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [historyCapture, setHistoryCapture] = useState<{
    group: string | null
    boundary: number
  }>({ group: null, boundary: 0 })
  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current!.canUndo())
    setCanRedo(historyRef.current!.canRedo())
  }, [])
  const dispatch = useCallback((action: InternalComposerAction) => {
    const beforeState = stateRef.current
    const nextState = composerReducerWithHistory(beforeState, action)
    stateRef.current = nextState
    if (action.type === '__history-apply') {
      // Applying an undo/redo snapshot must never itself become a new entry.
    } else if (HISTORY_RESET_ACTIONS.has(action.type)) {
      historyRef.current!.clear()
      syncHistoryFlags()
      if (action.type === 'load-project') {
        historyCaptureBoundaryRef.current += 1
        setHistoryCapture(() => ({
          group: null,
          boundary: historyCaptureBoundaryRef.current,
        }))
      }
      if (action.type === 'load-project' && nextState.project !== beforeState.project) {
        const transition: ProjectTransition = {
          project: nextState.project,
          group: null,
          boundary: historyCaptureBoundaryRef.current,
          kind: 'replacement',
        }
        for (const listener of projectTransitionListenersRef.current) {
          listener(transition)
        }
      }
    } else if (!HISTORY_IGNORED_ACTIONS.has(action.type)) {
      const groupKey = historyGroupKey(action)
      setHistoryCapture((current) => ({
        ...current,
        group: groupKey ?? null,
      }))
      if (
        historyEnabledRef.current &&
        nextState.project !== beforeState.project
      ) {
        historyRef.current!.push(beforeState.project, nextState.project, groupKey)
        syncHistoryFlags()
      }
      if (nextState.project !== beforeState.project) {
        const transition: ProjectTransition = {
          project: nextState.project,
          group: groupKey ?? null,
          boundary: historyCaptureBoundaryRef.current,
          kind: 'mutation',
        }
        for (const listener of projectTransitionListenersRef.current) {
          listener(transition)
        }
      }
    }
    rawDispatch(action)
  }, [syncHistoryFlags])
  const undo = useCallback(() => {
    const project = historyRef.current!.undo()
    syncHistoryFlags()
    if (project !== undefined) dispatch({ type: '__history-apply', project })
  }, [dispatch, syncHistoryFlags])
  const redo = useCallback(() => {
    const project = historyRef.current!.redo()
    syncHistoryFlags()
    if (project !== undefined) dispatch({ type: '__history-apply', project })
  }, [dispatch, syncHistoryFlags])
  const setHistoryEnabled = useCallback(
    (enabled: boolean) => {
      historyEnabledRef.current = enabled
      // Any retained entries may no longer correspond to a document this
      // controller advanced on its own (e.g. a collaborative session just
      // took over, or just handed control back) — clear on either transition.
      historyRef.current!.clear()
      syncHistoryFlags()
    },
    [syncHistoryFlags],
  )
  const stopHistoryCapture = useCallback(() => {
    historyRef.current!.stopCapturing()
    historyCaptureBoundaryRef.current += 1
    setHistoryCapture(() => ({
      group: null,
      boundary: historyCaptureBoundaryRef.current,
    }))
  }, [])
  const subscribeProjectTransitions = useCallback(
    (listener: (transition: ProjectTransition) => void) => {
      projectTransitionListenersRef.current.add(listener)
      return () => projectTransitionListenersRef.current.delete(listener)
    },
    [],
  )
  const [snap, setSnap] = useState(0.25)
  const [transportState, setTransportState] = useState<TransportState>('stopped')
  const [positionBeats, setPositionBeats] = useState(0)
  const [savedProjects, setSavedProjects] = useState<StoredProjectMeta[]>([])
  const [recentProjectsState, setRecentProjectsState] = useState<RecentProjectsState>({
    status: 'loading',
  })
  const [status, setStatus] = useState('Ready')
  const [actionMessage, setActionMessage] = useState<ProjectActionMessage | null>(null)
  const [hydration, setHydration] = useState<ProjectHydrationState>(
    options.initialProject
      ? { status: 'ready-with-project', source: 'injected' }
      : { status: 'hydrating' },
  )
  const [hydrationAttempt, setHydrationAttempt] = useState(0)
  const [saveState, setSaveState] = useState<ProjectSaveState>(() => initialSaveState())
  const [replacement, setReplacement] = useState<ProjectReplacementState>({ status: 'idle' })
  const [isFlushing, setIsFlushing] = useState(false)
  const [persistenceBarrier, setPersistenceBarrier] = useState(false)
  const [joinedFailure, setJoinedFailure] = useState(0)
  const mountedRef = useRef(true)
  const actionSequenceRef = useRef(0)
  const recentRequestRef = useRef(0)
  const hydrationGenerationRef = useRef(0)
  const revisionRef = useRef(0)
  const savedRevisionRef = useRef(0)
  const persistenceGenerationRef = useRef(0)
  const failedRevisionRef = useRef<number | null>(null)
  const recoveryTokenRef = useRef<string | null>(null)
  const recoveryTokensRef = useRef(new Set<string>())
  const recoveryLineageRef = useRef(newRecoveryLineageId())
  const skipNextProjectRevisionRef = useRef(false)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushPromiseRef = useRef<Promise<void> | null>(null)
  const persistenceBarrierRef = useRef(false)
  const beginPersistenceTransition = useCallback(() => {
    persistenceBarrierRef.current = true
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    setPersistenceBarrier(true)
  }, [])
  const endPersistenceTransition = useCallback(() => {
    persistenceBarrierRef.current = false
    setPersistenceBarrier(false)
  }, [])
  const resetPersistenceForProject = useCallback((
    persisted: boolean,
    lineageId = newRecoveryLineageId(),
  ) => {
    persistenceGenerationRef.current += 1
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    revisionRef.current = 0
    savedRevisionRef.current = 0
    failedRevisionRef.current = null
    recoveryTokenRef.current = null
    recoveryTokensRef.current.clear()
    recoveryLineageRef.current = lineageId
    flushPromiseRef.current = null
    skipNextProjectRevisionRef.current = persisted
    setJoinedFailure(0)
    setIsFlushing(false)
    setSaveState(initialSaveState('clean'))
  }, [])
  // #131 multi-track view: ids of tracks shown on the piano roll as read-only
  // context, in ADDITION to the always-visible selected track. Deliberately
  // EPHEMERAL — it is view state, so it stays out of the persisted `project`
  // (no schema bump / migration) and resets to "just the selected track" on
  // reload. Never touches the audio seam; the engine still plays every track.
  const [contextTrackIds, setContextTrackIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  // Bumped whenever a batch of notes is inserted so the piano roll can reveal the
  // freshly placed region exactly once per insert (see `insertNotes`).
  const [revealRequest, setRevealRequest] = useState<NoteRevealRequest>(() => ({
    noteIds: [],
    token: 0,
  }))

  // Formats come from the plugin host so plugin-contributed exporters/importers
  // appear alongside the built-ins; re-read on any host lifecycle change.
  const [formats, setFormats] = useState<FormatContribution[]>(() =>
    defaultPluginHost.formats(),
  )
  useEffect(
    () => defaultPluginHost.subscribe(() => setFormats(defaultPluginHost.formats())),
    [],
  )

  const [engine] = useState<AudioEngine>(() => (options.createEngine ?? createAudioEngine)())
  const audioReady = useMemo(() => engine.constructor.name !== 'SilentAudioEngine', [engine])

  const announce = useCallback((text: string, tone: ProjectActionMessage['tone'] = 'info') => {
    setStatus(text)
    actionSequenceRef.current += 1
    setActionMessage({ id: actionSequenceRef.current, tone, text })
  }, [])
  useEffect(
    () => {
      mountedRef.current = true
      return () => {
        mountedRef.current = false
        if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current)
      }
    },
    [],
  )

  // --- Live MIDI input (#111) -------------------------------------------------
  // Additive and #97-safe: monitoring reuses engine.previewNote (the existing
  // preview/trigger seam) and recording commits through the existing insert-notes
  // reducer action. Nothing here subscribes to the engine or builds an audio path.
  const [midiArmed, setMidiArmed] = useState(false)
  const [midiQuantize, setMidiQuantize] = useState(false)
  // Open note-ons keyed by MIDI note number, awaiting their matching note-off.
  const captureRef = useRef(new Map<number, MidiCapture>())
  const midiArmedRef = useRef(midiArmed)
  const midiQuantizeRef = useRef(midiQuantize)
  const snapRef = useRef(snap)
  const selectedTrackIdRef = useRef(state.selectedTrackId)
  useEffect(() => {
    midiArmedRef.current = midiArmed
    midiQuantizeRef.current = midiQuantize
    snapRef.current = snap
    selectedTrackIdRef.current = state.selectedTrackId
  }, [midiArmed, midiQuantize, snap, state.selectedTrackId])

  // Subscribe to transport state + reschedule whenever the project changes.
  useEffect(() => {
    // StrictMode (dev) disposes the engine on the throwaway first mount; revive
    // the graph before re-subscribing so the remounted UI drives live audio, not
    // dead nodes (#97). This effect precedes the setProject effect below, so the
    // graph is rebuilt before the project is re-scheduled onto it.
    engine.ensureAlive()
    const off = engine.onStateChange((next) => {
      setTransportState(next)
      if (next === 'stopped') setPositionBeats(0)
    })
    return () => {
      off()
      engine.dispose()
    }
  }, [engine])

  useEffect(() => {
    engine.setProject(state.project)
  }, [engine, state.project])

  // Poll the audio clock for the playhead while playing (rAF, never setInterval).
  useEffect(() => {
    if (transportState !== 'playing') return
    if (typeof requestAnimationFrame === 'undefined') return
    let raf = 0
    const tick = () => {
      setPositionBeats(engine.positionBeats())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, transportState])

  const refreshList = useCallback(async () => {
    recentRequestRef.current += 1
    const request = recentRequestRef.current
    await Promise.resolve()
    if (mountedRef.current && request === recentRequestRef.current) {
      setRecentProjectsState({ status: 'loading' })
    }
    try {
      const projects = await store.list()
      if (mountedRef.current && request === recentRequestRef.current) {
        setSavedProjects(projects)
        setRecentProjectsState({ status: 'ready' })
      }
    } catch {
      if (mountedRef.current && request === recentRequestRef.current) {
        setRecentProjectsState({
          status: 'error',
          message: 'Cadence could not load your recent projects.',
        })
      }
    }
  }, [store])

  useEffect(() => {
    queueMicrotask(() => void refreshList())
  }, [refreshList, options.storeRevision])

  // Restore a shared project (URL fragment) or the last autosaved project on
  // first load — unless a project was explicitly injected (e.g. in tests). Keeps
  // work across reloads/sessions and lets a share link reopen a piece.
  useEffect(() => {
    if (options.initialProject) return
    let cancelled = false
    hydrationGenerationRef.current += 1
    const generation = hydrationGenerationRef.current
    const isCurrent = () =>
      !cancelled && hydrationGenerationRef.current === generation
    void (async () => {
      await Promise.resolve()
      if (!isCurrent()) return
      setHydration({ status: 'hydrating' })
      const shared =
        typeof window !== 'undefined'
          ? decodeProjectFromFragment(options.sharedProjectHash ?? window.location.hash)
          : null
      if (shared) {
        if (!isCurrent()) return
        resetPersistenceForProject(false)
        dispatch({ type: 'load-project', project: { ...shared, id: newId('project') } })
        setHydration({ status: 'ready-with-project', source: 'shared' })
        announce('Opened shared project', 'success')
        options.onSharedProjectConsumed?.()
        return
      }

      try {
        const recovery = options.recoveryScope
          ? readProjectRecovery(recoveryStorage, options.recoveryScope)
          : null
        if (recovery) {
          if (!isCurrent()) return
          resetPersistenceForProject(false, recovery.lineageId)
          recoveryTokenRef.current = recovery.token
          recoveryTokensRef.current.add(recovery.token)
          dispatch({ type: 'load-project', project: recovery.project })
          setHydration({ status: 'ready-with-project', source: 'recovery' })
          announce('Recovered unsaved changes', 'success')
          return
        }
        const project = await store.loadLast()
        if (!isCurrent()) return
        if (project) {
          resetPersistenceForProject(true)
          dispatch({ type: 'load-project', project })
          setHydration({ status: 'ready-with-project', source: 'last' })
          return
        }
        setHydration({ status: 'ready-without-project' })
      } catch {
        if (isCurrent()) {
          setHydration({
            status: 'restore-error',
            message: 'Cadence could not restore your last project.',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // Router hash cleanup must not trigger a second pass; identity/backend changes must.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    store,
    hydrationAttempt,
    options.storeRevision,
    options.recoveryScope,
    resetPersistenceForProject,
  ])

  const retryHydration = useCallback(() => {
    setHydrationAttempt((attempt) => attempt + 1)
  }, [])

  const continueToStartCenter = useCallback(() => {
    setHydration({ status: 'ready-without-project' })
  }, [])

  const persist = useCallback(
    async (project: Project) => {
      if (store.persist) {
        await store.persist(project)
        return
      }
      await store.save(project)
      await store.setLast(project.id)
    },
    [store],
  )

  const flushAutosave = useCallback((): Promise<void> => {
    if (autosaveTimerRef.current !== null) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    if (flushPromiseRef.current) return flushPromiseRef.current
    if (persistenceBarrierRef.current) return Promise.resolve()
    if (hydration.status !== 'ready-with-project') return Promise.resolve()
    const generation = persistenceGenerationRef.current
    const isCurrent = () => persistenceGenerationRef.current === generation
    if (mountedRef.current) setIsFlushing(true)
    const savingRevision = revisionRef.current
    if (mountedRef.current) {
      setSaveState((current) => ({
        ...current,
        status: 'saving',
        revision: revisionRef.current,
        persistedRevision: savedRevisionRef.current,
        savingRevision,
        message: null,
      }))
    }

    const flush = async () => {
      let attemptedRevision = savedRevisionRef.current
      try {
        while (isCurrent() && savedRevisionRef.current < revisionRef.current) {
          attemptedRevision = revisionRef.current
          const project = projectRef.current
          const recoveryTokens = [...recoveryTokensRef.current]
          const recoveryHeadToken = recoveryTokenRef.current
          await persist(project)
          if (!isCurrent()) return
          savedRevisionRef.current = Math.max(savedRevisionRef.current, attemptedRevision)
          if (
            failedRevisionRef.current !== null &&
            savedRevisionRef.current >= failedRevisionRef.current
          ) {
            failedRevisionRef.current = null
          }
          if (options.recoveryScope) {
            clearProjectRecoveryChain(
              recoveryStorage,
              options.recoveryScope,
              project.id,
              recoveryHeadToken,
            )
            for (const token of recoveryTokens) recoveryTokensRef.current.delete(token)
            if (
              recoveryTokenRef.current &&
              recoveryTokens.includes(recoveryTokenRef.current)
            ) {
              recoveryTokenRef.current = null
            }
          }
          void refreshList()
        }
        if (!isCurrent()) return
        if (mountedRef.current) {
          const fullySaved = savedRevisionRef.current >= revisionRef.current
          setSaveState({
            status: fullySaved ? 'saved' : 'dirty',
            revision: revisionRef.current,
            persistedRevision: savedRevisionRef.current,
            savingRevision: null,
            savedAt: Date.now(),
            message: null,
          })
        }
      } catch (error) {
        if (!isCurrent()) return
        failedRevisionRef.current = attemptedRevision
        if (mountedRef.current) {
          if (revisionRef.current > attemptedRevision) {
            setJoinedFailure((value) => value + 1)
          }
          setSaveState((current) => ({
            ...current,
            status: 'error',
            revision: revisionRef.current,
            persistedRevision: savedRevisionRef.current,
            savingRevision: null,
            message: 'Cadence could not save your latest changes.',
          }))
        }
        throw error
      }
    }
    const pending = flush().finally(() => {
      if (!isCurrent()) return
      if (flushPromiseRef.current === pending) flushPromiseRef.current = null
      if (mountedRef.current) {
        setIsFlushing(false)
      }
    })
    flushPromiseRef.current = pending
    return pending
  }, [
    hydration.status,
    persist,
    recoveryStorage,
    refreshList,
    options.recoveryScope,
  ])

  const settleActivePersistence = useCallback(async () => {
    const active = flushPromiseRef.current
    if (!active) return
    try {
      await active
    } catch {
      // Explicit discard callers need the transaction settled, not successful.
    }
  }, [])

  // A failed in-flight save may have been joined by a newer revision's debounce.
  // Once that attempt settles, queue one normal-delay retry for any still-dirty
  // revision. Repeated failures remain spaced by the debounce (never a hot loop).
  useEffect(() => {
    if (
      joinedFailure === 0 ||
      persistenceBarrier ||
      savedRevisionRef.current >= revisionRef.current ||
      autosaveTimerRef.current !== null
    ) {
      return
    }
    const retryDelay = Math.max(autosaveDelay, 250)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void flushAutosave()
        .catch(() => undefined)
    }, retryDelay)
    return () => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [autosaveDelay, flushAutosave, joinedFailure, persistenceBarrier])

  // Debounced autosave on any project change. Explicit route-exit flushes cancel
  // this timer and await the same serialized persistence path.
  useEffect(() => {
    if (persistenceBarrier) return
    if (hydration.status !== 'ready-with-project') return
    if (skipNextProjectRevisionRef.current) {
      skipNextProjectRevisionRef.current = false
      return
    }
    revisionRef.current += 1
    if (
      failedRevisionRef.current !== null &&
      revisionRef.current > failedRevisionRef.current
    ) {
      failedRevisionRef.current = null
    }
    if (options.recoveryScope) {
      const previousToken = recoveryTokenRef.current
      const write = writeProjectRecovery(
        recoveryStorage,
        options.recoveryScope,
        state.project,
        revisionRef.current,
        recoveryLineageRef.current,
        previousToken,
      )
      if (write) {
        recoveryTokenRef.current = write.token
        recoveryTokensRef.current.add(write.token)
      }
    }
    setSaveState((current) => ({
      ...current,
      status: 'dirty',
      revision: revisionRef.current,
      persistedRevision: savedRevisionRef.current,
      savingRevision: null,
      message: null,
    }))
    if (autosaveTimerRef.current !== null) clearTimeout(autosaveTimerRef.current)
    if (autosaveDelay <= 0) {
      void flushAutosave().catch(() => undefined)
      return
    }
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      if (failedRevisionRef.current === revisionRef.current) return
      void flushAutosave().catch(() => undefined)
    }, autosaveDelay)
    return () => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current)
        autosaveTimerRef.current = null
      }
    }
  }, [
    state.project,
    autosaveDelay,
    flushAutosave,
    hydration.status,
    recoveryStorage,
    options.recoveryScope,
    persistenceBarrier,
  ])

  const play = useCallback(() => {
    void engine.play()
  }, [engine])
  const pause = useCallback(() => engine.pause(), [engine])
  const stop = useCallback(() => engine.stop(), [engine])
  const togglePlay = useCallback(() => {
    if (transportState === 'playing') engine.pause()
    else void engine.play()
  }, [engine, transportState])

  const setTempo = useCallback((bpm: number) => dispatch({ type: 'set-tempo', tempo: bpm }), [dispatch])
  const toggleLoop = useCallback(() => {
    dispatch({ type: 'toggle-loop' })
  }, [dispatch])

  const addNoteAt = useCallback(
    (trackId: string, pitch: number, start: number, duration = 1) => {
      const note = createNote({ pitch, start, duration, velocity: 0.8 }, newId('note'))
      dispatch({ type: 'add-note', trackId, note })
    },
    [dispatch],
  )
  // Insert a batch of notes (e.g. an accepted AI suggestion) in one transition.
  // A single `insert-notes` dispatch (rather than a loop of `add-note`) keeps it
  // one undo step and leaves ALL inserted notes selected — then we bump
  // `revealRequest` so the piano roll scrolls the placed region into view. The
  // notes are still sanitized/clamped by the reducer, so the accept path never
  // bypasses model validation.
  const insertNotes = useCallback(
    (
      trackId: string,
      notes: Array<{ pitch: number; start: number; duration: number; velocity: number }>,
    ) => {
      if (notes.length === 0) return
      const created = notes.map((n) => createNote(n, newId('note')))
      dispatch({ type: 'insert-notes', trackId, notes: created })
      setRevealRequest((prev) => ({
        noteIds: created.map((n) => n.id),
        token: prev.token + 1,
      }))
    },
    [dispatch],
  )
  const updateNote = useCallback(
    (trackId: string, noteId: string, changes: Partial<Note>) =>
      dispatch({ type: 'update-note', trackId, noteId, changes }),
    [dispatch],
  )
  const removeNote = useCallback(
    (trackId: string, noteId: string) => dispatch({ type: 'remove-note', trackId, noteId }),
    [dispatch],
  )
  const quantizeNotes = useCallback(
    (
      trackId: string,
      options: { grid: number; strength: number; noteIds?: string[] },
    ) =>
      dispatch({
        type: 'quantize-notes',
        trackId,
        grid: options.grid,
        strength: options.strength,
        noteIds: options.noteIds,
      }),
    [dispatch],
  )
  const selectNote = useCallback(
    (noteId: string | null) =>
      dispatch(
        noteId ? { type: 'select-notes', noteIds: [noteId] } : { type: 'clear-selection' },
      ),
    [dispatch],
  )
  const previewNote = useCallback(
    (pitch: number) => {
      const track = selectSelectedTrack(state)
      if (track) engine.previewNote(track, pitch)
    },
    [engine, state],
  )

  // Live-monitor an incoming MIDI note through the EXISTING preview seam, and —
  // only while armed and the transport is rolling — capture it for recording.
  const handleMidiNoteOn = useCallback(
    (note: number, rawVelocity: number) => {
      const project = projectRef.current
      const track =
        project.tracks.find((t) => t.id === selectedTrackIdRef.current) ?? project.tracks[0]
      if (track) {
        engine.previewNote(track, note, MIDI_MONITOR_DURATION, normalizeVelocity(rawVelocity))
      }
      if (!midiArmedRef.current || engine.state !== 'playing') return
      const trackId = selectedTrackIdRef.current
      if (!trackId) return
      captureRef.current.set(note, {
        trackId,
        pitch: note,
        startBeat: engine.positionBeats(),
        velocity: rawVelocity,
      })
    },
    [engine],
  )
  // Close an open capture on note-off and commit it via the EXISTING insert path
  // so undo/serialize/collaboration all keep working unchanged.
  const handleMidiNoteOff = useCallback(
    (note: number) => {
      const capture = captureRef.current.get(note)
      if (!capture) return
      captureRef.current.delete(note)
      const recorded = recordedNoteFrom(capture, engine.positionBeats(), {
        enabled: midiQuantizeRef.current,
        grid: snapRef.current,
      })
      insertNotes(capture.trackId, [recorded])
    },
    [engine, insertNotes],
  )
  const midiInput = useMidiInput({
    enabled: options.midiEnabled ?? true,
    requestAccess: options.requestMidiAccess,
    onNoteOn: handleMidiNoteOn,
    onNoteOff: handleMidiNoteOff,
  })
  // Discard any half-captured notes when disarmed or the transport stops, so a
  // held key can't dangle across takes.
  useEffect(() => {
    if (!midiArmed || transportState !== 'playing') captureRef.current.clear()
  }, [midiArmed, transportState])
  const toggleMidiArmed = useCallback(() => setMidiArmed((armed) => !armed), [])

  const notify = useCallback((message: string) => announce(message), [announce])
  const notifyError = useCallback(
    (message: string) => announce(message, 'error'),
    [announce],
  )

  const addTrack = useCallback(() => {
    const index = projectRef.current.tracks.length
    dispatch({
      type: 'add-track',
      track: createTrack(
        { name: `Track ${index + 1}`, color: trackColorForIndex(index) },
        newId('track'),
      ),
    })
  }, [dispatch])
  const removeTrack = useCallback(
    (trackId: string) => dispatch({ type: 'remove-track', trackId }),
    [dispatch],
  )
  const selectTrack = useCallback(
    (trackId: string) => dispatch({ type: 'select-track', trackId }),
    [dispatch],
  )
  const renameTrack = useCallback(
    (trackId: string, name: string) => dispatch({ type: 'rename-track', trackId, name }),
    [dispatch],
  )
  const setInstrument = useCallback(
    (trackId: string, instrumentId: InstrumentId) =>
      dispatch({ type: 'set-track-instrument', trackId, instrumentId }),
    [dispatch],
  )
  const toggleMute = useCallback(
    (trackId: string) => dispatch({ type: 'toggle-track-muted', trackId }),
    [dispatch],
  )

  // #131 multi-track view controls (all EPHEMERAL view state — see contextTrackIds).
  const toggleTrackVisibility = useCallback((trackId: string) => {
    setContextTrackIds((prev) => {
      const next = new Set(prev)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }, [])
  const setAllTracksVisible = useCallback((visible: boolean) => {
    setContextTrackIds(
      visible ? new Set(projectRef.current.tracks.map((t) => t.id)) : new Set(),
    )
  }, [])
  // Memoized so a note edit (which changes `state.project`) doesn't churn the
  // overlay unless the track set, the selection, or visibility actually changed.
  const visibleTrackIds = useMemo(
    () =>
      selectVisibleTrackIds(
        state.project.tracks,
        contextTrackIds,
        state.selectedTrackId,
      ),
    [state.project.tracks, contextTrackIds, state.selectedTrackId],
  )

  const writeAutomationPoint = useCallback(
    (target: AutomationTarget, trackId: string | undefined, point: AutomationPoint) =>
      dispatch({ type: 'write-automation-point', target, trackId, point }),
    [dispatch],
  )
  const removeAutomationPoint = useCallback(
    (target: AutomationTarget, trackId: string | undefined, beat: number) =>
      dispatch({ type: 'remove-automation-point', target, trackId, beat }),
    [dispatch],
  )
  const clearAutomationLane = useCallback(
    (target: AutomationTarget, trackId?: string) =>
      dispatch({ type: 'clear-automation-lane', target, trackId }),
    [dispatch],
  )

  const setProjectName = useCallback(
    (name: string) => dispatch({ type: 'set-project-name', name }),
    [dispatch],
  )
  const installReplacement = useCallback(
    async (request: ProjectReplacementRequest): Promise<void> => {
      const project =
        request.project ?? (request.loadId ? await store.load(request.loadId) : null)
      if (!project) throw new Error('Project not found')
      if (request.persisted) await store.setLast(project.id)
      endPersistenceTransition()
      resetPersistenceForProject(request.persisted)
      dispatch({ type: 'load-project', project })
      setHydration({ status: 'ready-with-project', source: 'created' })
      setReplacement({ status: 'idle' })

      const revealNotes = project.tracks[0]?.notes ?? []
      if (revealNotes.length > 0) {
        setRevealRequest((prev) => ({
          noteIds: revealNotes.map((note) => note.id),
          token: prev.token + 1,
        }))
      }
      announce(
        request.source === 'open' ? `Opened “${project.name}”` : request.label,
        'success',
      )
      await refreshList()
    },
    [
      announce,
      dispatch,
      endPersistenceTransition,
      refreshList,
      resetPersistenceForProject,
      store,
    ],
  )

  const requestProjectReplacement = useCallback(
    async (request: ProjectReplacementRequest): Promise<ProjectReplacementResult> => {
      const mustFlush =
        hydration.status === 'ready-with-project' &&
        (savedRevisionRef.current < revisionRef.current || flushPromiseRef.current !== null)
      if (mustFlush) {
        setReplacement({ status: 'flushing', request })
        try {
          await flushAutosave()
        } catch {
          setReplacement({
            status: 'blocked',
            request,
            message: 'Cadence could not save the current project.',
          })
          return 'blocked'
        }
      }

      beginPersistenceTransition()
      try {
        await installReplacement(request)
        return 'replaced'
      } catch {
        endPersistenceTransition()
        setReplacement({ status: 'idle' })
        announce(
          request.source === 'open'
            ? 'Could not open project'
            : 'Cadence could not finish switching projects.',
          'error',
        )
        return 'failed'
      }
    },
    [
      announce,
      beginPersistenceTransition,
      endPersistenceTransition,
      flushAutosave,
      hydration.status,
      installReplacement,
    ],
  )

  const retryProjectReplacement = useCallback(async (): Promise<ProjectReplacementResult> => {
    if (replacement.status !== 'blocked') return 'failed'
    return requestProjectReplacement(replacement.request)
  }, [replacement, requestProjectReplacement])

  const discardProjectReplacement = useCallback(async (): Promise<ProjectReplacementResult> => {
    if (replacement.status !== 'blocked') return 'failed'
    beginPersistenceTransition()
    await settleActivePersistence()
    if (options.recoveryScope) {
      clearProjectRecoveryChain(
        recoveryStorage,
        options.recoveryScope,
        projectRef.current.id,
        recoveryTokenRef.current,
      )
      recoveryTokensRef.current.clear()
      recoveryTokenRef.current = null
    }
    try {
      await installReplacement(replacement.request)
      return 'replaced'
    } catch {
      endPersistenceTransition()
      setReplacement({ status: 'idle' })
      announce(
        replacement.request.source === 'open'
          ? 'Could not open project'
          : 'Cadence could not finish switching projects.',
        'error',
      )
      return 'failed'
    }
  }, [
    announce,
    beginPersistenceTransition,
    endPersistenceTransition,
    installReplacement,
    options.recoveryScope,
    recoveryStorage,
    replacement,
    settleActivePersistence,
  ])

  const cancelProjectReplacement = useCallback(() => {
    setReplacement({ status: 'idle' })
  }, [])

  const discardAutosaveRecovery = useCallback(() => {
    if (!options.recoveryScope) return
    clearProjectRecoveryChain(
      recoveryStorage,
      options.recoveryScope,
      projectRef.current.id,
      recoveryTokenRef.current,
    )
    recoveryTokensRef.current.clear()
    recoveryTokenRef.current = null
  }, [options.recoveryScope, recoveryStorage])

  const replaceWithBlank = useCallback(
    () =>
      requestProjectReplacement({
        source: 'blank',
        project: createEmptyProject(newId('project')),
        label: 'Created a blank project',
        persisted: false,
      }),
    [requestProjectReplacement],
  )

  const replaceWithDemo = useCallback(
    () =>
      requestProjectReplacement({
        source: 'demo',
        project: createDemoProject(newId('project')),
        label: 'Loaded demo',
        persisted: false,
      }),
    [requestProjectReplacement],
  )

  const replaceWithTemplate = useCallback(
    (template: SongTemplate) =>
      requestProjectReplacement({
        source: 'template',
        project: { ...template.build(), id: newId('project') },
        label: `Loaded “${template.name}”`,
        persisted: false,
      }),
    [requestProjectReplacement],
  )

  const openStoredProject = useCallback(
    async (id: string): Promise<ProjectReplacementResult> => {
      const result = await requestProjectReplacement({
        source: 'open',
        loadId: id,
        label: 'Opened project',
        persisted: true,
      })
      if (result === 'blocked') return result
      if (result === 'failed') announce('Could not open project', 'error')
      return result
    },
    [announce, requestProjectReplacement],
  )

  const replaceWithMidi = useCallback(
    async (bytes: ArrayBuffer, name?: string): Promise<ProjectReplacementResult> => {
      try {
        const project = midiBytesToProject(bytes, { id: newId('project'), name })
        return requestProjectReplacement({
          source: 'import-midi',
          project,
          label: 'Imported MIDI',
          persisted: false,
        })
      } catch {
        announce("Couldn't import that file - is it a valid MIDI file?", 'error')
        return 'failed'
      }
    },
    [announce, requestProjectReplacement],
  )

  const replaceWithMusicXml = useCallback(
    async (xml: string, name?: string): Promise<ProjectReplacementResult> => {
      try {
        const project = musicXmlToProject(xml, { id: newId('project'), name })
        return requestProjectReplacement({
          source: 'import-musicxml',
          project,
          label: 'Imported MusicXML',
          persisted: false,
        })
      } catch {
        announce("Couldn't import that file - is it valid MusicXML?", 'error')
        return 'failed'
      }
    },
    [announce, requestProjectReplacement],
  )

  const replaceWithProjectFile = useCallback(
    async (text: string, name?: string): Promise<ProjectReplacementResult> => {
      try {
        const project = fileToProject(text, { id: newId('project'), name })
        return requestProjectReplacement({
          source: 'import-project',
          project,
          label: 'Opened project file',
          persisted: false,
        })
      } catch {
        announce("Couldn't open that file - is it a Cadence project?", 'error')
        return 'failed'
      }
    },
    [announce, requestProjectReplacement],
  )

  const replaceWithPluginFormat = useCallback(
    async (
      id: string,
      data: string,
      name?: string,
    ): Promise<ProjectReplacementResult> => {
      const format = defaultPluginHost.formats().find((candidate) => candidate.id === id)
      if (!format?.import) return 'failed'
      try {
        const imported = format.import(data, { id: newId('project'), name })
        const project = migrateProject(imported)
        return requestProjectReplacement({
          source: 'import-plugin',
          project: { ...project, id: newId('project') },
          label: `Imported ${format.name}`,
          persisted: false,
        })
      } catch {
        announce(`Couldn't import that ${format.name} file`, 'error')
        return 'failed'
      }
    },
    [announce, requestProjectReplacement],
  )

  const newProject = useCallback(() => {
    void replaceWithBlank()
  }, [replaceWithBlank])
  const loadDemo = useCallback(() => {
    void replaceWithDemo()
  }, [replaceWithDemo])
  const loadProjectSnapshot = useCallback(
    (incoming: Project) => {
      void requestProjectReplacement({
        source: 'template',
        project: { ...incoming, id: newId('project') },
        label: `Loaded “${incoming.name}”`,
        persisted: false,
      })
    },
    [requestProjectReplacement],
  )
  const applyRemoteProject = useCallback((project: Project) => {
    dispatch({ type: 'sync-remote', project })
  }, [dispatch])
  const saveProject = useCallback(async () => {
    await flushAutosave()
    if (mountedRef.current) announce('Saved', 'success')
  }, [announce, flushAutosave])
  const loadProject = useCallback(
    async (id: string) => {
      await openStoredProject(id)
    },
    [openStoredProject],
  )
  const importMidi = useCallback((bytes: ArrayBuffer, name?: string) => {
    void replaceWithMidi(bytes, name)
  }, [replaceWithMidi])
  const exportMidi = useCallback(() => {
    announce('Exported MIDI', 'success')
    return projectToMidiBytes(projectRef.current)
  }, [announce])
  const exportMusicXml = useCallback(() => {
    announce('Exported MusicXML', 'success')
    return projectToMusicXml(projectRef.current)
  }, [announce])
  const importMusicXml = useCallback((xml: string, name?: string) => {
    void replaceWithMusicXml(xml, name)
  }, [replaceWithMusicXml])
  const exportProjectFile = useCallback(() => {
    announce('Exported project file', 'success')
    return projectToFile(projectRef.current)
  }, [announce])
  const importProjectFile = useCallback((text: string, name?: string) => {
    void replaceWithProjectFile(text, name)
  }, [replaceWithProjectFile])
  const exportWav = useCallback(async (): Promise<Uint8Array | null> => {
    announce('Rendering audio')
    try {
      const { bytes } = await renderProjectToWav(projectRef.current, {
        renderOffline: options.audioRenderer,
        watermark: options.watermarkExports ?? true,
      })
      announce('Exported WAV', 'success')
      return bytes
    } catch {
      announce("Couldn't render audio in this environment", 'error')
      return null
    }
  }, [announce, options.audioRenderer, options.watermarkExports])
  // MP3 mirrors WAV: same offline render, same pre-encode watermark, same
  // entitlement gate. The encoder module (LAME) is lazy-imported so it only loads
  // when MP3 is actually exported.
  const exportMp3 = useCallback(async (): Promise<Uint8Array | null> => {
    announce('Rendering audio')
    try {
      const { renderProjectToMp3 } = await import('../formats/mp3Export')
      const { bytes } = await renderProjectToMp3(projectRef.current, {
        renderOffline: options.audioRenderer,
        watermark: options.watermarkExports ?? true,
      })
      announce('Exported MP3', 'success')
      return bytes
    } catch {
      announce("Couldn't render audio in this environment", 'error')
      return null
    }
  }, [announce, options.audioRenderer, options.watermarkExports])
  const shareSnapshot = useCallback((): ShareSnapshot => {
    const snapshot = createShareSnapshot(projectRef.current)
    announce(
      snapshot.kind === 'url'
        ? 'Copied a shareable link'
        : 'Project too large for a link - share the file',
      'success',
    )
    return snapshot
  }, [announce])

  // Generic export/import through the plugin host, keyed by format id. These let
  // the toolbar drive plugin-contributed formats with no per-format code.
  const exportFormat = useCallback(
    (id: string): string | Uint8Array | null => {
      const format = defaultPluginHost.formats().find((f) => f.id === id)
      if (!format?.export) return null
      announce(`Exported ${format.name}`, 'success')
      return format.export(projectRef.current)
    },
    [announce],
  )
  const importFormat = useCallback((id: string, data: string, name?: string) => {
    void replaceWithPluginFormat(id, data, name)
  }, [replaceWithPluginFormat])

  const retrySave = useCallback(async () => {
    await flushAutosave()
  }, [flushAutosave])

  return {
    state,
    project: state.project,
    selectedTrackId: state.selectedTrackId,
    transportState,
    positionBeats,
    snap,
    setSnap,
    savedProjects,
    recentProjectsState,
    refreshSavedProjects: refreshList,
    status,
    actionMessage,
    hydration,
    saveState,
    replacement,
    audioReady,
    isDirty: saveState.revision > saveState.persistedRevision,
    isFlushing,
    flushAutosave,
    settleActivePersistence,
    beginPersistenceTransition,
    retryHydration,
    continueToStartCenter,
    retrySave,
    requestProjectReplacement,
    retryProjectReplacement,
    discardProjectReplacement,
    cancelProjectReplacement,
    discardAutosaveRecovery,
    replaceWithBlank,
    replaceWithDemo,
    replaceWithTemplate,
    openStoredProject,
    replaceWithMidi,
    replaceWithMusicXml,
    replaceWithProjectFile,
    replaceWithPluginFormat,
    notify,
    notifyError,
    canUndo,
    canRedo,
    undo,
    redo,
    setHistoryEnabled,
    historyCaptureGroup: historyCapture.group,
    historyCaptureBoundary: historyCapture.boundary,
    stopHistoryCapture,
    subscribeProjectTransitions,
    play,
    pause,
    stop,
    togglePlay,
    setTempo,
    toggleLoop,
    addNoteAt,
    insertNotes,
    updateNote,
    removeNote,
    quantizeNotes,
    selectNote,
    previewNote,
    revealRequest,
    addTrack,
    removeTrack,
    selectTrack,
    renameTrack,
    setInstrument,
    toggleMute,
    visibleTrackIds,
    toggleTrackVisibility,
    setAllTracksVisible,
    writeAutomationPoint,
    removeAutomationPoint,
    clearAutomationLane,
    setProjectName,
    newProject,
    loadDemo,
    loadProjectSnapshot,
    applyRemoteProject,
    saveProject,
    loadProject,
    importMidi,
    exportMidi,
    exportMusicXml,
    importMusicXml,
    exportProjectFile,
    importProjectFile,
    exportWav,
    exportMp3,
    shareSnapshot,
    formats,
    exportFormat,
    importFormat,
    mixer: engine.mixer,
    midi: {
      supported: midiInput.supported,
      inputs: midiInput.inputs,
      selectedInputId: midiInput.selectedInputId,
      selectInput: midiInput.selectInput,
      connected: midiInput.connected,
      armed: midiArmed,
      toggleArmed: toggleMidiArmed,
      quantize: midiQuantize,
      setQuantize: setMidiQuantize,
    },
  }
}
