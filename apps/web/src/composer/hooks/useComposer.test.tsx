import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposer } from './useComposer'
import { type AudioEngine, type TransportState } from '../audio/engine'
import { createMixerController, type MixerController } from '../audio/mixerController'
import {
  LocalStorageProjectStore,
  MemoryStorage,
  type ProjectStore,
  type StoredProjectMeta,
} from '../model/storage'
import { createEmptyProject, type Project } from '../model/project'
import { projectToMidiBytes } from '../midi/midi'
import { defaultPluginHost } from '../plugins/defaultHost'
import {
  newRecoveryLineageId,
  readProjectRecovery,
  writeProjectRecovery,
} from '../model/recovery'

class FakeEngine implements AudioEngine {
  state: TransportState = 'stopped'
  calls: string[] = []
  disposed = false
  readonly mixer: MixerController = createMixerController()
  private listeners = new Set<(s: TransportState) => void>()
  private setState(s: TransportState) {
    this.state = s
    for (const l of this.listeners) l(s)
  }
  async play() {
    this.calls.push('play')
    this.setState('playing')
  }
  pause() {
    this.calls.push('pause')
    this.setState('paused')
  }
  stop() {
    this.calls.push('stop')
    this.setState('stopped')
  }
  setTempo() {
    this.calls.push('setTempo')
  }
  setLoop() {
    this.calls.push('setLoop')
  }
  setProject() {
    this.calls.push('setProject')
  }
  positionBeats() {
    return 1.5
  }
  previewNote() {
    this.calls.push('previewNote')
  }
  onStateChange(listener: (s: TransportState) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  ensureAlive() {
    this.calls.push('ensureAlive')
    this.disposed = false
  }
  dispose() {
    this.calls.push('dispose')
    this.disposed = true
  }
}

function setup() {
  const engine = new FakeEngine()
  const store = new LocalStorageProjectStore(new MemoryStorage())
  const initialProject = createEmptyProject('project_test')
  const hook = renderHook(() =>
    useComposer({
      createEngine: () => engine,
      store,
      initialProject,
      autosaveDelay: 0,
    }),
  )
  return { engine, store, hook }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('useComposer', () => {
  it('starts from the injected project and reports audio readiness', () => {
    const { hook } = setup()
    expect(hook.result.current.project.id).toBe('project_test')
    expect(hook.result.current.audioReady).toBe(true)
  })

  it('adds a note to the selected track', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    const track = hook.result.current.project.tracks.find((t) => t.id === trackId)
    expect(track?.notes).toHaveLength(1)
    expect(track?.notes[0].pitch).toBe(60)
  })

  it('drives transport state through the engine', async () => {
    const { engine, hook } = setup()
    await act(async () => hook.result.current.play())
    expect(hook.result.current.transportState).toBe('playing')
    act(() => hook.result.current.togglePlay())
    expect(hook.result.current.transportState).toBe('paused')
    act(() => hook.result.current.togglePlay())
    expect(hook.result.current.transportState).toBe('playing')
    act(() => hook.result.current.stop())
    expect(hook.result.current.transportState).toBe('stopped')
    expect(engine.calls).toContain('play')
    expect(engine.calls).toContain('stop')
  })

  it('edits tempo, loop, and snap', () => {
    const { hook } = setup()
    act(() => hook.result.current.setTempo(90))
    expect(hook.result.current.project.tempo).toBe(90)
    const loopBefore = hook.result.current.project.loop.enabled
    act(() => hook.result.current.toggleLoop())
    expect(hook.result.current.project.loop.enabled).toBe(!loopBefore)
    act(() => hook.result.current.setSnap(0.5))
    expect(hook.result.current.snap).toBe(0.5)
  })

  it('manages tracks: add, rename, instrument, mute, select, remove', () => {
    const { hook } = setup()
    act(() => hook.result.current.addTrack())
    expect(hook.result.current.project.tracks).toHaveLength(2)
    const second = hook.result.current.project.tracks[1].id
    act(() => hook.result.current.renameTrack(second, 'Bass'))
    act(() => hook.result.current.setInstrument(second, 'fm-synth'))
    act(() => hook.result.current.toggleMute(second))
    const t = hook.result.current.project.tracks[1]
    expect(t.name).toBe('Bass')
    expect(t.instrumentId).toBe('fm-synth')
    expect(t.muted).toBe(true)
    act(() => hook.result.current.selectTrack(second))
    expect(hook.result.current.selectedTrackId).toBe(second)
    act(() => hook.result.current.removeTrack(second))
    expect(hook.result.current.project.tracks).toHaveLength(1)
  })

  it('writes, removes, and clears automation points on the project', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() =>
      hook.result.current.writeAutomationPoint('trackGain', trackId, { beat: 0, value: -6 }),
    )
    act(() =>
      hook.result.current.writeAutomationPoint('trackGain', trackId, { beat: 4, value: 0 }),
    )
    expect(hook.result.current.project.automation).toEqual([
      { target: 'trackGain', trackId, points: [{ beat: 0, value: -6 }, { beat: 4, value: 0 }] },
    ])

    act(() => hook.result.current.removeAutomationPoint('trackGain', trackId, 0))
    expect(hook.result.current.project.automation?.[0].points).toEqual([{ beat: 4, value: 0 }])

    act(() => hook.result.current.clearAutomationLane('trackGain', trackId))
    expect(hook.result.current.project.automation).toEqual([])
  })

