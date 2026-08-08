import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposer } from './useComposer'
import { type AudioEngine, type TransportState } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject } from '../model/project'
import { projectToMidiBytes } from '../midi/midi'

class FakeEngine implements AudioEngine {
  state: TransportState = 'stopped'
  calls: string[] = []
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
  dispose() {
    this.calls.push('dispose')
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

  it('creates new projects, loads the demo, and renames', () => {
    const { hook } = setup()
    act(() => hook.result.current.setProjectName('My Song'))
    expect(hook.result.current.project.name).toBe('My Song')
    act(() => hook.result.current.loadDemo())
    expect(hook.result.current.project.tracks.length).toBeGreaterThan(1)
    act(() => hook.result.current.newProject())
    expect(hook.result.current.project.name).toBe('Untitled')
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
    act(() => hook.result.current.newProject())
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

  it('imports MIDI bytes and exports the project to MIDI', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 67, 0, 1))
    let bytes: Uint8Array = new Uint8Array()
    act(() => {
      bytes = hook.result.current.exportMidi()
    })
    expect(bytes.byteLength).toBeGreaterThan(0)

    const source = projectToMidiBytes(hook.result.current.project)
    act(() => hook.result.current.importMidi(source.buffer as ArrayBuffer, 'Imported'))
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
      "Couldn't import that file — is it a valid MIDI file?",
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
