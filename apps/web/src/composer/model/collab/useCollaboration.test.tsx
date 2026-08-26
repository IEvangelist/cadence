import { useEffect } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { createEmptyProject, createNote, createTrack, type Project } from './../project'
import { SilentAudioEngine } from '../../audio/engine'
import { useComposer } from '../../hooks/useComposer'
import { LocalStorageProjectStore, MemoryStorage } from '../storage'
import { projectToFile } from '../../formats/projectFile'
import { readProject, reconcileDoc } from './crdt'
import {
  type CollabBinding,
  type CollabConfig,
  type CollabProvider,
  useCollaboration,
} from './useCollaboration'

function seedProject(): Project {
  const project = createEmptyProject('shared')
  const track = createTrack({ name: 'Synth' }, 'track_a')
  track.notes = [createNote({ pitch: 60, start: 0 }, 'n1')]
  project.tracks = [track]
  return project
}

/** A fake provider whose doc/awareness the test drives directly. */
function fakeProvider() {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const provider: CollabProvider = {
    doc,
    awareness,
    destroy: vi.fn(() => {
      awareness.destroy()
      doc.destroy()
    }),
  }
  return provider
}

/** A fake provider that exposes onSynced so the hook defers seeding. */
function fakeSyncingProvider() {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  let syncedListener: (() => void) | null = null
  const provider: CollabProvider & { fireSync: () => void } = {
    doc,
    awareness,
    destroy: vi.fn(() => {
      awareness.destroy()
      doc.destroy()
    }),
    onSynced: (listener) => {
      syncedListener = listener
      return () => {
        syncedListener = null
      }
    },
    fireSync: () => syncedListener?.(),
  }
  return provider
}

const providers: CollabProvider[] = []
function factory() {
  const p = fakeProvider()
  providers.push(p)
  return p
}

afterEach(() => {
  for (const p of providers.splice(0)) p.destroy()
  vi.restoreAllMocks()
})

function makeBinding(project: Project): CollabBinding {
  return {
    project,
    selectedTrackId: 'track_a',
    selectedNoteIds: [],
    applyRemoteProject: vi.fn(),
  }
}

const config: CollabConfig = {
  projectId: 'p1',
  role: 'editor',
  url: 'ws://test/api/collab',
  user: { id: 'u1', name: 'Ada', color: '#f0f' },
}

function useIntegratedComposerCollaboration(
  initialProject: Project,
  store: LocalStorageProjectStore,
) {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store,
    initialProject,
    autosaveDelay: 0,
  })
  const collaboration = useCollaboration(
    {
      project: controller.project,
      selectedTrackId: controller.selectedTrackId,
      selectedNoteIds: controller.state.selectedNoteIds,
      applyRemoteProject: controller.applyRemoteProject,
      historyCaptureGroup: controller.historyCaptureGroup,
      historyCaptureBoundary: controller.historyCaptureBoundary,
      subscribeProjectTransitions: controller.subscribeProjectTransitions,
    },
    config,
    factory,
  )
  const setHistoryEnabled = controller.setHistoryEnabled
  useEffect(() => {
    setHistoryEnabled(!collaboration.active)
  }, [collaboration.active, setHistoryEnabled])
  return { collaboration, controller }
}

