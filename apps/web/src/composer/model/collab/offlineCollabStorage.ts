import {
  LocalStorageProjectStore,
  MemoryStorage,
  type ProjectStore,
  type SyncStorage,
} from '../storage'
import type { Project } from '../project'
import type { CollabConfig } from './useCollaboration'
import { collabPersistenceScopeId } from './collabPersistenceIdentity'

const BACKUP_PREFIX = 'cadence.collab.backup.v1:'
const REGISTRY_PREFIX = 'cadence.collab.idb-registry.v1:'
const PENDING_REGISTRY_PREFIX = 'cadence.collab.idb-pending.v1:'

function defaultStorage(): SyncStorage {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined'
    ? (globalThis as unknown as { localStorage: SyncStorage }).localStorage
    : new MemoryStorage()
}

function ownerPrefix(base: string, ownerId: string): string {
  return `${base}${encodeURIComponent(ownerId)}:`
}

class PrefixedStorage implements SyncStorage {
  private readonly storage: SyncStorage
  private readonly prefix: string

  constructor(
    storage: SyncStorage,
    prefix: string,
  ) {
    this.storage = storage
    this.prefix = prefix
  }

  getItem(key: string): string | null {
    return this.storage.getItem(`${this.prefix}${key}`)
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(`${this.prefix}${key}`, value)
  }

  removeItem(key: string): void {
    this.storage.removeItem(`${this.prefix}${key}`)
  }
}

class DeferredBackupStore implements ProjectStore {
  private readonly store: Promise<LocalStorageProjectStore>

  constructor(config: CollabConfig, storage: SyncStorage) {
    this.store = collabPersistenceScopeId(config).then(
      (scopeId) =>
        new LocalStorageProjectStore(
          new PrefixedStorage(
            storage,
            `${ownerPrefix(BACKUP_PREFIX, config.user.id)}${scopeId}:`,
          ),
        ),
    )
  }

  async save(project: Project) {
    return (await this.store).save(project)
  }

  async persist(project: Project) {
    return (await this.store).persist(project)
  }

  async load(id: string) {
    return (await this.store).load(id)
  }

  async list() {
    return (await this.store).list()
  }

  async remove(id: string) {
    return (await this.store).remove(id)
  }

  async loadLast() {
    return (await this.store).loadLast()
  }

  async setLast(id: string) {
    return (await this.store).setLast(id)
  }
}

export function createCollaborationBackupStore(
  config: CollabConfig,
  storage: SyncStorage = defaultStorage(),
): ProjectStore {
  return new DeferredBackupStore(config, storage)
}

function registryKey(ownerId: string): string {
  return `${REGISTRY_PREFIX}${encodeURIComponent(ownerId)}`
}

function pendingRegistryKey(ownerId: string): string {
  return `${PENDING_REGISTRY_PREFIX}${encodeURIComponent(ownerId)}`
}

function readNames(storage: SyncStorage, key: string): string[] {
  const raw = storage.getItem(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === 'string')
      : []
  } catch {
    return []
  }
}

function writeNames(storage: SyncStorage, key: string, names: string[]): void {
  if (names.length > 0) storage.setItem(key, JSON.stringify([...new Set(names)]))
  else storage.removeItem(key)
}

/** Track every owner-scoped Yjs database so explicit auth cleanup can delete it. */
export function registerCollaborationDatabase(
  ownerId: string,
  databaseName: string,
  storage: SyncStorage = defaultStorage(),
): void {
  const key = registryKey(ownerId)
  const names = readNames(storage, key)
  if (!names.includes(databaseName)) names.push(databaseName)
  writeNames(storage, key, names)
}

function bounded<T>(
  work: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(fallback), timeoutMs)
    void work.then(finish, () => finish(fallback))
  })
}

function allKeys(storage: SyncStorage): string[] {
  const keys: string[] = []
  for (let index = 0; index < (storage.length ?? 0); index += 1) {
    const key = storage.key?.(index)
    if (key) keys.push(key)
  }
  return keys
}

