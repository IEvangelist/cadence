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
import { midiBytesToProject, projectToMidiBytes } from '../midi/midi'
import { type AudioEngine, type TransportState, createAudioEngine } from '../audio/engine'

export interface UseComposerOptions {
  createEngine?: () => AudioEngine
  store?: ProjectStore
  initialProject?: Project
  /** Autosave debounce in ms. 0 saves synchronously (handy for tests). */
  autosaveDelay?: number
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

  play: () => void
  pause: () => void
  stop: () => void
  togglePlay: () => void
  setTempo: (bpm: number) => void
  toggleLoop: () => void

  addNoteAt: (trackId: string, pitch: number, start: number, duration?: number) => void
  updateNote: (trackId: string, noteId: string, changes: Partial<Note>) => void
  removeNote: (trackId: string, noteId: string) => void
  selectNote: (noteId: string | null) => void
  previewNote: (pitch: number) => void

  addTrack: () => void
  removeTrack: (trackId: string) => void
  selectTrack: (trackId: string) => void
  renameTrack: (trackId: string, name: string) => void
  setInstrument: (trackId: string, instrumentId: InstrumentId) => void
  toggleMute: (trackId: string) => void

  setProjectName: (name: string) => void
  newProject: () => void
  loadDemo: () => void
  saveProject: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  importMidi: (bytes: ArrayBuffer, name?: string) => void
  exportMidi: () => Uint8Array
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

  const [engine] = useState<AudioEngine>(() => (options.createEngine ?? createAudioEngine)())
  const audioReady = useMemo(() => engine.constructor.name !== 'SilentAudioEngine', [engine])

  // Keep a ref to the latest project so event handlers read fresh data without
  // widening their dependency lists. The ref is written in an effect (not during
  // render) to satisfy the React Compiler ref rules.
  const projectRef = useRef(state.project)
  useEffect(() => {
    projectRef.current = state.project
  }, [state.project])

  // Subscribe to transport state + reschedule whenever the project changes.
  useEffect(() => {
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

  // Restore the last autosaved project on first load (unless a project was
  // explicitly injected, e.g. in tests). Keeps work across reloads/sessions.
  useEffect(() => {
    if (options.initialProject) return
    let cancelled = false
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
  const updateNote = useCallback(
    (trackId: string, noteId: string, changes: Partial<Note>) =>
      dispatch({ type: 'update-note', trackId, noteId, changes }),
    [],
  )
  const removeNote = useCallback(
    (trackId: string, noteId: string) => dispatch({ type: 'remove-note', trackId, noteId }),
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
    play,
    pause,
    stop,
    togglePlay,
    setTempo,
    toggleLoop,
    addNoteAt,
    updateNote,
    removeNote,
    selectNote,
    previewNote,
    addTrack,
    removeTrack,
    selectTrack,
    renameTrack,
    setInstrument,
    toggleMute,
    setProjectName,
    newProject,
    loadDemo,
    saveProject,
    loadProject,
    importMidi,
    exportMidi,
  }
}
