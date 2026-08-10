import { StrictMode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposer } from './useComposer'
import { type AudioEngine, type TransportState } from '../audio/engine'
import { createMixerController, type MixerController } from '../audio/mixerController'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, type Project } from '../model/project'
import { projectToMidiBytes } from '../midi/midi'
import { defaultPluginHost } from '../plugins/defaultHost'

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

  it('imports a portable project file and round-trips through MusicXML', () => {
    const { hook } = setup()
    const trackId = hook.result.current.selectedTrackId
    act(() => hook.result.current.addNoteAt(trackId, 64, 1, 1))

    const file = hook.result.current.exportProjectFile()
    const xml = hook.result.current.exportMusicXml()

    act(() => hook.result.current.importProjectFile(file, 'From File'))
    expect(hook.result.current.project.name).toBe('From File')
    expect(hook.result.current.status).toBe('Opened project file')

    act(() => hook.result.current.importMusicXml(xml, 'From XML'))
    expect(hook.result.current.project.name).toBe('From XML')
    expect(hook.result.current.status).toBe('Imported MusicXML')
    expect(hook.result.current.project.tracks[0].notes[0].pitch).toBe(64)
  })

  it('surfaces friendly statuses for malformed imports', () => {
    const { hook } = setup()
    act(() => hook.result.current.importProjectFile('{ not json'))
    expect(hook.result.current.status).toBe(
      "Couldn't open that file — is it a Cadence project?",
    )
    act(() => hook.result.current.importMusicXml('not xml <<'))
    expect(hook.result.current.status).toBe(
      "Couldn't import that file — is it valid MusicXML?",
    )
  })

  it('routes a plugin importer through the sanitize seam (clamps hostile data)', () => {
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
      act(() => hook.result.current.importFormat('hostile', 'ignored', 'Hostile Import'))

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
    window.location.hash = `#${encodeProjectToFragment(seed)}`

    const hook = renderHook(() =>
      useComposer({
        createEngine: () => new FakeEngine(),
        store: new LocalStorageProjectStore(new MemoryStorage()),
        autosaveDelay: 0,
      }),
    )

    await waitFor(() =>
      expect(hook.result.current.project.name).toBe('Shared On Load'),
    )
    expect(hook.result.current.status).toBe('Opened shared project')
    expect(hook.result.current.project.tracks[0].notes[0].pitch).toBe(72)
  })
})