function deleteDatabase(
  indexedDB: IDBFactory,
  name: string,
  timeoutMs = 2_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (deleted: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(deleted)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    try {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => finish(true)
      request.onerror = () => finish(false)
      // The request remains pending and will complete after another tab/provider
      // closes; cleanup itself stays bounded.
      request.onblocked = () => {}
    } catch {
      finish(false)
    }
  })
}

interface CleanupOptions {
  storage?: SyncStorage
  indexedDB?: IDBFactory
  timeoutMs?: number
}

async function deleteRegisteredDatabases(
  ownerId: string,
  names: string[],
  options: CleanupOptions,
): Promise<void> {
  const storage = options.storage ?? defaultStorage()
  const pendingKey = pendingRegistryKey(ownerId)
  const indexedDB =
    options.indexedDB ??
    (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (!indexedDB) {
    writeNames(storage, pendingKey, names)
    return
  }
  const results = await Promise.all(
    names.map((name) => deleteDatabase(indexedDB, name, options.timeoutMs)),
  )
  writeNames(
    storage,
    pendingKey,
    names.filter((_name, index) => !results[index]),
  )
}

/**
 * Purge all serialized backups and registered Yjs databases for one confirmed
 * account. Anonymous callers never receive a store capable of reading them.
 */
export async function clearOwnerCollaborationData(
  ownerId: string,
  options: {
    storage?: SyncStorage
    indexedDB?: IDBFactory
    timeoutMs?: number
  } = {},
): Promise<void> {
  const storage = options.storage ?? defaultStorage()
  const backupPrefix = ownerPrefix(BACKUP_PREFIX, ownerId)
  allKeys(storage)
    .filter((key) => key.startsWith(backupPrefix))
    .forEach((key) => storage.removeItem(key))

  const key = registryKey(ownerId)
  const pendingKey = pendingRegistryKey(ownerId)
  const names = [
    ...new Set([
      ...readNames(storage, key),
      ...readNames(storage, pendingKey),
    ]),
  ]
  storage.removeItem(key)
  const indexedDB =
    options.indexedDB ??
    (globalThis as { indexedDB?: IDBFactory }).indexedDB
  if (indexedDB) {
    const databasePrefix =
      `cadence.collab.v1:${encodeURIComponent(ownerId)}:`
    const discovered = await bounded(
      Promise.resolve().then(() => indexedDB.databases()),
      options.timeoutMs ?? 2_000,
      [],
    )
    for (const database of discovered) {
      if (
        database.name?.startsWith(databasePrefix) &&
        !names.includes(database.name)
      ) {
        names.push(database.name)
      }
    }
  }
  if (names.length === 0) {
    storage.removeItem(pendingKey)
    return
  }
  await deleteRegisteredDatabases(ownerId, names, options)
}

/** Retry only deletions previously retained after a bounded/blocked cleanup. */
export async function retryPendingOwnerCollaborationCleanup(
  ownerId: string,
  options: CleanupOptions = {},
): Promise<void> {
  const storage = options.storage ?? defaultStorage()
  const names = readNames(storage, pendingRegistryKey(ownerId))
  if (names.length === 0) return
  await deleteRegisteredDatabases(ownerId, names, options)
}

/** Retry every retained owner cleanup during application/auth startup. */
export async function retryPendingCollaborationCleanup(
  options: CleanupOptions = {},
): Promise<void> {
  const storage = options.storage ?? defaultStorage()
  const owners = allKeys(storage)
    .filter((key) => key.startsWith(PENDING_REGISTRY_PREFIX))
    .map((key) => {
      try {
        return decodeURIComponent(key.slice(PENDING_REGISTRY_PREFIX.length))
      } catch {
        return ''
      }
    })
    .filter(Boolean)
  await Promise.all(
    owners.map((ownerId) =>
      retryPendingOwnerCollaborationCleanup(ownerId, options),
    ),
  )
}
