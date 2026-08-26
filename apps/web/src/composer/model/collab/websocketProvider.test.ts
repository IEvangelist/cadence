import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { createEmptyProject, createNote, createTrack } from './../project'
import { readProject, reconcileDoc, seedProjectDoc } from './crdt'
import type { CollabConfig, CollabProvider } from './useCollaboration'
import {
  collabPersistenceName,
  createWebsocketProvider,
  type WebsocketProviderDependencies,
} from './websocketProvider'

class FakeSocket {
  readonly awareness: Awareness
  connect = vi.fn()
  destroy = vi.fn(() => {
    this.statusListeners.clear()
    this.syncedListeners.clear()
    this.awareness.destroy()
  })
  private readonly statusListeners = new Set<(connected: boolean) => void>()
  private readonly syncedListeners = new Set<() => void>()

  constructor(doc: Y.Doc) {
    this.awareness = new Awareness(doc)
  }

  onStatus = (listener: (connected: boolean) => void) => {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onSynced = (listener: () => void) => {
    this.syncedListeners.add(listener)
    return () => this.syncedListeners.delete(listener)
  }

  fireSynced() {
    this.syncedListeners.forEach((listener) => listener())
  }
}

const config: CollabConfig = {
  projectId: 'project-1',
  roomOwnerId: 'owner-1',
  networkEnabled: true,
  role: 'editor',
  url: 'wss://relay.example/api/collab',
  token: 'replaceable-token',
  user: { id: 'account-1', name: 'Ada', color: '#f0f' },
}

const providers: CollabProvider[] = []
const persistences: IndexeddbPersistence[] = []

function dependencies(sockets: FakeSocket[]): WebsocketProviderDependencies {
  return {
    resolvePersistenceName: collabPersistenceName,
    registerPersistence: vi.fn(),
    persistenceTimeoutMs: 1_000,
    createPersistence: (name, doc) => {
      const persistence = new IndexeddbPersistence(name, doc)
      persistences.push(persistence)
      return persistence
    },
    createSocket: (_config, doc) => {
      const socket = new FakeSocket(doc)
      sockets.push(socket)
      return socket
    },
  }
}

function waitForPersistence(provider: CollabProvider): Promise<void> {
  return new Promise((resolve) => {
    provider.onPersistenceSynced?.(resolve)
  })
}

async function flushUpdates(persistence: IndexeddbPersistence): Promise<void> {
  const db = persistence.db
  if (!db) throw new Error('IndexedDB persistence has not opened')
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(['updates'], 'readonly')
    transaction.objectStore('updates').count()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function project() {
  const value = createEmptyProject('shared')
  const track = createTrack({ name: 'Synth' }, 'track-1')
  track.notes = [createNote({ pitch: 60, start: 0 }, 'initial')]
  value.tracks = [track]
  return value
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  vi.stubGlobal('crypto', webcrypto)
})

afterEach(async () => {
  vi.useRealTimers()
  for (const provider of providers.splice(0)) provider.destroy()
  await Promise.allSettled(persistences.splice(0).map((persistence) => persistence.destroy()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createWebsocketProvider IndexedDB lifecycle', () => {
  it('uses a stable room cache while isolating account, owner, project, and relay', async () => {
    const name = await collabPersistenceName(config)
    expect(await collabPersistenceName({ ...config, role: 'viewer' })).toBe(name)
    expect(await collabPersistenceName({ ...config, token: 'rotated' })).not.toBe(name)
    expect(
      await collabPersistenceName({
        ...config,
        user: { ...config.user, id: 'account-2' },
      }),
    ).not.toBe(name)
    expect(await collabPersistenceName({ ...config, roomOwnerId: 'owner-2' }))
      .not.toBe(name)
    expect(await collabPersistenceName({ ...config, projectId: 'project-2' }))
      .not.toBe(name)
    expect(
      await collabPersistenceName({
        ...config,
        url: 'wss://other.example/api/collab',
      }),
    ).not.toBe(name)
    expect(name).not.toContain(config.token)
  })

  it('hydrates before one socket connect, survives reload, and merges on reconnect', async () => {
    const firstSockets: FakeSocket[] = []
    const first = createWebsocketProvider(config, dependencies(firstSockets))
    providers.push(first)

    expect(firstSockets).toHaveLength(1)
    expect(firstSockets[0].connect).not.toHaveBeenCalled()
    await waitForPersistence(first)
    expect(persistences).toHaveLength(1)
    expect(persistences[0].doc).toBe(first.doc)
    expect(firstSockets[0].connect).toHaveBeenCalledTimes(1)

    const initial = project()
    seedProjectDoc(first.doc, initial)
    const initialUpdate = Y.encodeStateAsUpdate(first.doc)

    const offline = readProject(first.doc)
    offline.tracks[0].notes.push(createNote({ pitch: 64, start: 1 }, 'offline'))
    reconcileDoc(first.doc, offline, 'offline-edit')
    await flushUpdates(persistences[0])
    first.destroy()
    await persistences[0].destroy()

    const serverDoc = new Y.Doc()
    Y.applyUpdate(serverDoc, initialUpdate)
    const remote = readProject(serverDoc)
    remote.tracks[0].notes.push(createNote({ pitch: 67, start: 2 }, 'remote'))
    reconcileDoc(serverDoc, remote, 'remote-edit')

    const reloadSockets: FakeSocket[] = []
    const reload = createWebsocketProvider(config, dependencies(reloadSockets))
    providers.push(reload)
    await waitForPersistence(reload)

    expect(readProject(reload.doc).tracks[0].notes.map((note) => note.id))
      .toContain('offline')
    expect(reloadSockets[0].connect).toHaveBeenCalledTimes(1)

    Y.applyUpdate(reload.doc, Y.encodeStateAsUpdate(serverDoc), 'relay')
    expect(readProject(reload.doc).tracks[0].notes.map((note) => note.id).sort())
      .toEqual(['initial', 'offline', 'remote'])

    serverDoc.destroy()
  })

  it('keeps other accounts and projects from adopting a cached document', async () => {
    const sockets: FakeSocket[] = []
    const source = createWebsocketProvider(config, dependencies(sockets))
    providers.push(source)
    await waitForPersistence(source)
    seedProjectDoc(source.doc, project())
    await flushUpdates(persistences[0])

    for (const isolated of [
      { ...config, user: { ...config.user, id: 'account-2' } },
      { ...config, roomOwnerId: 'owner-2' },
      { ...config, projectId: 'project-2' },
    ]) {
      const provider = createWebsocketProvider(isolated, dependencies(sockets))
      providers.push(provider)
      await waitForPersistence(provider)
      expect(provider.doc.getMap('project').size).toBe(0)
    }
  })

  it('destroys persistence and a not-yet-connected socket without late listeners', async () => {
    let resolvePersistence!: () => void
    const persistence = {
      synced: false,
      whenSynced: new Promise<void>((resolve) => {
        resolvePersistence = resolve
      }),
      destroy: vi.fn(),
    }
    let socket!: FakeSocket
    const listener = vi.fn()
    const syncedListener = vi.fn()
    const provider = createWebsocketProvider(config, {
      resolvePersistenceName: async () => 'test-persistence',
      registerPersistence: vi.fn(),
      persistenceTimeoutMs: 1_000,
      createPersistence: vi.fn(() => persistence),
      createSocket: (_config, doc) => {
        socket = new FakeSocket(doc)
        return socket
      },
    })
    provider.onPersistenceSynced?.(listener)
    provider.onSynced?.(syncedListener)
    await Promise.resolve()

    provider.destroy()
    resolvePersistence()
    await Promise.resolve()
    await Promise.resolve()

    expect(persistence.destroy).toHaveBeenCalledTimes(1)
    expect(socket.connect).not.toHaveBeenCalled()
    expect(socket.destroy).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    socket.fireSynced()
    expect(syncedListener).not.toHaveBeenCalled()
  })

  it('falls back after an IndexedDB open/request failure and connects the socket once', async () => {
    let resolveLateSync!: () => void
    const persistence = {
      synced: false,
      whenSynced: new Promise<void>((resolve) => {
        resolveLateSync = resolve
      }),
      whenFailed: Promise.resolve(new Error('IndexedDB open failed')),
      destroy: vi.fn(),
    }
    let socket!: FakeSocket
    const statuses: string[] = []
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backup = project()
    backup.name = 'Offline backup'
    backup.tracks[0].notes.push(
      createNote({ pitch: 64, start: 1 }, 'offline'),
    )
    const loadSerializedBackup = vi.fn(async () => backup)
    const provider = createWebsocketProvider({
      ...config,
      loadSerializedBackup,
    }, {
      resolvePersistenceName: async () => 'failed-persistence',
      registerPersistence: vi.fn(),
      persistenceTimeoutMs: 1_000,
      createPersistence: vi.fn(() => persistence),
      createSocket: (_config, doc) => {
        socket = new FakeSocket(doc)
        return socket
      },
    })
    providers.push(provider)
    provider.onPersistenceStatus?.((status) => statuses.push(status))

    await waitForPersistence(provider)

    expect(statuses).toEqual(['loading', 'unavailable'])
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('continuing without reload durability'),
      expect.any(Error),
    )
    expect(persistence.destroy).toHaveBeenCalledTimes(1)
    expect(socket.connect).toHaveBeenCalledTimes(1)
    expect(loadSerializedBackup).toHaveBeenCalledTimes(1)
    expect(provider.doc.getMap('project').size).toBe(0)

    const serverDoc = new Y.Doc()
    const server = project()
    server.name = 'Server state'
    server.tracks[0].notes.push(
      createNote({ pitch: 67, start: 2 }, 'server'),
    )
    seedProjectDoc(serverDoc, server)
    Y.applyUpdate(provider.doc, Y.encodeStateAsUpdate(serverDoc), 'relay')
    const synced = vi.fn()
    provider.onSynced?.(synced)
    socket.fireSynced()

    const recovered = readProject(provider.doc)
    expect(synced).toHaveBeenCalledOnce()
    expect(recovered.name).toBe('Offline backup')
    expect(recovered.tracks).toHaveLength(1)
    expect(recovered.tracks[0].notes.map((note) => note.id).sort())
      .toEqual(['initial', 'offline', 'server'])

    resolveLateSync()
    await Promise.resolve()
    expect(socket.connect).toHaveBeenCalledTimes(1)
    expect(loadSerializedBackup).toHaveBeenCalledTimes(1)
    serverDoc.destroy()
  })

  it('bounds a hung IndexedDB initialization and destroys it before network fallback', async () => {
    vi.useFakeTimers()
    const persistence = {
      synced: false,
      whenSynced: new Promise<never>(() => {}),
      whenFailed: new Promise<never>(() => {}),
      destroy: vi.fn(),
    }
    let socket!: FakeSocket
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = createWebsocketProvider(config, {
      resolvePersistenceName: async () => 'hung-persistence',
      registerPersistence: vi.fn(),
      persistenceTimeoutMs: 50,
      createPersistence: vi.fn(() => persistence),
      createSocket: (_config, doc) => {
        socket = new FakeSocket(doc)
        return socket
      },
    })
    providers.push(provider)
    const ready = waitForPersistence(provider)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(50)
    await ready

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('continuing without reload durability'),
      expect.objectContaining({ message: expect.stringContaining('timed out') }),
    )
    expect(persistence.destroy).toHaveBeenCalledTimes(1)
    expect(socket.connect).toHaveBeenCalledTimes(1)
  })

  it('hydrates a cached offline session without constructing or connecting a socket', async () => {
    const sockets: FakeSocket[] = []
    const createSocket = vi.fn((_config: CollabConfig, doc: Y.Doc) => {
      const socket = new FakeSocket(doc)
      sockets.push(socket)
      return socket
    })
    const provider = createWebsocketProvider(
      { ...config, networkEnabled: false },
      {
        ...dependencies(sockets),
        createSocket,
      },
    )
    providers.push(provider)

    await waitForPersistence(provider)

    expect(createSocket).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(0)
    expect(provider.awareness).toBeInstanceOf(Awareness)
  })

  it('uses the serialized fallback once when successful IndexedDB is empty', async () => {
    const sockets: FakeSocket[] = []
    const backup = project()
    backup.name = 'Serialized fallback'
    const loadSerializedBackup = vi.fn(async () => backup)
    const provider = createWebsocketProvider(
      {
        ...config,
        networkEnabled: false,
        loadSerializedBackup,
      },
      dependencies(sockets),
    )
    providers.push(provider)

    await waitForPersistence(provider)

    expect(loadSerializedBackup).toHaveBeenCalledOnce()
    expect(readProject(provider.doc).name).toBe('Serialized fallback')
    expect(sockets).toHaveLength(0)
  })
})