describe('useCollaboration', () => {
  it('is inert with a null config and never builds a provider', () => {
    const spy = vi.fn(factory)
    const binding = makeBinding(seedProject())
    const { result } = renderHook(() => useCollaboration(binding, null, spy))
    expect(result.current.active).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('connects, seeds the shared doc, and reports self presence', () => {
    const binding = makeBinding(seedProject())
    const { result } = renderHook(() => useCollaboration(binding, config, factory))

    expect(result.current.active).toBe(true)
    expect(result.current.canWrite).toBe(true)
    // Seeded from the local project.
    expect(providers[0].doc.getMap('project').get('id')).toBe('shared')
    expect(result.current.presence.map((p) => p.user.name)).toContain('Ada')
  })

  it('applies converged remote edits back through the binding', () => {
    const binding = makeBinding(seedProject())
    renderHook(() => useCollaboration(binding, config, factory))

    const remote = seedProject()
    remote.tracks[0].name = 'Remote Lead'
    act(() => {
      // Simulate a peer edit arriving with a non-local origin.
      reconcileDoc(providers[0].doc, remote, 'remote-peer')
    })

    expect(binding.applyRemoteProject).toHaveBeenCalled()
    const applied = (binding.applyRemoteProject as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]
    expect(applied.tracks[0].name).toBe('Remote Lead')
  })

  it('mirrors local project edits into the shared doc', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const { rerender } = renderHook((props: CollabBinding) => useCollaboration(props, config, factory), {
      initialProps: binding,
    })

    const edited = structuredClone(project)
    edited.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'n2'))
    rerender({ ...binding, project: edited })

    const notes = providers[0].doc.getMap('project').get('tracks') as Y.Array<Y.Map<unknown>>
    const noteArray = notes.get(0).get('notes') as Y.Array<Y.Map<unknown>>
    expect(noteArray.length).toBe(2)
  })

  it('does not write to the doc as a viewer', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const viewerConfig: CollabConfig = { ...config, role: 'viewer' }
    const { result, rerender } = renderHook(
      (props: CollabBinding) => useCollaboration(props, viewerConfig, factory),
      { initialProps: binding },
    )
    expect(result.current.canWrite).toBe(false)
    // Doc was never seeded (viewer cannot write).
    expect(providers[0].doc.getMap('project').size).toBe(0)

    const edited = structuredClone(project)
    edited.tracks[0].name = 'Nope'
    rerender({ ...binding, project: edited })
    expect(providers[0].doc.getMap('project').size).toBe(0)
  })

  it('tears down the provider on unmount', () => {
    const binding = makeBinding(seedProject())
    const { unmount } = renderHook(() => useCollaboration(binding, config, factory))
    const provider = providers[0]
    unmount()
    expect(provider.destroy).toHaveBeenCalled()
  })

  it('tears down the old provider before reconnecting to changed URL params', () => {
    const binding = makeBinding(seedProject())
    const { rerender } = renderHook(
      ({ next }: { next: CollabConfig | null }) =>
        useCollaboration(binding, next, factory),
      { initialProps: { next: config as CollabConfig | null } },
    )
    const first = providers[0]

    rerender({
      next: { ...config, projectId: 'p2', token: 'next-token' },
    })

    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(providers).toHaveLength(2)
    expect(providers[1].destroy).not.toHaveBeenCalled()

    rerender({ next: null })
    expect(providers[1].destroy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['id', { id: 'u2' }],
    ['name', { name: 'Ada Updated' }],
    ['color', { color: '#0ff' }],
  ] as const)('reconnects once when collaboration user %s changes', (_field, change) => {
    const binding = makeBinding(seedProject())
    const { rerender } = renderHook(
      ({ next }: { next: CollabConfig }) => useCollaboration(binding, next, factory),
      { initialProps: { next: config } },
    )
    const first = providers[0]
    const updatedUser = { ...config.user, ...change }

    rerender({
      next: {
        ...config,
        user: updatedUser,
      },
    })

    expect(first.destroy).toHaveBeenCalledTimes(1)
    expect(providers).toHaveLength(2)
    expect(providers[1].awareness.getLocalState()?.user).toMatchObject(updatedUser)
  })

  it('does not reconnect for an equivalent collaboration identity object', () => {
    const binding = makeBinding(seedProject())
    const { rerender } = renderHook(
      ({ next }: { next: CollabConfig }) => useCollaboration(binding, next, factory),
      { initialProps: { next: config } },
    )
    const first = providers[0]

    rerender({
      next: {
        ...config,
        user: { ...config.user },
      },
    })

    expect(first.destroy).not.toHaveBeenCalled()
    expect(providers).toHaveLength(1)
  })

  it('connects with a valid empty collaboration display name', () => {
    const binding = makeBinding(seedProject())
    const emptyNameConfig: CollabConfig = {
      ...config,
      user: { ...config.user, name: '' },
    }

    const { result } = renderHook(() =>
      useCollaboration(binding, emptyNameConfig, factory),
    )

    expect(result.current.active).toBe(true)
    expect(providers).toHaveLength(1)
    expect(providers[0].awareness.getLocalState()?.user).toMatchObject({ name: '' })
  })

  it('defers seeding until the provider reports its initial sync', () => {
    const built: Array<ReturnType<typeof fakeSyncingProvider>> = []
    const syncingFactory = () => {
      const p = fakeSyncingProvider()
      built.push(p)
      return p
    }
    const binding = makeBinding(seedProject())
    renderHook(() => useCollaboration(binding, config, syncingFactory))

    // Nothing seeded yet — the provider has not synced with the relay.
    expect(built[0].doc.getMap('project').size).toBe(0)

    act(() => built[0].fireSync())

    // Now the first client seeds the shared doc from its local project.
    expect(built[0].doc.getMap('project').get('id')).toBe('shared')
    built[0].destroy()
  })
})

