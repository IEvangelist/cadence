import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from '../project'
import { MemoryStorage } from '../storage'
import type { CollabConfig } from './useCollaboration'
import {
  clearOwnerCollaborationData,
  createCollaborationBackupStore,
  registerCollaborationDatabase,
} from './offlineCollabStorage'

const config: CollabConfig = {
  projectId: 'project-1',
  roomOwnerId: 'room-owner-1',
  networkEnabled: true,
  role: 'editor',
  url: 'wss://relay.example/api/collab',
  token: 'grant-1',
  user: { id: 'account-1', name: 'Ada', color: '#f0f' },
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => vi.unstubAllGlobals())

describe('owner-scoped offline collaboration storage', () => {
  it('isolates serialized backups by account, owner, project, and grant', async () => {
    const storage = new MemoryStorage()
    const source = createCollaborationBackupStore(config, storage)
    const project = createEmptyProject('project-1')
    project.name = 'Account one'
    await source.persist?.(project)

    expect((await source.loadLast())?.name).toBe('Account one')
    for (const isolated of [
      { ...config, user: { ...config.user, id: 'account-2' } },
      { ...config, roomOwnerId: 'room-owner-2' },
      { ...config, projectId: 'project-2' },
      { ...config, token: 'grant-2' },
    ]) {
      expect(
        await createCollaborationBackupStore(isolated, storage).loadLast(),
      ).toBeNull()
    }
  })

  it('purges one owner backup and every registered Yjs database', async () => {
    const storage = new MemoryStorage()
    const indexedDB = new IDBFactory()
    const backup = createCollaborationBackupStore(config, storage)
    await backup.persist?.(createEmptyProject('project-1'))

    const databaseName = 'cadence.collab.v1:account-1:scope'
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
    registerCollaborationDatabase(config.user.id, databaseName, storage)

    await clearOwnerCollaborationData(config.user.id, {
      storage,
      indexedDB,
      timeoutMs: 100,
    })

    expect(await backup.loadLast()).toBeNull()
    expect((await indexedDB.databases()).map((database) => database.name))
      .not.toContain(databaseName)
  })

  it('does not purge another account', async () => {
    const storage = new MemoryStorage()
    const other = { ...config, user: { ...config.user, id: 'account-2' } }
    const firstBackup = createCollaborationBackupStore(config, storage)
    const otherBackup = createCollaborationBackupStore(other, storage)
    await firstBackup.persist?.(createEmptyProject('project-1'))
    await otherBackup.persist?.(createEmptyProject('project-1'))

    await clearOwnerCollaborationData(config.user.id, { storage })

    expect(await firstBackup.loadLast()).toBeNull()
    expect(await otherBackup.loadLast()).not.toBeNull()
  })

  it('retains a blocked database registry entry so cleanup can retry', async () => {
    const storage = new MemoryStorage()
    const indexedDB = new IDBFactory()
    const databaseName = 'cadence.collab.v1:account-1:blocked'
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    registerCollaborationDatabase(config.user.id, databaseName, storage)

    await clearOwnerCollaborationData(config.user.id, {
      storage,
      indexedDB,
      timeoutMs: 5,
    })
    const registryKey = Array.from(
      { length: storage.length },
      (_, index) => storage.key(index),
    ).find((key) => key?.includes('idb-registry'))
    expect(registryKey && storage.getItem(registryKey)).toContain(databaseName)

    database.close()
    await clearOwnerCollaborationData(config.user.id, {
      storage,
      indexedDB,
      timeoutMs: 100,
    })
    expect((await indexedDB.databases()).map((entry) => entry.name))
      .not.toContain(databaseName)
  })
})