  it('updates, selects, and removes notes and previews pitches', () => {
    const { engine, hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 62, 1, 1))
    const noteId = hook.result.current.project.tracks[0].notes[0].id
    act(() => hook.result.current.updateNote(trackId, noteId, { velocity: 0.5 }))
    expect(hook.result.current.project.tracks[0].notes[0].velocity).toBe(0.5)
    act(() => hook.result.current.selectNote(noteId))
    expect(hook.result.current.state.selectedNoteIds).toEqual([noteId])
    act(() => hook.result.current.selectNote(null))
    expect(hook.result.current.state.selectedNoteIds).toEqual([])
    act(() => hook.result.current.previewNote(64))
    expect(engine.calls).toContain('previewNote')
    act(() => hook.result.current.removeNote(trackId, noteId))
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(0)
  })

  it('inserts a batch, selects every note, and bumps the reveal token', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    const tokenBefore = hook.result.current.revealRequest.token
    act(() =>
      hook.result.current.insertNotes(trackId, [
        { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
        { pitch: 64, start: 1, duration: 1, velocity: 0.8 },
        { pitch: 67, start: 2, duration: 1, velocity: 0.8 },
      ]),
    )
    const track = hook.result.current.project.tracks.find((t) => t.id === trackId)
    expect(track?.notes).toHaveLength(3)
    // Every inserted note is selected (not just the last), and the reveal token
    // advanced so the piano roll scrolls the region into view.
    const insertedIds = track!.notes.map((n) => n.id)
    expect(hook.result.current.state.selectedNoteIds).toEqual(insertedIds)
    expect(hook.result.current.revealRequest.noteIds).toEqual(insertedIds)
    expect(hook.result.current.revealRequest.token).toBe(tokenBefore + 1)
  })

  it('ignores an empty insert batch without bumping the reveal token', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    const tokenBefore = hook.result.current.revealRequest.token
    act(() => hook.result.current.insertNotes(trackId, []))
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(0)
    expect(hook.result.current.revealRequest.token).toBe(tokenBefore)
  })

  it('creates new projects, loads the demo, and renames', async () => {
    const { hook } = setup()
    act(() => hook.result.current.setProjectName('My Song'))
    expect(hook.result.current.project.name).toBe('My Song')
    await act(() => hook.result.current.replaceWithDemo())
    expect(hook.result.current.project.tracks.length).toBeGreaterThan(1)
    await act(() => hook.result.current.replaceWithBlank())
    expect(hook.result.current.project.name).toBe('Untitled')
  })

  it('loads an in-memory project snapshot (quick-start template) via the reveal path', async () => {
    const { hook } = setup()
    const tokenBefore = hook.result.current.revealRequest.token
    const snapshot: Project = {
      ...createEmptyProject('template_src'),
      name: 'Midnight Tape',
      tracks: [
        {
          id: 'tpl_track',
          name: 'Rhodes',
          instrumentId: 'rhodes',
          muted: false,
          color: '#abc',
          notes: [
            { id: 'tpl_n1', pitch: 60, start: 0, duration: 1, velocity: 0.8 },
            { id: 'tpl_n2', pitch: 64, start: 1, duration: 1, velocity: 0.8 },
          ],
        },
      ],
    }
    act(() => hook.result.current.loadProjectSnapshot(snapshot))
    await waitFor(() => expect(hook.result.current.project.name).toBe('Midnight Tape'))
    // Loaded as a NEW document (fresh id, not the template's own id).
    expect(hook.result.current.project.id).not.toBe('template_src')
    expect(hook.result.current.project.name).toBe('Midnight Tape')
    expect(hook.result.current.project.tracks).toHaveLength(1)
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(2)
    // The first track's notes are revealed so the roll scrolls them into view.
    expect(hook.result.current.revealRequest.noteIds).toEqual(['tpl_n1', 'tpl_n2'])
    expect(hook.result.current.revealRequest.token).toBe(tokenBefore + 1)
    expect(hook.result.current.status).toContain('Midnight Tape')
  })

  it('autosaves changes and can reload them', async () => {
    const { store, hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    await waitFor(async () => {
      const list = await store.list()
      expect(list).toHaveLength(1)
    })
    await waitFor(() => expect(hook.result.current.savedProjects).toHaveLength(1))
    const savedId = hook.result.current.project.id
    await act(() => hook.result.current.replaceWithBlank())
    await act(async () => {
      await hook.result.current.loadProject(savedId)
    })
    expect(hook.result.current.project.id).toBe(savedId)
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(1)
  })

  it('reports a friendly status when opening a missing project', async () => {
    const { hook } = setup()
    await act(async () => {
      await hook.result.current.loadProject('nope')
    })
    expect(hook.result.current.status).toBe('Could not open project')
  })

  it('imports MIDI bytes and exports the project to MIDI', async () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 67, 0, 1))
    let bytes: Uint8Array = new Uint8Array()
    act(() => {
      bytes = hook.result.current.exportMidi()
    })
    expect(bytes.byteLength).toBeGreaterThan(0)

    const source = projectToMidiBytes(hook.result.current.project)
    await act(() =>
      hook.result.current.replaceWithMidi(source.buffer as ArrayBuffer, 'Imported'),
    )
    expect(hook.result.current.project.name).toBe('Imported')
    expect(hook.result.current.status).toBe('Imported MIDI')
  })

  it('surfaces a friendly status when importing a non-MIDI file', () => {
    const { hook } = setup()
    const before = hook.result.current.project.id
    const garbage = new Uint8Array([9, 9, 9, 9]).buffer as ArrayBuffer
    // Must not throw / reject; instead it sets a visible status and keeps state.
    act(() => hook.result.current.importMidi(garbage, 'bogus'))
    expect(hook.result.current.status).toBe(
      "Couldn't import that file - is it a valid MIDI file?",
    )
    expect(hook.result.current.project.id).toBe(before)
  })

  it('saves explicitly on demand', async () => {
    const { store, hook } = setup()
    await act(async () => {
      await hook.result.current.saveProject()
    })
    const list = await store.list()
    expect(list.length).toBeGreaterThan(0)
    expect(hook.result.current.status).toBe('Saved')
  })

  it('polls the audio clock for the playhead while playing', async () => {
    // Drive a single rAF frame synchronously so the playhead reads the engine.
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const { hook } = setup()
    await act(async () => hook.result.current.play())
    act(() => {
      frames.shift()?.(0)
    })
    expect(hook.result.current.positionBeats).toBe(1.5)
  })
})