describe('useCollaboration — collaborative undo/redo (#156)', () => {
  it('tracks local edits for an immediate (non-deferred-seed) provider, and routes undo through applyRemoteProject', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const { result, rerender } = renderHook(
      (props: CollabBinding) => useCollaboration(props, config, factory),
      { initialProps: binding },
    )
    // The initial seed happened before undo was enabled — not undoable.
    expect(result.current.canUndo).toBe(false)

    const edited = structuredClone(project)
    edited.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'n2'))
    act(() => rerender({ ...binding, project: edited }))
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    act(() => result.current.undo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
    // The undo manager's own transaction is routed through the SAME
    // `onRemoteProject` → `applyRemoteProject` path a genuine remote peer's
    // edit takes (#156).
    expect(binding.applyRemoteProject).toHaveBeenCalled()

    act(() => result.current.redo())
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('never grants undo/redo capability to a viewer', () => {
    const binding = makeBinding(seedProject())
    const viewerConfig: CollabConfig = { ...config, role: 'viewer' }
    const { result } = renderHook(() => useCollaboration(binding, viewerConfig, factory))

    expect(result.current.canWrite).toBe(false)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    // Calling undo/redo must be harmless no-ops.
    act(() => result.current.undo())
    act(() => result.current.redo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('does not make the deferred seed/adoption itself undoable', () => {
    const built: Array<ReturnType<typeof fakeSyncingProvider>> = []
    const syncingFactory = () => {
      const p = fakeSyncingProvider()
      built.push(p)
      return p
    }
    const binding = makeBinding(seedProject())
    const { result } = renderHook(() => useCollaboration(binding, config, syncingFactory))

    expect(result.current.canUndo).toBe(false)
    act(() => built[0].fireSync())
    // The doc is now seeded, but the seed/adoption itself must not be undoable.
    expect(result.current.canUndo).toBe(false)
    built[0].destroy()
  })

  it('clears undo/redo state when the session is torn down and replaced (project switch / reconnect)', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const { result, rerender } = renderHook(
      ({ next, props }: { next: CollabConfig; props: CollabBinding }) =>
        useCollaboration(props, next, factory),
      { initialProps: { next: config, props: binding } },
    )

    const edited = structuredClone(project)
    edited.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'n2'))
    act(() => rerender({ next: config, props: { ...binding, project: edited } }))
    expect(result.current.canUndo).toBe(true)

    // A project/identity change tears down the old session and stands up a
    // brand-new one — stale undo history must not survive the switch.
    act(() =>
      rerender({
        next: { ...config, projectId: 'p2' },
        props: makeBinding(seedProject()),
      }),
    )
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('coalesces one gesture while keeping adjacent discrete commands separate', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const { result, rerender } = renderHook(
      (props: CollabBinding) => useCollaboration(props, config, factory),
      {
        initialProps: {
          ...binding,
          historyCaptureGroup: null,
          historyCaptureBoundary: 0,
        } as CollabBinding,
      },
    )

    const added = structuredClone(project)
    added.tracks[0].notes.push(createNote({ pitch: 64, start: 0 }, 'drag'))
    act(() =>
      rerender({
        ...binding,
        project: added,
        historyCaptureGroup: null,
        historyCaptureBoundary: 0,
      }),
    )

    let dragged = added
    for (const start of [0.1, 0.2, 0.3]) {
      dragged = structuredClone(dragged)
      dragged.tracks[0].notes.find((note) => note.id === 'drag')!.start = start
      act(() =>
        rerender({
          ...binding,
          project: dragged,
          historyCaptureGroup: 'update-note:track_a:drag',
          historyCaptureBoundary: 0,
        }),
      )
    }
    act(() =>
      rerender({
        ...binding,
        project: dragged,
        historyCaptureGroup: null,
        historyCaptureBoundary: 1,
      }),
    )

    const discrete = structuredClone(dragged)
    discrete.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'after'))
    act(() =>
      rerender({
        ...binding,
        project: discrete,
        historyCaptureGroup: null,
        historyCaptureBoundary: 1,
      }),
    )

    act(() => result.current.undo())
    expect(readProject(providers[0].doc).tracks[0].notes.map((note) => note.id))
      .not.toContain('after')
    act(() => result.current.undo())
    expect(
      readProject(providers[0].doc).tracks[0].notes.find((note) => note.id === 'drag')?.start,
    ).toBe(0)
    act(() => result.current.undo())
    expect(readProject(providers[0].doc).tracks[0].notes.map((note) => note.id))
      .not.toContain('drag')
  })

  it('keeps the initial velocity pointerdown and its drag updates in one undo item', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const { result, rerender } = renderHook(
      (props: CollabBinding) => useCollaboration(props, config, factory),
      {
        initialProps: {
          ...binding,
          historyCaptureGroup: null,
          historyCaptureBoundary: 0,
        } as CollabBinding,
      },
    )

    let edited = structuredClone(project)
    edited.tracks[0].notes[0].velocity = 0.6
    act(() =>
      rerender({
        ...binding,
        project: edited,
        historyCaptureGroup: 'update-note:track_a:n1',
        historyCaptureBoundary: 1,
      }),
    )
    for (const velocity of [0.4, 0.2]) {
      edited = structuredClone(edited)
      edited.tracks[0].notes[0].velocity = velocity
      act(() =>
        rerender({
          ...binding,
          project: edited,
          historyCaptureGroup: 'update-note:track_a:n1',
          historyCaptureBoundary: 1,
        }),
      )
    }
    act(() =>
      rerender({
        ...binding,
        project: edited,
        historyCaptureGroup: null,
        historyCaptureBoundary: 2,
      }),
    )

    act(() => result.current.undo())
    expect(readProject(providers[0].doc).tracks[0].notes[0].velocity).toBe(0.8)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
    act(() => result.current.redo())
    expect(readProject(providers[0].doc).tracks[0].notes[0].velocity).toBe(0.2)
  })

  it('uses a pointercancel boundary to separate two gestures on the same note', () => {
    const project = seedProject()
    const binding = makeBinding(project)
    const { result, rerender } = renderHook(
      (props: CollabBinding) => useCollaboration(props, config, factory),
      {
        initialProps: {
          ...binding,
          historyCaptureGroup: null,
          historyCaptureBoundary: 0,
        } as CollabBinding,
      },
    )

    let edited = project
    for (const start of [0.1, 0.2]) {
      edited = structuredClone(edited)
      edited.tracks[0].notes[0].start = start
      act(() =>
        rerender({
          ...binding,
          project: edited,
          historyCaptureGroup: 'update-note:track_a:n1',
          historyCaptureBoundary: 0,
        }),
      )
    }
    act(() =>
      rerender({
        ...binding,
        project: edited,
        historyCaptureGroup: null,
        historyCaptureBoundary: 1,
      }),
    )

    const secondGesture = structuredClone(edited)
    secondGesture.tracks[0].notes[0].start = 0.4
    act(() =>
      rerender({
        ...binding,
        project: secondGesture,
        historyCaptureGroup: 'update-note:track_a:n1',
        historyCaptureBoundary: 1,
      }),
    )

    act(() => result.current.undo())
    expect(readProject(providers[0].doc).tracks[0].notes[0].start).toBe(0.2)
    act(() => result.current.undo())
    expect(readProject(providers[0].doc).tracks[0].notes[0].start).toBe(0)
  })

  it('keeps two synchronously batched controller commands as separate Yjs undo items', () => {
    const initialProject = seedProject()
    const store = new LocalStorageProjectStore(new MemoryStorage())

    const { result } = renderHook(() =>
      useIntegratedComposerCollaboration(initialProject, store),
    )

    const trackId = result.current.controller.selectedTrackId
    act(() => {
      result.current.controller.addNoteAt(trackId, 64, 1)
      result.current.controller.addNoteAt(trackId, 67, 2)
    })
    expect(readProject(providers[0].doc).tracks[0].notes).toHaveLength(3)

    const remote = readProject(providers[0].doc)
    remote.tracks[0].notes.push(createNote({ pitch: 72, start: 4 }, 'remote-batch'))
    act(() => reconcileDoc(providers[0].doc, remote, 'remote-peer'))

    act(() => result.current.collaboration.undo())
    let notes = readProject(providers[0].doc).tracks[0].notes
    expect(notes).toHaveLength(3)
    expect(notes.map((note) => note.id)).toContain('remote-batch')

    act(() => result.current.collaboration.undo())
    notes = readProject(providers[0].doc).tracks[0].notes
    expect(notes).toHaveLength(2)
    expect(notes.map((note) => note.id)).toContain('remote-batch')
  })

  it('keeps rapid loop toggles as separate Yjs undo items without removing remote edits', () => {
    const initialProject = seedProject()
    const store = new LocalStorageProjectStore(new MemoryStorage())
    const { result } = renderHook(() =>
      useIntegratedComposerCollaboration(initialProject, store),
    )

    const remote = readProject(providers[0].doc)
    remote.tracks[0].notes.push(createNote({ pitch: 72, start: 4 }, 'remote-loop'))
    act(() => reconcileDoc(providers[0].doc, remote, 'remote-peer'))

    act(() => {
      result.current.controller.toggleLoop()
      result.current.controller.toggleLoop()
    })
    expect(readProject(providers[0].doc).loop.enabled).toBe(false)

    act(() => result.current.collaboration.undo())
    expect(readProject(providers[0].doc).loop.enabled).toBe(true)
    expect(readProject(providers[0].doc).tracks[0].notes.map((note) => note.id))
      .toContain('remote-loop')
    act(() => result.current.collaboration.undo())
    expect(readProject(providers[0].doc).loop.enabled).toBe(false)

    act(() => result.current.collaboration.redo())
    expect(readProject(providers[0].doc).loop.enabled).toBe(true)
    act(() => result.current.collaboration.redo())
    expect(readProject(providers[0].doc).loop.enabled).toBe(false)
  })

  it('shares and undo/redoes an effect parameter gesture during active collaboration', () => {
    const initialProject = seedProject()
    const store = new LocalStorageProjectStore(new MemoryStorage())
    const { result } = renderHook(() =>
      useIntegratedComposerCollaboration(initialProject, store),
    )
    const trackId = result.current.controller.selectedTrackId
    act(() => result.current.controller.addMixInsert(trackId, 'reverb'))
    const insertId =
      result.current.controller.project.mix!.tracks[trackId].inserts[0].id
    act(() =>
      result.current.controller.setMixInsertParam(trackId, insertId, 'wet', 0.4),
    )
    act(() =>
      result.current.controller.setMixInsertParam(trackId, insertId, 'wet', 0.6),
    )
    act(() => result.current.controller.stopHistoryCapture())

    expect(
      readProject(providers[0].doc).mix?.tracks[trackId].inserts[0].params.wet,
    ).toBe(0.6)
    expect(result.current.collaboration.canUndo).toBe(true)

    act(() => result.current.collaboration.undo())
    expect(
      readProject(providers[0].doc).mix?.tracks[trackId].inserts[0].params.wet,
    ).toBe(0.32)
    expect(
      result.current.controller.project.mix?.tracks[trackId].inserts[0].params.wet,
    ).toBe(0.32)

    act(() => result.current.collaboration.redo())
    expect(
      readProject(providers[0].doc).mix?.tracks[trackId].inserts[0].params.wet,
    ).toBe(0.6)
  })

  it('keeps one local gesture capture across a remote sync', () => {
    const initialProject = seedProject()
    const store = new LocalStorageProjectStore(new MemoryStorage())
    const { result } = renderHook(() =>
      useIntegratedComposerCollaboration(initialProject, store),
    )
    const trackId = result.current.controller.selectedTrackId

    act(() => result.current.controller.updateNote(trackId, 'n1', { start: 0.1 }))
    const remote = readProject(providers[0].doc)
    remote.tracks[0].notes.push(createNote({ pitch: 72, start: 4 }, 'remote-mid-gesture'))
    act(() => reconcileDoc(providers[0].doc, remote, 'remote-peer'))
    act(() => result.current.controller.updateNote(trackId, 'n1', { start: 0.2 }))

    act(() => result.current.collaboration.undo())
    const afterUndo = readProject(providers[0].doc)
    expect(afterUndo.tracks[0].notes.find((note) => note.id === 'n1')?.start).toBe(0)
    expect(afterUndo.tracks[0].notes.map((note) => note.id)).toContain('remote-mid-gesture')
    expect(result.current.collaboration.canUndo).toBe(false)
  })

  it('publishes every local whole-project replacement and suppresses sync-remote echo', async () => {
    const initialProject = seedProject()
    const store = new LocalStorageProjectStore(new MemoryStorage())
    const opened = createEmptyProject('opened')
    opened.name = 'Stored open'
    await store.save(opened)
    const { result } = renderHook(() =>
      useIntegratedComposerCollaboration(initialProject, store),
    )

    act(() => result.current.controller.newProject())
    await waitFor(() =>
      expect(readProject(providers[0].doc).id).toBe(result.current.controller.project.id),
    )
    expect(result.current.collaboration.canUndo).toBe(false)

    act(() => result.current.controller.loadDemo())
    await waitFor(() =>
      expect(readProject(providers[0].doc).name).toBe('Demo — Every idea, resolved'),
    )
    expect(result.current.collaboration.canUndo).toBe(false)

    const quickStart = createEmptyProject('quick-source')
    quickStart.name = 'Quick start'
    act(() => result.current.controller.loadProjectSnapshot(quickStart))
    await waitFor(() =>
      expect(readProject(providers[0].doc).name).toBe('Quick start'),
    )
    expect(result.current.collaboration.canUndo).toBe(false)

    await act(async () => result.current.controller.loadProject('opened'))
    expect(readProject(providers[0].doc).id).toBe('opened')
    expect(readProject(providers[0].doc).name).toBe('Stored open')
    expect(result.current.collaboration.canUndo).toBe(false)

    const imported = createEmptyProject('import-source')
    imported.name = 'Imported file'
    act(() =>
      result.current.controller.importProjectFile(projectToFile(imported)),
    )
    await waitFor(() =>
      expect(readProject(providers[0].doc).name).toBe('Imported file'),
    )
    expect(result.current.collaboration.canUndo).toBe(false)

    const beforeRemoteOnly = readProject(providers[0].doc)
    const remoteOnly = createEmptyProject('remote-only')
    remoteOnly.name = 'Remote only'
    act(() => result.current.controller.applyRemoteProject(remoteOnly))
    expect(readProject(providers[0].doc)).toEqual(beforeRemoteOnly)

    const remoteAfterReplacement = readProject(providers[0].doc)
    remoteAfterReplacement.tracks[0].notes.push(
      createNote({ pitch: 72, start: 4 }, 'remote-after-replacement'),
    )
    act(() =>
      reconcileDoc(providers[0].doc, remoteAfterReplacement, 'remote-peer'),
    )
    const replacementId = readProject(providers[0].doc).id
    const trackId = result.current.controller.selectedTrackId
    act(() => result.current.controller.addNoteAt(trackId, 64, 1))
    expect(result.current.collaboration.canUndo).toBe(true)
    expect(readProject(providers[0].doc).tracks[0].notes).toHaveLength(2)

    act(() => result.current.collaboration.undo())
    const afterUndo = readProject(providers[0].doc)
    expect(afterUndo.id).toBe(replacementId)
    expect(afterUndo.tracks[0].notes.map((note) => note.id)).toEqual([
      'remote-after-replacement',
    ])
    expect(result.current.collaboration.canUndo).toBe(false)
  })
})
