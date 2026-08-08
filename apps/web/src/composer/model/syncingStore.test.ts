import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from './project'
import { LocalStorageProjectStore, MemoryStorage, type ProjectStore } from './storage'
import { SyncingProjectStore, type AuthFlag } from './syncingStore'

const makeLocal = (): ProjectStore => new LocalStorageProjectStore(new MemoryStorage())

describe('SyncingProjectStore', () => {
  let local: ProjectStore
  let remote: ProjectStore
  let auth: AuthFlag
  let store: SyncingProjectStore

  beforeEach(() => {
    local = makeLocal()
    remote = makeLocal()
    auth = { current: false }
    store = new SyncingProjectStore(local, remote, auth)
  })

  it('routes to the local store when signed out', async () => {
    await store.save(createEmptyProject('p1'))

    expect(await local.list()).toHaveLength(1)
    expect(await remote.list()).toHaveLength(0)
  })

  it('routes to the remote store when signed in', async () => {
    auth.current = true
    await store.save(createEmptyProject('p2'))

    expect(await remote.list()).toHaveLength(1)
    expect(await local.list()).toHaveLength(0)
  })

  it('follows the flag across calls on one instance', async () => {
    await store.save(createEmptyProject('local-only'))
    auth.current = true
    await store.save(createEmptyProject('remote-only'))

    expect((await local.list()).map((m) => m.id)).toEqual(['local-only'])
    expect((await remote.list()).map((m) => m.id)).toEqual(['remote-only'])
  })

  it('delegates load/remove/loadLast/setLast to the active backend', async () => {
    const project = createEmptyProject('p3')
    await store.save(project)
    await store.setLast('p3')

    expect((await store.load('p3'))?.id).toBe('p3')
    expect((await store.loadLast())?.id).toBe('p3')

    await store.remove('p3')
    expect(await store.load('p3')).toBeNull()
  })

  it('syncLocalToRemote() pushes only local-only projects', async () => {
    await local.save(createEmptyProject('a'))
    await local.save(createEmptyProject('b'))
    await remote.save(createEmptyProject('b')) // already on the server

    const synced = await store.syncLocalToRemote()

    expect(synced).toBe(1)
    expect((await remote.list()).map((m) => m.id).sort()).toEqual(['a', 'b'])
  })

  it('syncLocalToRemote() pushes offline edits when the local copy is newer', async () => {
    vi.useFakeTimers()
    try {
      // Server has an older copy of 'x'.
      vi.setSystemTime(new Date(1_000))
      await remote.save({ ...createEmptyProject('x'), name: 'Server copy' })

      // The same project was edited offline more recently.
      vi.setSystemTime(new Date(2_000))
      await local.save({ ...createEmptyProject('x'), name: 'Offline edit' })

      const synced = await store.syncLocalToRemote()

      expect(synced).toBe(1)
      expect((await remote.load('x'))?.name).toBe('Offline edit')
    } finally {
      vi.useRealTimers()
    }
  })

  it('syncLocalToRemote() keeps the server copy when it is newer', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      await local.save({ ...createEmptyProject('y'), name: 'Stale local' })

      vi.setSystemTime(new Date(2_000))
      await remote.save({ ...createEmptyProject('y'), name: 'Fresh server' })

      const synced = await store.syncLocalToRemote()

      expect(synced).toBe(0)
      expect((await remote.load('y'))?.name).toBe('Fresh server')
    } finally {
      vi.useRealTimers()
    }
  })

  it('syncLocalToRemote() is a no-op with nothing local', async () => {
    expect(await store.syncLocalToRemote()).toBe(0)
  })
})