describe('useComposer — single-user undo/redo history (#156)', () => {
  it('starts with no undo/redo history available', () => {
    const { hook } = setup()
    expect(hook.result.current.canUndo).toBe(false)
    expect(hook.result.current.canRedo).toBe(false)
  })

  it('undoes and redoes a document mutation', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(1)
    expect(hook.result.current.canUndo).toBe(true)
    expect(hook.result.current.canRedo).toBe(false)

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(0)
    expect(hook.result.current.canUndo).toBe(false)
    expect(hook.result.current.canRedo).toBe(true)

    act(() => hook.result.current.redo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(1)
    expect(hook.result.current.canUndo).toBe(true)
    expect(hook.result.current.canRedo).toBe(false)
  })

  it('clears the redo stack once a new edit follows an undo', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    act(() => hook.result.current.undo())
    expect(hook.result.current.canRedo).toBe(true)
    act(() => hook.result.current.addTrack())
    expect(hook.result.current.canRedo).toBe(false)
  })

  it('coalesces rapid pointer-drag note updates into a single undo step', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    const noteId = hook.result.current.project.tracks[0].notes[0].id

    // Each call commits separately (mirroring a pointer-move handler firing on
    // every mousemove), well within the coalescing window.
    act(() => hook.result.current.updateNote(trackId, noteId, { start: 0.1 }))
    act(() => hook.result.current.updateNote(trackId, noteId, { start: 0.2 }))
    act(() => hook.result.current.updateNote(trackId, noteId, { start: 0.3 }))
    expect(hook.result.current.project.tracks[0].notes[0].start).toBe(0.3)

    // ONE undo reverts straight past the whole drag, not one step per update.
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes[0].start).toBe(0)

    // The drag was its own entry, distinct from the `add-note` that preceded it.
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(0)
  })

  it('coalesces continuous mixer sliders without merging discrete toggles', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId

    act(() => hook.result.current.setTrackMix(trackId, { gainDb: -1 }))
    act(() => hook.result.current.setTrackMix(trackId, { gainDb: -2 }))
    act(() => hook.result.current.setTrackMix(trackId, { gainDb: -3 }))
    expect(hook.result.current.project.mix?.tracks[trackId].gainDb).toBe(-3)

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.mix?.tracks[trackId].gainDb).toBe(0)

    act(() => hook.result.current.setMasterMix({ limiterThresholdDb: -2 }))
    act(() => hook.result.current.setMasterMix({ limiterThresholdDb: -3 }))
    act(() => hook.result.current.setMasterMix({ limiterThresholdDb: -4 }))
    expect(hook.result.current.project.mix?.master.limiterThresholdDb).toBe(-4)

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.mix?.master.limiterThresholdDb).toBe(-1)

    act(() => hook.result.current.setTrackMix(trackId, { solo: true }))
    act(() => hook.result.current.setTrackMix(trackId, { solo: false }))
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.mix?.tracks[trackId].solo).toBe(true)
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.mix?.tracks[trackId].solo).toBe(false)
  })

  it('does not coalesce discrete one-shot commands even when they land back-to-back', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    act(() => hook.result.current.addNoteAt(trackId, 64, 1, 1))
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(2)

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(1)
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(0)
  })

  it('keeps rapid loop toggles as discrete undo and redo items', () => {
    const { hook } = setup()

    act(() => {
      hook.result.current.toggleLoop()
      hook.result.current.toggleLoop()
    })
    expect(hook.result.current.project.loop.enabled).toBe(false)

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.loop.enabled).toBe(true)
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.loop.enabled).toBe(false)

    act(() => hook.result.current.redo())
    expect(hook.result.current.project.loop.enabled).toBe(true)
    act(() => hook.result.current.redo())
    expect(hook.result.current.project.loop.enabled).toBe(false)
  })

  it('keeps two discrete commands separate when React batches them in one event', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId

    act(() => {
      hook.result.current.addNoteAt(trackId, 60, 0, 1)
      hook.result.current.addNoteAt(trackId, 64, 1, 1)
    })
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(2)

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(1)
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes).toHaveLength(0)
  })

  it('coalesces continuous project and track name typing into one field edit', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    const originalProjectName = hook.result.current.project.name
    const originalTrackName = hook.result.current.project.tracks[0].name

    act(() => hook.result.current.setProjectName('L'))
    act(() => hook.result.current.setProjectName('Le'))
    act(() => hook.result.current.setProjectName('Lead'))
    act(() => hook.result.current.stopHistoryCapture())
    act(() => hook.result.current.renameTrack(trackId, 'B'))
    act(() => hook.result.current.renameTrack(trackId, 'Ba'))
    act(() => hook.result.current.renameTrack(trackId, 'Bass'))
    act(() => hook.result.current.stopHistoryCapture())

    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].name).toBe(originalTrackName)
    expect(hook.result.current.project.name).toBe('Lead')
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.name).toBe(originalProjectName)
  })

  it('preserves the current selection across undo/redo (document mutations only)', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    const noteId = hook.result.current.project.tracks[0].notes[0].id
    act(() => hook.result.current.selectNote(noteId))
    act(() => hook.result.current.updateNote(trackId, noteId, { velocity: 0.9 }))
    expect(hook.result.current.state.selectedNoteIds).toEqual([noteId])

    act(() => hook.result.current.undo())
    // The document mutation (velocity) is undone...
    expect(hook.result.current.project.tracks[0].notes[0].velocity).not.toBe(0.9)
    // ...but selection is a view concern untouched by undo/redo.
    expect(hook.result.current.state.selectedNoteIds).toEqual([noteId])
  })

  it('resets history on any load-project action (new project, demo, snapshot load)', async () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId

    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    expect(hook.result.current.canUndo).toBe(true)
    act(() => hook.result.current.newProject())
    await waitFor(() => expect(hook.result.current.canUndo).toBe(false))
    expect(hook.result.current.canRedo).toBe(false)

    act(() => hook.result.current.addTrack())
    expect(hook.result.current.canUndo).toBe(true)
    act(() => hook.result.current.loadDemo())
    await waitFor(() => expect(hook.result.current.canUndo).toBe(false))

    act(() => hook.result.current.setTempo(77))
    expect(hook.result.current.canUndo).toBe(true)
    act(() =>
      hook.result.current.loadProjectSnapshot({
        ...createEmptyProject('template_x'),
        name: 'Snapshot',
      }),
    )
    await waitFor(() => expect(hook.result.current.canUndo).toBe(false))
  })

  it('resets history when a remote sync replaces the document', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    expect(hook.result.current.canUndo).toBe(true)

    act(() =>
      hook.result.current.applyRemoteProject({
        ...hook.result.current.project,
        name: 'From peer',
      }),
    )
    expect(hook.result.current.canUndo).toBe(false)
    expect(hook.result.current.canRedo).toBe(false)
    expect(hook.result.current.project.name).toBe('From peer')
  })

  it('setHistoryEnabled(false) suppresses capture and clears history; re-enabling clears again', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))
    expect(hook.result.current.canUndo).toBe(true)

    act(() => hook.result.current.setHistoryEnabled(false))
    expect(hook.result.current.canUndo).toBe(false)

    const noteId = hook.result.current.project.tracks[0].notes[0].id
    act(() => hook.result.current.updateNote(trackId, noteId, { velocity: 0.2 }))
    // Capture is suppressed while disabled — the edit above never pushed.
    expect(hook.result.current.canUndo).toBe(false)

    act(() => hook.result.current.setHistoryEnabled(true))
    // Re-enabling also clears — the disabled-period edit isn't retroactively
    // undoable, since single-user history and a collaboration session's own
    // `Y.UndoManager` must never both claim the same edit.
    expect(hook.result.current.canUndo).toBe(false)
    act(() => hook.result.current.undo())
    expect(hook.result.current.project.tracks[0].notes[0].velocity).toBe(0.2)
  })
})

