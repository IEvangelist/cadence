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
  type ComposerState,
  composerReducer,
  initialState,
  selectedTrack as selectSelectedTrack,
} from '../model/reducer'
import {
  type ProjectStore,
  type StoredProjectMeta,
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
  status: string
  audioReady: boolean
  /** Show a transient status message (used by the CommandApi `notify`). */
  notify: (message: string) => void

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
  return options.initialProject ?? createDemoProject()
}

export function useComposer(options: UseComposerOptions = {}): ComposerController {
  const autosaveDelay = options.autosaveDelay ?? 800
  const [store] = useState<ProjectStore>(() => options.store ?? createProjectStore())

  const [state, dispatch] = useReducer(
    composerReducer,
    options,
    (opts) => initialState(defaultProject(opts)),
  )
  const [snap, setSnap] = useState(0.25)
  const [transportState, setTransportState] = useState<TransportState>('stopped')
  const [positionBeats, setPositionBeats] = useState(0)
  const [savedProjects, setSavedProjects] = useState<StoredProjectMeta[]>([])
  const [status, setStatus] = useState('Ready')
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

  // Keep a ref to the latest project so event handlers read fresh data without
  // widening their dependency lists. The ref is written in an effect (not during
  // render) to satisfy the React Compiler ref rules.
  const projectRef = useRef(state.project)
  useEffect(() => {
    projectRef.current = state.project
  }, [state.project])

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

  const refreshList = useCallback(() => {
    void store.list().then(setSavedProjects)
  }, [store])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  // Restore a shared project (URL fragment) or the last autosaved project on
  // first load — unless a project was explicitly injected (e.g. in tests). Keeps
  // work across reloads/sessions and lets a share link reopen a piece.
  useEffect(() => {
    if (options.initialProject) return
    let cancelled = false
    const shared =
      typeof window !== 'undefined'
        ? decodeProjectFromFragment(window.location.hash)
        : null
    if (shared) {
      // Defer to a microtask so we don't call setState synchronously inside the
      // effect body (mirrors the async loadLast path below).
      void Promise.resolve().then(() => {
        if (cancelled) return
        dispatch({ type: 'load-project', project: { ...shared, id: newId('project') } })
        setStatus('Opened shared project')
        // Clear the fragment so a reload/autosave doesn't re-import it.
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search,
          )
        }
      })
      return () => {
        cancelled = true
      }
    }
    void store.loadLast().then((project) => {
      if (!cancelled && project) dispatch({ type: 'load-project', project })
    })
    return () => {
      cancelled = true
    }
    // Run once on mount for the resolved store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  const persist = useCallback(
    async (project: Project) => {
      await store.save(project)
      await store.setLast(project.id)
      refreshList()
    },
    [store, refreshList],
  )

  // Debounced autosave on any project change.
  useEffect(() => {
    if (autosaveDelay <= 0) {
      void persist(state.project)
      return
    }
    const id = setTimeout(() => {
      void persist(state.project).then(() => setStatus('Autosaved'))
    }, autosaveDelay)
    return () => clearTimeout(id)
  }, [state.project, autosaveDelay, persist])

  const play = useCallback(() => {
    void engine.play()
  }, [engine])
  const pause = useCallback(() => engine.pause(), [engine])
  const stop = useCallback(() => engine.stop(), [engine])
  const togglePlay = useCallback(() => {
    if (transportState === 'playing') engine.pause()
    else void engine.play()
  }, [engine, transportState])

  const setTempo = useCallback((bpm: number) => dispatch({ type: 'set-tempo', tempo: bpm }), [])
  const toggleLoop = useCallback(() => {
    dispatch({ type: 'set-loop', loop: { enabled: !projectRef.current.loop.enabled } })
  }, [])

  const addNoteAt = useCallback(
    (trackId: string, pitch: number, start: number, duration = 1) => {
      const note = createNote({ pitch, start, duration, velocity: 0.8 }, newId('note'))
      dispatch({ type: 'add-note', trackId, note })
    },
    [],
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
    [],
  )
  const updateNote = useCallback(
    (trackId: string, noteId: string, changes: Partial<Note>) =>
      dispatch({ type: 'update-note', trackId, noteId, changes }),
    [],
  )
  const removeNote = useCallback(
    (trackId: string, noteId: string) => dispatch({ type: 'remove-note', trackId, noteId }),
    [],
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
    [],
  )
  const selectNote = useCallback(
    (noteId: string | null) =>
      dispatch(
        noteId ? { type: 'select-notes', noteIds: [noteId] } : { type: 'clear-selection' },
      ),
    [],
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

  const notify = useCallback((message: string) => setStatus(message), [])

  const addTrack = useCallback(() => {
    const index = projectRef.current.tracks.length
    dispatch({
      type: 'add-track',
      track: createTrack(
        { name: `Track ${index + 1}`, color: trackColorForIndex(index) },
        newId('track'),
      ),
    })
  }, [])
  const removeTrack = useCallback(
    (trackId: string) => dispatch({ type: 'remove-track', trackId }),
    [],
  )
  const selectTrack = useCallback(
    (trackId: string) => dispatch({ type: 'select-track', trackId }),
    [],
  )
  const renameTrack = useCallback(
    (trackId: string, name: string) => dispatch({ type: 'rename-track', trackId, name }),
    [],
  )
  const setInstrument = useCallback(
    (trackId: string, instrumentId: InstrumentId) =>
      dispatch({ type: 'set-track-instrument', trackId, instrumentId }),
    [],
  )
  const toggleMute = useCallback(
    (trackId: string) => dispatch({ type: 'toggle-track-muted', trackId }),
    [],
  )

  const setProjectName = useCallback(
    (name: string) => dispatch({ type: 'set-project-name', name }),
    [],
  )
  const newProject = useCallback(() => {
    dispatch({ type: 'load-project', project: createEmptyProject(newId('project')) })
    setStatus('New project')
  }, [])
  const loadDemo = useCallback(() => {
    dispatch({ type: 'load-project', project: createDemoProject(newId('project')) })
    setStatus('Loaded demo')
  }, [])
  const loadProjectSnapshot = useCallback((incoming: Project) => {
    // Stamp a fresh id so autosave stores the template as a NEW document instead
    // of clobbering whatever was last saved under the template's own id.
    const project = { ...incoming, id: newId('project') }
    dispatch({ type: 'load-project', project })
    // `load-project` selects the first track; reveal ITS notes so the roll scrolls
    // the freshly loaded arrangement into view (reuses the #101 reveal machinery).
    const revealNotes = project.tracks[0]?.notes ?? []
    if (revealNotes.length > 0) {
      setRevealRequest((prev) => ({
        noteIds: revealNotes.map((note) => note.id),
        token: prev.token + 1,
      }))
    }
    setStatus(`Loaded “${project.name}”`)
  }, [])
  const applyRemoteProject = useCallback((project: Project) => {
    dispatch({ type: 'sync-remote', project })
  }, [])
  const saveProject = useCallback(async () => {
    await persist(projectRef.current)
    setStatus('Saved')
  }, [persist])
  const loadProject = useCallback(
    async (id: string) => {
      const project = await store.load(id)
      if (project) {
        dispatch({ type: 'load-project', project })
        setStatus(`Opened “${project.name}”`)
      } else {
        setStatus('Could not open project')
      }
    },
    [store],
  )
  const importMidi = useCallback((bytes: ArrayBuffer, name?: string) => {
    try {
      const project = midiBytesToProject(bytes, { id: newId('project'), name })
      dispatch({ type: 'load-project', project })
      setStatus('Imported MIDI')
    } catch {
      setStatus("Couldn't import that file — is it a valid MIDI file?")
    }
  }, [])
  const exportMidi = useCallback(() => {
    setStatus('Exported MIDI')
    return projectToMidiBytes(projectRef.current)
  }, [])
  const exportMusicXml = useCallback(() => {
    setStatus('Exported MusicXML')
    return projectToMusicXml(projectRef.current)
  }, [])
  const importMusicXml = useCallback((xml: string, name?: string) => {
    try {
      const project = musicXmlToProject(xml, { id: newId('project'), name })
      dispatch({ type: 'load-project', project })
      setStatus('Imported MusicXML')
    } catch {
      setStatus("Couldn't import that file — is it valid MusicXML?")
    }
  }, [])
  const exportProjectFile = useCallback(() => {
    setStatus('Exported project file')
    return projectToFile(projectRef.current)
  }, [])
  const importProjectFile = useCallback((text: string, name?: string) => {
    try {
      const project = fileToProject(text, { id: newId('project'), name })
      dispatch({ type: 'load-project', project })
      setStatus('Opened project file')
    } catch {
      setStatus("Couldn't open that file — is it a Cadence project?")
    }
  }, [])
  const exportWav = useCallback(async (): Promise<Uint8Array | null> => {
    setStatus('Rendering audio…')
    try {
      const { bytes } = await renderProjectToWav(projectRef.current, {
        renderOffline: options.audioRenderer,
        watermark: options.watermarkExports ?? true,
      })
      setStatus('Exported WAV')
      return bytes
    } catch {
      setStatus("Couldn't render audio in this environment")
      return null
    }
  }, [options.audioRenderer, options.watermarkExports])
  const shareSnapshot = useCallback((): ShareSnapshot => {
    const snapshot = createShareSnapshot(projectRef.current)
    setStatus(
      snapshot.kind === 'url'
        ? 'Copied a shareable link'
        : 'Project too large for a link — share the file',
    )
    return snapshot
  }, [])

  // Generic export/import through the plugin host, keyed by format id. These let
  // the toolbar drive plugin-contributed formats with no per-format code.
  const exportFormat = useCallback(
    (id: string): string | Uint8Array | null => {
      const format = defaultPluginHost.formats().find((f) => f.id === id)
      if (!format?.export) return null
      setStatus(`Exported ${format.name}`)
      return format.export(projectRef.current)
    },
    [],
  )
  const importFormat = useCallback((id: string, data: string, name?: string) => {
    const format = defaultPluginHost.formats().find((f) => f.id === id)
    if (!format?.import) return
    try {
      const imported = format.import(data, { id: newId('project'), name })
      // Plugin importers are untrusted: route the result through the same
      // migrateProject sanitize seam as projectFile/MusicXML/share imports so a
      // malicious or buggy importer can't inject out-of-range pitches, NaN/negative
      // durations, or unbounded loop/tempo/ppq values into live state.
      const project = migrateProject(imported)
      dispatch({ type: 'load-project', project })
      setStatus(`Imported ${format.name}`)
    } catch {
      setStatus(`Couldn't import that ${format.name} file`)
    }
  }, [])

  return {
    state,
    project: state.project,
    selectedTrackId: state.selectedTrackId,
    transportState,
    positionBeats,
    snap,
    setSnap,
    savedProjects,
    status,
    audioReady,
    notify,
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
