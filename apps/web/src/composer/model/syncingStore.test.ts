import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from './project'
import { LocalStorageProjectStore, MemoryStorage, type ProjectStore } from './storage'
import { SyncingProjectStore, type AuthFlag } from './syncingStore'
import type { CollabConfig } from './collab/useCollaboration'

const makeLocal = (): ProjectStore => new LocalStorageProjectStore(new MemoryStorage())

describe('SyncingProjectStore', () => {
  let local: ProjectStore
  let remote: ProjectStore
  let auth: AuthFlag
  let store: SyncingProjectStore
  let collaborationStorage: MemoryStorage

  beforeEach(() => {
    local = makeLocal()
    remote = makeLocal()
    auth = {
      current: false,
      mode: 'anonymous',
      ownerId: null,
      generation: 0,
    }
    collaborationStorage = new MemoryStorage()
    store = new SyncingProjectStore(
      local,
      remote,
      auth,
      collaborationStorage,
    )
    vi.stubGlobal('crypto', webcrypto)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('routes to the local store when signed out', async () => {
    await store.save(createEmptyProject('p1'))

    expect(await local.list()).toHaveLength(1)
    expect(await remote.list()).toHaveLength(0)
  })

  it('routes to the remote store when signed in', async () => {
    auth.current = true
    auth.mode = 'authenticated'
    await store.save(createEmptyProject('p2'))

    expect(await remote.list()).toHaveLength(1)
    expect(await local.list()).toHaveLength(0)
  })

  it('follows the flag across calls on one instance', async () => {
    await store.save(createEmptyProject('local-only'))
    auth.current = true
    auth.mode = 'authenticated'
    await store.save(createEmptyProject('remote-only'))

    expect((await local.list()).map((m) => m.id)).toEqual(['local-only'])
    expect((await remote.list()).map((m) => m.id)).toEqual(['remote-only'])
  })

  it('binds save and last-pointer update to the backend captured before await', async () => {
    let finishSave!: (meta: { id: string; name: string; updatedAt: number }) => void
    const pendingSave = new Promise<{ id: string; name: string; updatedAt: number }>(
      (resolve) => {
        finishSave = resolve
      },
    )
    const remoteSave = vi.spyOn(remote, 'save').mockReturnValue(pendingSave)
    // Exercise the fallback transaction too: it must capture `remote` once.
    remote.persist = undefined
    const remoteSetLast = vi.spyOn(remote, 'setLast')
    const localSetLast = vi.spyOn(local, 'setLast')
    auth.current = true
    const project = createEmptyProject('remote-pending')

    const persistence = store.persist(project)
    expect(remoteSave).toHaveBeenCalledWith(project)
    auth.current = false
    finishSave({ id: project.id, name: project.name, updatedAt: 1 })
    await persistence

    expect(remoteSetLast).toHaveBeenCalledWith(project.id)
    expect(localSetLast).not.toHaveBeenCalled()
    expect(await local.loadLast()).toBeNull()
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

  it('preserves the pre-sync remote last project after uploads', async () => {
    await remote.save(createEmptyProject('remote-last'))
    await remote.setLast('remote-last')
    await local.save(createEmptyProject('local-new'))
    const setLast = vi.spyOn(remote, 'setLast')

    await store.syncLocalToRemote()

    expect(setLast).toHaveBeenLastCalledWith('remote-last')
    expect((await remote.loadLast())?.id).toBe('remote-last')
  })

  it('chooses the newest synced local project when remote has no last project', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      await local.save(createEmptyProject('older-local'))
      vi.setSystemTime(new Date(2_000))
      await local.save(createEmptyProject('newest-local'))
      const setLast = vi.spyOn(remote, 'setLast')

      await store.syncLocalToRemote()

      expect(setLast).toHaveBeenLastCalledWith('newest-local')
      expect((await remote.loadLast())?.id).toBe('newest-local')
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the prior remote last project when a later upload fails', async () => {
    await remote.save(createEmptyProject('remote-last'))
    await remote.setLast('remote-last')
    await local.save(createEmptyProject('older-local'))
    await local.save(createEmptyProject('newest-local'))
    const realSave = remote.save.bind(remote)
    vi.spyOn(remote, 'save')
      .mockImplementationOnce(realSave)
      .mockRejectedValueOnce(new Error('second upload failed'))

    await expect(store.syncLocalToRemote()).rejects.toThrow('second upload failed')

    expect((await remote.loadLast())?.id).toBe('remote-last')
  })

  it('keeps the newest successful local as last when a later upload fails', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(1_000))
      await local.save(createEmptyProject('older-local'))
      vi.setSystemTime(new Date(2_000))
      await local.save(createEmptyProject('newest-local'))
      const realSave = remote.save.bind(remote)
      vi.spyOn(remote, 'save')
        .mockImplementationOnce(realSave)
        .mockRejectedValueOnce(new Error('second upload failed'))

      await expect(store.syncLocalToRemote()).rejects.toThrow('second upload failed')

      expect((await remote.loadLast())?.id).toBe('newest-local')
    } finally {
      vi.useRealTimers()
    }
  })

  const collabConfig = (): CollabConfig => ({
    projectId: 'shared',
    roomOwnerId: 'room-owner',
    networkEnabled: true,
    role: 'editor',
    url: 'wss://relay.example/api/collab',
    token: 'grant',
    user: { id: 'account-1', name: 'Ada', color: '#f0f' },
  })

  it('keeps remote primary while maintaining an owner-scoped collaborative backup', async () => {
    auth.current = true
    auth.mode = 'authenticated'
    auth.ownerId = 'account-1'
    const scoped = store.forCollaboration(collabConfig())
    const project = createEmptyProject('shared')
    project.name = 'Saved remotely'

    await scoped.persist?.(project)

    expect((await remote.load('shared'))?.name).toBe('Saved remotely')
    auth.current = false
    auth.mode = 'offline'
    expect((await scoped.loadLast())?.name).toBe('Saved remotely')
    expect(await local.load('shared')).toBeNull()
  })

  it('writes the collaborative backup but still surfaces a remote save failure', async () => {
    auth.current = true
    auth.mode = 'authenticated'
    auth.ownerId = 'account-1'
    const scoped = store.forCollaboration(collabConfig())
    vi.spyOn(remote, 'save').mockRejectedValue(new Error('remote unavailable'))
    remote.persist = undefined
    const project = createEmptyProject('shared')
    project.name = 'Offline safety copy'

    await expect(scoped.persist?.(project)).rejects.toThrow('remote unavailable')

    auth.current = false
    auth.mode = 'offline'
    expect((await scoped.loadLast())?.name).toBe('Offline safety copy')
  })

  it('never exposes an owner backup to anonymous or different-account scopes', async () => {
    auth.current = true
    auth.mode = 'authenticated'
    auth.ownerId = 'account-1'
    const ownerStore = store.forCollaboration(collabConfig())
    await ownerStore.persist?.(createEmptyProject('shared'))

    auth.current = false
    auth.mode = 'anonymous'
    auth.ownerId = null
    expect(await ownerStore.loadLast()).toBeNull()

    auth.mode = 'offline'
    auth.ownerId = 'account-2'
    const otherStore = store.forCollaboration({
      ...collabConfig(),
      user: { id: 'account-2', name: 'Bea', color: '#0ff' },
    })
    expect(await ownerStore.loadLast()).toBeNull()
    expect((await otherStore.loadLast())?.name).not.toBe('Owner backup')
  })

  it.each([
    ['sign-out', { mode: 'anonymous' as const, ownerId: null }],
    ['account switch', { mode: 'authenticated' as const, ownerId: 'account-2' }],
  ])(
    'does not recreate a purged backup when a remote save completes after %s',
    async (_label, transition) => {
      auth.current = true
      auth.mode = 'authenticated'
      auth.ownerId = 'account-1'
      auth.generation = 1
      const scoped = store.forCollaboration(collabConfig())
      let finishRemote!: (meta: {
        id: string
        name: string
        updatedAt: number
      }) => void
      remote.persist = vi.fn(
        () =>
          new Promise<{ id: string; name: string; updatedAt: number }>((resolve) => {
            finishRemote = resolve
          }),
      )
      const project = createEmptyProject('shared')
      project.name = 'Late old-owner backup'
      const saving = scoped.persist?.(project)
      await waitForCall(remote.persist!)

      auth.generation = 2
      auth.current = transition.mode === 'authenticated'
      auth.mode = transition.mode
      auth.ownerId = transition.ownerId
      await store.clearOwnerCollaborationData('account-1')
      finishRemote({ id: project.id, name: project.name, updatedAt: 1 })
      await saving

      auth.generation = 3
      auth.current = false
      auth.mode = 'offline'
      auth.ownerId = 'account-1'
      expect((await scoped.loadLast())?.name)
        .not.toBe('Late old-owner backup')
      const staleKeys = Array.from(
        { length: collaborationStorage.length },
        (_, index) => collaborationStorage.key(index),
      ).filter((key) =>
        key?.startsWith('cadence.collab.backup.v1:account-1:'),
      )
      expect(staleKeys).toEqual([])
    },
  )
})

async function waitForCall(
  mock: ProjectStore['persist'],
): Promise<void> {
  await vi.waitFor(() => {
    expect(mock).toHaveBeenCalled()
  })
}