describe('useComposer — StrictMode lifecycle (regression #97)', () => {
  it('revives the engine after a StrictMode remount so playback never drives a disposed graph', () => {
    const engine = new FakeEngine()
    renderHook(
      () =>
        useComposer({
          createEngine: () => engine,
          store: new LocalStorageProjectStore(new MemoryStorage()),
          initialProject: createEmptyProject('strict_mode'),
          autosaveDelay: 0,
        }),
      { wrapper: StrictMode },
    )

    // StrictMode (dev) runs setup → cleanup(dispose) → setup, so the remount path
    // that silenced audio in #97 actually executed here — guard against a change
    // that stops exercising it (which would make this test vacuously pass).
    expect(engine.calls).toContain('dispose')
    // After the remount the engine must be left alive: ensureAlive() ran after the
    // last dispose so voices/preview connect to a live graph, not dead nodes.
    expect(engine.disposed).toBe(false)
    expect(engine.calls.lastIndexOf('ensureAlive')).toBeGreaterThan(
      engine.calls.lastIndexOf('dispose'),
    )
  })

  describe('useComposer — revision-aware autosave', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise<T>((accept, decline) => {
        resolve = accept
        reject = decline
      })
      return { promise, resolve, reject }
    }

    function fakeStore(save: ProjectStore['save']): ProjectStore {
      return {
        save,
        load: vi.fn(async () => null),
        list: vi.fn(async () => []),
        remove: vi.fn(async () => undefined),
        loadLast: vi.fn(async () => null),
        setLast: vi.fn(async () => undefined),
      }
    }

    it('flushes the latest revision before the debounce expires', async () => {
      const save = vi.fn(async (project: Project): Promise<StoredProjectMeta> => ({
        id: project.id,
        name: project.name,
        updatedAt: 1,
      }))
      const hook = renderHook(() =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store: fakeStore(save),
          initialProject: createEmptyProject('flush'),
          autosaveDelay: 60_000,
        }),
      )
      act(() => hook.result.current.setProjectName('Latest edit'))
      await waitFor(() => expect(hook.result.current.project.name).toBe('Latest edit'))

      await act(() => hook.result.current.flushAutosave())

      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0][0].name).toBe('Latest edit')
      expect(hook.result.current.isDirty).toBe(false)
    })

    it('continues flushing when a newer revision arrives during a slow save', async () => {
      const first = deferred<StoredProjectMeta>()
      const save = vi
        .fn<ProjectStore['save']>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementation(async (project) => ({
          id: project.id,
          name: project.name,
          updatedAt: 2,
        }))
      const hook = renderHook(() =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store: fakeStore(save),
          initialProject: createEmptyProject('slow'),
          autosaveDelay: 60_000,
        }),
      )

      act(() => hook.result.current.setProjectName('First revision'))
      await waitFor(() => expect(hook.result.current.project.name).toBe('First revision'))
      const flushing = hook.result.current.flushAutosave()
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      act(() => hook.result.current.setProjectName('Second revision'))
      first.resolve({ id: 'slow', name: 'First revision', updatedAt: 1 })
      await act(() => flushing)

      expect(save).toHaveBeenCalledTimes(2)
      expect(save.mock.calls[1][0].name).toBe('Second revision')
      expect(hook.result.current.isDirty).toBe(false)
    })

    it('does not publish async autosave state after unmount', async () => {
      const pending = deferred<StoredProjectMeta>()
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const hook = renderHook(() =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store: fakeStore(vi.fn(() => pending.promise)),
          initialProject: createEmptyProject('unmount'),
          autosaveDelay: 60_000,
        }),
      )
      const flushing = hook.result.current.flushAutosave()
      hook.unmount()
      pending.resolve({ id: 'unmount', name: 'Untitled', updatedAt: 1 })

      await flushing
      expect(consoleError).not.toHaveBeenCalled()
    })

    it('queues a later autosave when a newer revision joins a rejected flush', async () => {
      const first = deferred<StoredProjectMeta>()
      const save = vi
        .fn<ProjectStore['save']>()
        .mockImplementationOnce(() => first.promise)
        .mockImplementation(async (project) => ({
          id: project.id,
          name: project.name,
          updatedAt: 2,
        }))
      const hook = renderHook(() =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store: fakeStore(save),
          initialProject: createEmptyProject('retry'),
          autosaveDelay: 20,
        }),
      )

      act(() => hook.result.current.setProjectName('Revision one'))
      await waitFor(() => expect(hook.result.current.project.name).toBe('Revision one'))
      const failedFlush = hook.result.current.flushAutosave()
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      act(() => hook.result.current.setProjectName('Revision two'))
      first.reject(new Error('offline'))
      await expect(failedFlush).rejects.toThrow('offline')

      await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 1_500 })
      expect(save.mock.calls[1][0].name).toBe('Revision two')
      await waitFor(() => expect(hook.result.current.isDirty).toBe(false))
    })

    it('explicit retry after failure persists the latest revision', async () => {
      const save = vi
        .fn<ProjectStore['save']>()
        .mockRejectedValueOnce(new Error('offline'))
        .mockImplementation(async (project) => ({
          id: project.id,
          name: project.name,
          updatedAt: 2,
        }))
      const hook = renderHook(() =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store: fakeStore(save),
          initialProject: createEmptyProject('explicit-retry'),
          autosaveDelay: 60_000,
        }),
      )

      act(() => hook.result.current.setProjectName('Newest revision'))
      await waitFor(() => expect(hook.result.current.project.name).toBe('Newest revision'))
      await expect(hook.result.current.flushAutosave()).rejects.toThrow('offline')
      await act(() => hook.result.current.flushAutosave())

      expect(save).toHaveBeenCalledTimes(2)
      expect(save.mock.calls[1][0].name).toBe('Newest revision')
      expect(hook.result.current.isDirty).toBe(false)
    })

    it('does not retry the same persistently failing revision in a loop', async () => {
      const save = vi.fn(async () => Promise.reject(new Error('offline')))
      const hook = renderHook(() =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store: fakeStore(save),
          initialProject: createEmptyProject('no-hot-loop'),
          autosaveDelay: 20,
        }),
      )

      act(() => hook.result.current.setProjectName('One failing revision'))
      await waitFor(() => expect(hook.result.current.project.name).toBe('One failing revision'))
      await expect(hook.result.current.flushAutosave()).rejects.toThrow('offline')
      await new Promise((resolve) => setTimeout(resolve, 600))

      expect(save).toHaveBeenCalledTimes(1)
      expect(hook.result.current.isDirty).toBe(true)
    })
  })
})

describe('useComposer — format interop', () => {
  it('exports MusicXML and the portable project file', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 60, 0, 1))

    let xml = ''
    act(() => {
      xml = hook.result.current.exportMusicXml()
    })
    expect(xml).toContain('<score-partwise')
    expect(hook.result.current.status).toBe('Exported MusicXML')

    let file = ''
    act(() => {
      file = hook.result.current.exportProjectFile()
    })
    expect(JSON.parse(file).format).toBe('cadence-project')
    expect(hook.result.current.status).toBe('Exported project file')
  })

  it('imports a portable project file and round-trips through MusicXML', async () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 64, 1, 1))

    const file = hook.result.current.exportProjectFile()
    const xml = hook.result.current.exportMusicXml()

    await act(() => hook.result.current.replaceWithProjectFile(file, 'From File'))
    expect(hook.result.current.project.name).toBe('From File')
    expect(hook.result.current.status).toBe('Opened project file')

    await act(() => hook.result.current.replaceWithMusicXml(xml, 'From XML'))
    expect(hook.result.current.project.name).toBe('From XML')
    expect(hook.result.current.status).toBe('Imported MusicXML')
    expect(hook.result.current.project.tracks[0].notes[0].pitch).toBe(64)
  })

  it('surfaces friendly statuses for malformed imports', async () => {
    const { hook } = setup()
    await act(() => hook.result.current.replaceWithProjectFile('{ not json'))
    expect(hook.result.current.status).toBe(
      "Couldn't open that file - is it a Cadence project?",
    )
    await act(() => hook.result.current.replaceWithMusicXml('not xml <<'))
    expect(hook.result.current.status).toBe(
      "Couldn't import that file - is it valid MusicXML?",
    )
  })

  it('routes a plugin importer through the sanitize seam (clamps hostile data)', async () => {
    const { hook } = setup()
    // A malicious/buggy plugin importer that injects out-of-range and non-finite
    // values. These must never reach live state unsanitized (mirrors the
    // MusicXML/projectFile migrateProject clamp).
    const hostile = {
      schemaVersion: 999,
      id: 'p_hostile',
      name: 'Hostile',
      tempo: 100000,
      ppq: 0,
      lengthBeats: 4,
      loop: { enabled: false, start: -5, end: -1 },
      tracks: [
        {
          id: 't_hostile',
          name: 'T',
          instrumentId: 'poly-synth',
          muted: false,
          color: '#ffffff',
          notes: [
            { id: 'n1', pitch: 999, start: -3, duration: Number.NaN, velocity: 5 },
            { id: 'n2', pitch: -10, start: 2, duration: -2, velocity: -1 },
          ],
        },
      ],
    }
    const pluginId = 'test.hostile-importer'
    defaultPluginHost.use({
      manifest: { id: pluginId, name: 'Hostile Importer', version: '1.0.0' },
      contributes: {
        formats: [
          {
            id: 'hostile',
            name: 'Hostile',
            extension: '.hostile',
            mimeType: 'text/plain',
            import: () => hostile as unknown as Project,
          },
        ],
      },
    })

    try {
      await act(() =>
        hook.result.current.replaceWithPluginFormat('hostile', 'ignored', 'Hostile Import'),
      )

      const project = hook.result.current.project
      const notes = project.tracks.flatMap((t) => t.notes)
      expect(notes.length).toBeGreaterThan(0)
      for (const note of notes) {
        expect(note.pitch).toBeGreaterThanOrEqual(0)
        expect(note.pitch).toBeLessThanOrEqual(127)
        expect(Number.isFinite(note.duration)).toBe(true)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.start).toBeGreaterThanOrEqual(0)
        expect(note.velocity).toBeGreaterThanOrEqual(0)
        expect(note.velocity).toBeLessThanOrEqual(1)
      }
      expect(project.tempo).toBeGreaterThanOrEqual(20)
      expect(project.tempo).toBeLessThanOrEqual(300)
      expect(project.ppq).toBeGreaterThan(0)
      expect(project.loop.start).toBeGreaterThanOrEqual(0)
      expect(project.loop.end).toBeGreaterThanOrEqual(project.loop.start)
      expect(hook.result.current.status).toBe('Imported Hostile')
    } finally {
      defaultPluginHost.unregister(pluginId)
    }
  })

  it('renders WAV bytes via an injected offline renderer', async () => {
    const engine = new FakeEngine()
    const audioRenderer = vi.fn(async (_p, durationSeconds: number, rate: number) => ({
      sampleRate: rate,
      channels: [new Float32Array(Math.max(1, Math.round(durationSeconds * rate)))],
    }))
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => engine,
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: createEmptyProject('wav'),
        autosaveDelay: 0,
        audioRenderer,
      }),
    )
    let bytes: Uint8Array | null = null
    await act(async () => {
      bytes = await hook.result.current.exportWav()
    })
    expect(bytes).not.toBeNull()
    expect((bytes as unknown as Uint8Array).byteLength).toBeGreaterThan(44)
    expect(hook.result.current.status).toBe('Exported WAV')
  })

  it('returns null and reports a status when audio rendering fails', async () => {
    const engine = new FakeEngine()
    const audioRenderer = vi.fn(async () => {
      throw new Error('no web audio')
    })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => engine,
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: createEmptyProject('wav'),
        autosaveDelay: 0,
        audioRenderer,
      }),
    )
    let bytes: Uint8Array | null = new Uint8Array()
    await act(async () => {
      bytes = await hook.result.current.exportWav()
    })
    expect(bytes).toBeNull()
    expect(hook.result.current.status).toBe("Couldn't render audio in this environment")
  })

  it('builds a shareable URL snapshot for a small project', () => {
    const { hook } = setup()
    let url = ''
    act(() => {
      const snapshot = hook.result.current.shareSnapshot()
      if (snapshot.kind === 'url') url = snapshot.url
    })
    expect(url).toContain('#project=')
    expect(hook.result.current.status).toBe('Copied a shareable link')
  })
})

