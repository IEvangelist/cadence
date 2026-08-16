import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { createEmptyProject, createNote, createTrack, type Project } from './../project'
import { reconcileDoc } from './crdt'
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
})