describe('useComposer — share open from URL', () => {
  const originalHash = window.location.hash

  afterEach(() => {
    window.location.hash = originalHash
  })

  it('opens a project encoded in the location fragment on mount', async () => {
    // Encode a project, then boot a hook WITHOUT an injected project so the
    // mount effect reads the fragment.
    const seed = createEmptyProject('seed')
    seed.name = 'Shared On Load'
    seed.tracks[0].notes = [{ id: 'n', pitch: 72, start: 0, duration: 1, velocity: 0.8 }]
    const { encodeProjectToFragment } = await import('../formats/share')
    const sharedProjectHash = `#${encodeProjectToFragment(seed)}`
    window.location.hash = sharedProjectHash
    const onSharedProjectConsumed = vi.fn()

    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store: new LocalStorageProjectStore(new MemoryStorage()),
        autosaveDelay: 0,
        sharedProjectHash,
        onSharedProjectConsumed,
      }),
    )

    await waitFor(() =>
      expect(hook.result.current.project.name).toBe('Shared On Load'),
    )
    expect(hook.result.current.status).toBe('Opened shared project')
    expect(hook.result.current.project.tracks[0].notes[0].pitch).toBe(72)
    expect(onSharedProjectConsumed).toHaveBeenCalledTimes(1)
  })
})

describe('useComposer — project hydration and replacement', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((accept, decline) => {
      resolve = accept
      reject = decline
    })
    return { promise, resolve, reject }
  }

  function storeWith(
    overrides: Partial<ProjectStore> = {},
  ): ProjectStore & {
    save: ReturnType<typeof vi.fn<ProjectStore['save']>>
    loadLast: ReturnType<typeof vi.fn<ProjectStore['loadLast']>>
    setLast: ReturnType<typeof vi.fn<ProjectStore['setLast']>>
    remove: ReturnType<typeof vi.fn<ProjectStore['remove']>>
  } {
    return {
      save: vi.fn(async (project) => ({
        id: project.id,
        name: project.name,
        updatedAt: Date.now(),
      })),
      load: vi.fn(async () => null),
      list: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
      loadLast: vi.fn(async () => null),
      setLast: vi.fn(async () => undefined),
      ...overrides,
    } as ProjectStore & {
      save: ReturnType<typeof vi.fn<ProjectStore['save']>>
      loadLast: ReturnType<typeof vi.fn<ProjectStore['loadLast']>>
      setLast: ReturnType<typeof vi.fn<ProjectStore['setLast']>>
      remove: ReturnType<typeof vi.fn<ProjectStore['remove']>>
    }
  }

  it('does not persist the bootstrap project while a slow restore is unresolved', async () => {
    const pending = deferred<Project | null>()
    const store = storeWith({ loadLast: vi.fn(() => pending.promise) })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        autosaveDelay: 0,
      }),
    )

    expect(hook.result.current.hydration.status).toBe('hydrating')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(store.save).not.toHaveBeenCalled()
    expect(store.setLast).not.toHaveBeenCalled()

    pending.resolve(createEmptyProject('restored'))
    await waitFor(() =>
      expect(hook.result.current.hydration).toEqual({
        status: 'ready-with-project',
        source: 'last',
      }),
    )
    expect(hook.result.current.project.id).toBe('restored')
    expect(store.save).not.toHaveBeenCalled()
  })

  it('shows Start Center state when no last project exists', async () => {
    const store = storeWith()
    const hook = renderHook(() =>
      useComposer({ createEngine: () => new FakeEngine(), store, autosaveDelay: 0 }),
    )

    await waitFor(() =>
      expect(hook.result.current.hydration.status).toBe('ready-without-project'),
    )
    expect(store.save).not.toHaveBeenCalled()
    expect(store.setLast).not.toHaveBeenCalled()
  })

  it('restores durable recovery when the active store has no last project', async () => {
    const recoveryStorage = new MemoryStorage()
    const recovered = createEmptyProject('recovered')
    recovered.name = 'Recovered edit'
    writeProjectRecovery(recoveryStorage, 'local:anonymous', recovered, 3)
    const store = storeWith()
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )

    await waitFor(() => expect(hook.result.current.project.name).toBe('Recovered edit'))
    expect(hook.result.current.hydration).toEqual({
      status: 'ready-with-project',
      source: 'recovery',
    })
    expect(store.loadLast).not.toHaveBeenCalled()
  })

  it('gives a valid shared snapshot precedence over recovery and last project', async () => {
    const { encodeProjectToFragment } = await import('../formats/share')
    const recoveryStorage = new MemoryStorage()
    writeProjectRecovery(
      recoveryStorage,
      'local:anonymous',
      createEmptyProject('recovered'),
      2,
    )
    const shared = createEmptyProject('shared-source')
    shared.name = 'Shared winner'
    const store = storeWith({
      loadLast: vi.fn(async () => createEmptyProject('last-project')),
    })
    const consumed = vi.fn()
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        sharedProjectHash: `#${encodeProjectToFragment(shared)}`,
        onSharedProjectConsumed: consumed,
        autosaveDelay: 60_000,
      }),
    )

    await waitFor(() => expect(hook.result.current.project.name).toBe('Shared winner'))
    expect(hook.result.current.project.id).not.toBe('shared-source')
    expect(hook.result.current.hydration).toEqual({
      status: 'ready-with-project',
      source: 'shared',
    })
    expect(store.loadLast).not.toHaveBeenCalled()
    expect(consumed).toHaveBeenCalledOnce()
  })

  it('lets the active remote last project outrank anonymous local recovery', async () => {
    const recoveryStorage = new MemoryStorage()
    const anonymous = createEmptyProject('anonymous-recovery')
    anonymous.name = 'Anonymous recovery'
    writeProjectRecovery(recoveryStorage, 'local:anonymous', anonymous, 8)
    const remote = createEmptyProject('remote-last')
    remote.name = 'Remote last'
    const store = storeWith({ loadLast: vi.fn(async () => remote) })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'remote:user-a',
        autosaveDelay: 60_000,
      }),
    )

    await waitFor(() => expect(hook.result.current.project.name).toBe('Remote last'))
    expect(hook.result.current.hydration).toEqual({
      status: 'ready-with-project',
      source: 'last',
    })
  })

  it('restores same-user remote recovery before that user stale remote last project', async () => {
    const recoveryStorage = new MemoryStorage()
    const recovered = createEmptyProject('remote-project')
    recovered.name = 'Latest recovered edit'
    writeProjectRecovery(recoveryStorage, 'remote:user-a', recovered, 9)
    const stale = createEmptyProject('remote-project')
    stale.name = 'Stale remote copy'
    const store = storeWith({ loadLast: vi.fn(async () => stale) })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'remote:user-a',
        autosaveDelay: 60_000,
      }),
    )

    await waitFor(() =>
      expect(hook.result.current.project.name).toBe('Latest recovered edit'),
    )
    expect(hook.result.current.hydration).toEqual({
      status: 'ready-with-project',
      source: 'recovery',
    })
    expect(store.loadLast).not.toHaveBeenCalled()
  })

  it('continues after restore error without changing stored data and retries on remount', async () => {
    const restored = createEmptyProject('still-there')
    const loadLast = vi
      .fn<ProjectStore['loadLast']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(restored)
    const store = storeWith({ loadLast })
    const first = renderHook(() =>
      useComposer({ createEngine: () => new FakeEngine(), store, autosaveDelay: 0 }),
    )

    await waitFor(() =>
      expect(first.result.current.hydration.status).toBe('restore-error'),
    )
    act(() => first.result.current.continueToStartCenter())
    expect(first.result.current.hydration.status).toBe('ready-without-project')
    expect(store.save).not.toHaveBeenCalled()
    expect(store.setLast).not.toHaveBeenCalled()
    expect(store.remove).not.toHaveBeenCalled()
    first.unmount()

    const second = renderHook(() =>
      useComposer({ createEngine: () => new FakeEngine(), store, autosaveDelay: 0 }),
    )
    await waitFor(() => expect(second.result.current.project.id).toBe('still-there'))
    expect(loadLast).toHaveBeenCalledTimes(2)
  })

  it('blocks replacement on failed flush, then supports retry, cancel, and discard', async () => {
    const save = vi
      .fn<ProjectStore['save']>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (project) => ({
        id: project.id,
        name: project.name,
        updatedAt: Date.now(),
      }))
    const store = storeWith({ save })
    const original = createEmptyProject('original')
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: original,
        autosaveDelay: 60_000,
      }),
    )
    act(() => hook.result.current.setProjectName('Unsaved'))
    await waitFor(() => expect(hook.result.current.saveState.status).toBe('dirty'))

    await expect(hook.result.current.replaceWithBlank()).resolves.toBe('blocked')
    expect(hook.result.current.project.id).toBe('original')
    await waitFor(() => expect(hook.result.current.replacement.status).toBe('blocked'))
    await waitFor(() => expect(hook.result.current.saveState.status).toBe('error'))

    await expect(hook.result.current.retryProjectReplacement()).resolves.toBe('replaced')
    await waitFor(() => expect(hook.result.current.project.id).not.toBe('original'))

    act(() => hook.result.current.setProjectName('Another unsaved edit'))
    save.mockRejectedValueOnce(new Error('offline again'))
    const beforeCancel = hook.result.current.project.id
    await expect(hook.result.current.replaceWithDemo()).resolves.toBe('blocked')
    await waitFor(() => expect(hook.result.current.replacement.status).toBe('blocked'))
    act(() => hook.result.current.cancelProjectReplacement())
    expect(hook.result.current.project.id).toBe(beforeCancel)
    expect(hook.result.current.replacement.status).toBe('idle')

    save.mockRejectedValueOnce(new Error('offline once more'))
    await expect(hook.result.current.replaceWithDemo()).resolves.toBe('blocked')
    await waitFor(() => expect(hook.result.current.replacement.status).toBe('blocked'))
    await act(() => hook.result.current.discardProjectReplacement())
    await waitFor(() => expect(hook.result.current.project.tracks.length).toBeGreaterThan(1))
  })

  it('flushes before opening the current stored id so latest edits are not replaced by stale data', async () => {
    const storage = new MemoryStorage()
    const store = new LocalStorageProjectStore(storage)
    const original = createEmptyProject('same-id')
    original.name = 'Stored old name'
    await store.save(original)
    await store.setLast(original.id)
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: original,
        autosaveDelay: 60_000,
      }),
    )
    act(() => hook.result.current.setProjectName('Latest local edit'))

    await act(() => hook.result.current.openStoredProject('same-id'))

    expect(hook.result.current.project.name).toBe('Latest local edit')
    expect((await store.load('same-id'))?.name).toBe('Latest local edit')
  })

  it('treats destination load/setLast failures as failed without offering discard', async () => {
    const current = createEmptyProject('current')
    const target = createEmptyProject('target')
    const store = storeWith({
      loadLast: vi.fn(async () => current),
      load: vi.fn(async (id) => (id === 'target' ? target : null)),
      setLast: vi.fn(async () => {
        throw new Error('last pointer failed')
      }),
    })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage: new MemoryStorage(),
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() => expect(hook.result.current.project.id).toBe('current'))

    await expect(hook.result.current.openStoredProject('target')).resolves.toBe('failed')

    expect(hook.result.current.project.id).toBe('current')
    expect(hook.result.current.replacement.status).toBe('idle')
    await waitFor(() =>
      expect(hook.result.current.actionMessage).toMatchObject({
        tone: 'error',
        text: 'Could not open project',
      }),
    )
  })

  it('catches a discarded replacement destination failure without floating rejection', async () => {
    const current = createEmptyProject('current')
    const save = vi
      .fn<ProjectStore['save']>()
      .mockRejectedValue(new Error('offline'))
    const store = storeWith({
      save,
      load: vi.fn(async () => null),
    })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: current,
        recoveryStorage: new MemoryStorage(),
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    act(() => hook.result.current.setProjectName('Dirty'))
    await expect(hook.result.current.openStoredProject('missing')).resolves.toBe('blocked')
    await waitFor(() => expect(hook.result.current.replacement.status).toBe('blocked'))

    await expect(hook.result.current.discardProjectReplacement()).resolves.toBe('failed')

    expect(hook.result.current.project.id).toBe('current')
    await waitFor(() => expect(hook.result.current.replacement.status).toBe('idle'))
    await waitFor(() =>
      expect(hook.result.current.actionMessage).toMatchObject({
        tone: 'error',
        text: 'Could not open project',
      }),
    )
  })

  it('ignores a stale automatic retry after discard installs a new project', async () => {
    const first = deferred<StoredProjectMeta>()
    const staleRetry = deferred<StoredProjectMeta>()
    const save = vi
      .fn<ProjectStore['save']>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => staleRetry.promise)
      .mockImplementation(async (project) => ({
        id: project.id,
        name: project.name,
        updatedAt: Date.now(),
      }))
    const store = storeWith({ save })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: createEmptyProject('project-a'),
        autosaveDelay: 20,
      }),
    )
    act(() => hook.result.current.setProjectName('A revision one'))
    const replacement = hook.result.current.replaceWithBlank()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    act(() => hook.result.current.setProjectName('A revision two'))
    first.reject(new Error('offline'))
    await expect(replacement).resolves.toBe('blocked')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 1_500 })

    const discard = hook.result.current.discardProjectReplacement()
    expect(hook.result.current.project.id).toBe('project-a')
    staleRetry.reject(new Error('stale retry failure'))
    await act(() => discard)
    const projectB = hook.result.current.project.id
    expect(projectB).not.toBe('project-a')
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(hook.result.current.project.id).toBe(projectB)
    expect(hook.result.current.saveState.status).not.toBe('error')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3), { timeout: 1_500 })

    act(() => hook.result.current.setProjectName('B first edit'))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(4), { timeout: 1_500 })
    expect(save.mock.calls[3][0]).toMatchObject({ id: projectB, name: 'B first edit' })
    await waitFor(() => expect(hook.result.current.isDirty).toBe(false))
  })

  it('waits for a successful active retry before discard installs and saves project B', async () => {
    const first = deferred<StoredProjectMeta>()
    const activeRetry = deferred<StoredProjectMeta>()
    const save = vi
      .fn<ProjectStore['save']>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => activeRetry.promise)
      .mockImplementation(async (project) => ({
        id: project.id,
        name: project.name,
        updatedAt: Date.now(),
      }))
    const store = storeWith({ save })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: createEmptyProject('project-a'),
        autosaveDelay: 20,
      }),
    )
    act(() => hook.result.current.setProjectName('A revision one'))
    const replacement = hook.result.current.replaceWithBlank()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    act(() => hook.result.current.setProjectName('A revision two'))
    first.reject(new Error('offline'))
    await expect(replacement).resolves.toBe('blocked')
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 1_500 })

    const discard = hook.result.current.discardProjectReplacement()
    expect(hook.result.current.project.id).toBe('project-a')
    activeRetry.resolve({ id: 'project-a', name: 'A revision two', updatedAt: 2 })
    await act(() => discard)
    const projectB = hook.result.current.project.id
    expect(projectB).not.toBe('project-a')

    await waitFor(() => expect(save).toHaveBeenCalledTimes(3), { timeout: 1_500 })
    await waitFor(() =>
      expect(store.setLast).toHaveBeenLastCalledWith(projectB),
    )
    expect(save.mock.calls[2][0].id).toBe(projectB)
    expect(hook.result.current.saveState.status).not.toBe('error')
  })

  it('blocks A autosave during async B load and resumes once when B load fails', async () => {
    const destination = deferred<Project | null>()
    const save = vi.fn<ProjectStore['save']>(async (project) => ({
      id: project.id,
      name: project.name,
      updatedAt: Date.now(),
    }))
    const load = vi.fn<ProjectStore['load']>(() => destination.promise)
    const store = storeWith({ save, load })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: createEmptyProject('project-a'),
        autosaveDelay: 20,
      }),
    )
    await waitFor(() => expect(hook.result.current.isDirty).toBe(false))
    const savesBeforeTransition = save.mock.calls.length

    const opening = hook.result.current.openStoredProject('project-b')
    await waitFor(() => expect(load).toHaveBeenCalledWith('project-b'))
    act(() => hook.result.current.setProjectName('A edit during B load'))
    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(save).toHaveBeenCalledTimes(savesBeforeTransition)

    destination.reject(new Error('B unavailable'))
    await expect(opening).resolves.toBe('failed')
    await waitFor(
      () => expect(save).toHaveBeenCalledTimes(savesBeforeTransition + 1),
      { timeout: 1_500 },
    )
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      id: 'project-a',
      name: 'A edit during B load',
    })
  })

  it('blocks A autosave throughout async B load and leaves B as final persisted project', async () => {
    const destination = deferred<Project | null>()
    const save = vi.fn<ProjectStore['save']>(async (project) => ({
      id: project.id,
      name: project.name,
      updatedAt: Date.now(),
    }))
    const load = vi.fn<ProjectStore['load']>(() => destination.promise)
    const store = storeWith({ save, load })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: createEmptyProject('project-a'),
        autosaveDelay: 20,
      }),
    )
    await waitFor(() => expect(hook.result.current.isDirty).toBe(false))
    const savesBeforeTransition = save.mock.calls.length

    const opening = hook.result.current.openStoredProject('project-b')
    await waitFor(() => expect(load).toHaveBeenCalledWith('project-b'))
    act(() => hook.result.current.setProjectName('A must not persist'))
    await new Promise((resolve) => setTimeout(resolve, 75))
    expect(save).toHaveBeenCalledTimes(savesBeforeTransition)

    const projectB = createEmptyProject('project-b')
    projectB.name = 'Project B'
    destination.resolve(projectB)
    await expect(opening).resolves.toBe('replaced')
    await waitFor(() => expect(hook.result.current.project.id).toBe('project-b'))
    expect(save).toHaveBeenCalledTimes(savesBeforeTransition)
    expect(store.setLast).toHaveBeenLastCalledWith('project-b')
  })

  it('clears discarded recovery so the abandoned edit cannot return on hydration', async () => {
    const recoveryStorage = new MemoryStorage()
    const stored = createEmptyProject('stored')
    stored.name = 'Stored version'
    const save = vi.fn<ProjectStore['save']>(async () => {
      throw new Error('offline')
    })
    const store = storeWith({
      save,
      loadLast: vi.fn(async () => stored),
    })
    const first = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() => expect(first.result.current.project.id).toBe('stored'))
    act(() => first.result.current.setProjectName('Discard me'))
    await waitFor(() =>
      expect(
        readProjectRecovery(recoveryStorage, 'local:anonymous')?.project.name,
      ).toBe('Discard me'),
    )
    await expect(first.result.current.replaceWithBlank()).resolves.toBe('blocked')
    await waitFor(() => expect(first.result.current.replacement.status).toBe('blocked'))
    await act(() => first.result.current.discardProjectReplacement())
    await waitFor(() => expect(first.result.current.project.id).not.toBe('stored'))
    expect(
      readProjectRecovery(recoveryStorage, 'local:anonymous')?.project.name,
    ).not.toBe('Discard me')
    first.unmount()

    const second = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() =>
      expect(second.result.current.project.name).not.toBe('Discard me'),
    )
  })

  it('retains ownership of an earlier token when a later stage write fails', async () => {
    const memory = new MemoryStorage()
    let failRecordWrite = false
    const recoveryStorage = {
      get length() {
        return memory.length
      },
      getItem: (key: string) => memory.getItem(key),
      key: (index: number) => memory.key(index),
      setItem: (key: string, value: string) => {
        if (failRecordWrite && !key.endsWith('.active')) {
          throw new Error('quota exceeded')
        }
        memory.setItem(key, value)
      },
      removeItem: (key: string) => memory.removeItem(key),
    }
    const stored = createEmptyProject('owned-token')
    const store = storeWith({ loadLast: vi.fn(async () => stored) })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() => expect(hook.result.current.project.id).toBe('owned-token'))
    act(() => hook.result.current.setProjectName('Token A'))
    await waitFor(() =>
      expect(
        readProjectRecovery(recoveryStorage, 'local:anonymous')?.project.name,
      ).toBe('Token A'),
    )

    failRecordWrite = true
    act(() => hook.result.current.setProjectName('Token B failed to stage'))
    await waitFor(() =>
      expect(hook.result.current.project.name).toBe('Token B failed to stage'),
    )
    failRecordWrite = false
    await act(() => hook.result.current.flushAutosave())

    expect(readProjectRecovery(recoveryStorage, 'local:anonymous')).toBeNull()
    expect(hook.result.current.saveState.status).toBe('saved')
  })

  it('adopts a recovered lineage and clears all of its crash ancestors on save', async () => {
    const primaryStorage = new MemoryStorage()
    const store = new LocalStorageProjectStore(primaryStorage)
    const authoritative = createEmptyProject('lineage-project')
    authoritative.name = 'Authoritative old'
    await store.persist(authoritative)
    const recoveryStorage = new MemoryStorage()
    const lineage = newRecoveryLineageId()
    const ancestor = writeProjectRecovery(
      recoveryStorage,
      'local:anonymous',
      { ...authoritative, name: 'Recovered A' },
      1,
      lineage,
    )!
    writeProjectRecovery(
      recoveryStorage,
      'local:anonymous',
      { ...authoritative, name: 'Recovered B' },
      2,
      lineage,
      ancestor.token,
    )
    const first = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() => expect(first.result.current.project.name).toBe('Recovered B'))
    await act(() => first.result.current.flushAutosave())
    expect(
      readProjectRecovery(recoveryStorage, 'local:anonymous', authoritative.id),
    ).toBeNull()
    first.unmount()

    const second = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() => expect(second.result.current.project.name).toBe('Recovered B'))
    expect(second.result.current.hydration).toEqual({
      status: 'ready-with-project',
      source: 'last',
    })
  })

  it('clears only the persisted recovery boundary while a newer edit is pending', async () => {
    const firstSave = deferred<StoredProjectMeta>()
    const save = vi
      .fn<ProjectStore['save']>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockRejectedValueOnce(new Error('B save failed'))
      .mockImplementation(async (project) => ({
        id: project.id,
        name: project.name,
        updatedAt: Date.now(),
      }))
    const stored = createEmptyProject('boundary-project')
    const store = storeWith({
      save,
      loadLast: vi.fn(async () => stored),
    })
    const recoveryStorage = new MemoryStorage()
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        recoveryStorage,
        recoveryScope: 'local:anonymous',
        autosaveDelay: 60_000,
      }),
    )
    await waitFor(() => expect(hook.result.current.project.id).toBe(stored.id))
    act(() => hook.result.current.setProjectName('Edit A'))
    await waitFor(() =>
      expect(
        readProjectRecovery(recoveryStorage, 'local:anonymous')?.project.name,
      ).toBe('Edit A'),
    )
    const flushing = hook.result.current.flushAutosave()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    act(() => hook.result.current.setProjectName('Edit B'))
    await waitFor(() =>
      expect(
        readProjectRecovery(recoveryStorage, 'local:anonymous')?.project.name,
      ).toBe('Edit B'),
    )

    firstSave.resolve({ id: stored.id, name: 'Edit A', updatedAt: 1 })
    await expect(flushing).rejects.toThrow('B save failed')
    expect(
      readProjectRecovery(recoveryStorage, 'local:anonymous')?.project.name,
    ).toBe('Edit B')

    await act(() => hook.result.current.retrySave())
    expect(
      readProjectRecovery(recoveryStorage, 'local:anonymous', stored.id),
    ).toBeNull()
  })

  it('keeps a durable save clean when refreshing recents fails', async () => {
    const project = createEmptyProject('saved-with-list-error')
    const store = storeWith({
      list: vi.fn(async () => {
        throw new Error('list unavailable')
      }),
    })
    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store,
        initialProject: project,
        autosaveDelay: 60_000,
      }),
    )
    act(() => hook.result.current.setProjectName('Durably saved'))

    await act(() => hook.result.current.flushAutosave())

    expect(hook.result.current.isDirty).toBe(false)
    expect(hook.result.current.saveState.status).toBe('saved')
    await waitFor(() =>
      expect(hook.result.current.recentProjectsState.status).toBe('error'),
    )
  })

  it('ignores a stale recent-project response after the store revision changes', async () => {
    const stale = deferred<StoredProjectMeta[]>()
    const list = vi
      .fn<ProjectStore['list']>()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce([{ id: 'remote', name: 'Remote', updatedAt: 2 }])
    const store = storeWith({ list })
    const hook = renderHook(
      ({ revision }: { revision: string }) =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store,
          initialProject: createEmptyProject('recents-race'),
          autosaveDelay: 60_000,
          storeRevision: revision,
        }),
      { initialProps: { revision: 'anonymous' } },
    )
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    hook.rerender({ revision: 'authenticated' })
    await waitFor(() =>
      expect(hook.result.current.savedProjects.map((project) => project.id)).toEqual([
        'remote',
      ]),
    )

    stale.resolve([{ id: 'local', name: 'Local', updatedAt: 1 }])
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(hook.result.current.savedProjects.map((project) => project.id)).toEqual([
      'remote',
    ])
  })

  it('ignores a stale remote hydration completion after switching to local identity', async () => {
    const remote = deferred<Project | null>()
    const local = createEmptyProject('local-project')
    local.name = 'Local winner'
    const loadLast = vi
      .fn<ProjectStore['loadLast']>()
      .mockImplementationOnce(() => remote.promise)
      .mockResolvedValueOnce(local)
    const store = storeWith({ loadLast })
    const hook = renderHook(
      ({ revision, scope }: { revision: string; scope: string }) =>
        useComposer({
          createEngine: () => new FakeEngine(),
          store,
          recoveryStorage: new MemoryStorage(),
          recoveryScope: scope,
          storeRevision: revision,
          autosaveDelay: 60_000,
        }),
      {
        initialProps: {
          revision: 'authenticated:user-a',
          scope: 'remote:user-a',
        },
      },
    )
    await waitFor(() => expect(loadLast).toHaveBeenCalledTimes(1))

    hook.rerender({
      revision: 'anonymous',
      scope: 'local:anonymous',
    })
    await waitFor(() => expect(hook.result.current.project.name).toBe('Local winner'))

    const staleRemote = createEmptyProject('remote-project')
    staleRemote.name = 'Stale remote'
    remote.resolve(staleRemote)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(hook.result.current.project.name).toBe('Local winner')
  })
})
