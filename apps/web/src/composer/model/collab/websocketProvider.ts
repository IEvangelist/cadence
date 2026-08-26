/**
 * Default {@link CollabProviderFactory} backed by y-websocket and y-indexeddb.
 * IndexedDB hydrates before the socket connects, preventing a stale serialized
 * project from racing a persisted CRDT during seed/adoption.
 */
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { Awareness } from 'y-protocols/awareness'
import type {
  CollabConfig,
  CollabProvider,
  OfflinePersistenceStatus,
} from './useCollaboration'
import { collabPersistenceName } from './collabPersistenceIdentity'
import { registerCollaborationDatabase } from './offlineCollabStorage'
import { isProjectDocEmpty, readProject, reconcileDoc } from './crdt'
import { mergeSerializedBackup } from './backupMerge'
import type { Project } from '../project'

export { collabPersistenceName } from './collabPersistenceIdentity'

interface PersistenceAdapter {
  readonly synced: boolean
  readonly whenSynced: Promise<unknown>
  /** Resolves only when IndexedDB open/request initialization fails. */
  readonly whenFailed?: Promise<unknown>
  destroy: () => void | Promise<void>
}

interface SocketAdapter {
  readonly awareness: Awareness
  connect: () => void
  destroy: () => void
  onStatus: (listener: (connected: boolean) => void) => () => void
  onSynced: (listener: () => void) => () => void
}

export interface WebsocketProviderDependencies {
  resolvePersistenceName: (config: CollabConfig) => Promise<string>
  createPersistence: (name: string, doc: Y.Doc) => PersistenceAdapter
  createSocket: (config: CollabConfig, doc: Y.Doc) => SocketAdapter
  registerPersistence: (config: CollabConfig, name: string) => void
  persistenceTimeoutMs: number
}

const defaultDependencies: WebsocketProviderDependencies = {
  resolvePersistenceName: (config) => collabPersistenceName(config),
  createPersistence: (name, doc) => {
    const persistence = new IndexeddbPersistence(name, doc)
    const opening = (
      persistence as IndexeddbPersistence & { _db?: Promise<unknown> }
    )._db
    const whenFailed = new Promise<unknown>((resolve) => {
      void opening?.catch(resolve)
    })
    return {
      get synced() {
        return persistence.synced
      },
      whenSynced: persistence.whenSynced,
      whenFailed,
      destroy: () => persistence.destroy(),
    }
  },
  createSocket: (config, doc) => {
    const provider = new WebsocketProvider(config.url, config.projectId, doc, {
      connect: false,
      // The relay authorizes the connection from the auth cookie + this token;
      // it never trusts a client-supplied role.
      params: config.token ? { token: config.token } : {},
    })
    return {
      awareness: provider.awareness,
      connect: () => provider.connect(),
      onStatus: (listener) => {
        const handler = (event: { status: string }) => listener(event.status === 'connected')
        provider.on('status', handler)
        return () => provider.off('status', handler)
      },
      onSynced: (listener) => {
        const handler = (isSynced: boolean) => {
          if (isSynced) listener()
        }
        provider.on('sync', handler)
        return () => provider.off('sync', handler)
      },
      destroy: () => provider.destroy(),
    }
  },
  registerPersistence: (config, name) =>
    registerCollaborationDatabase(config.user.id, name),
  persistenceTimeoutMs: 8_000,
}

export function createWebsocketProvider(
  config: CollabConfig,
  dependencies: WebsocketProviderDependencies = defaultDependencies,
): CollabProvider {
  const doc = new Y.Doc()
  const socket = config.networkEnabled
    ? dependencies.createSocket(config, doc)
    : undefined
  const localAwareness = socket ? undefined : new Awareness(doc)
  const persistenceListeners = new Set<() => void>()
  const persistenceStatusListeners = new Set<
    (status: OfflinePersistenceStatus) => void
  >()
  let persistence: PersistenceAdapter | undefined
  let persistenceSynced = false
  let persistenceStatus: OfflinePersistenceStatus = 'loading'
  let destroyed = false
  let socketStarted = false
  let initializationTimer: ReturnType<typeof setTimeout> | undefined
  let cancelInitialization: (() => void) | undefined
  let backupRecoveryAttempted = false
  let serializedBackup: Project | null = null
  let serializedBackupMerged = false

  const mergeBackupIntoDoc = () => {
    if (
      serializedBackupMerged ||
      !serializedBackup ||
      config.role === 'viewer'
    ) {
      return
    }
    const merged = isProjectDocEmpty(doc)
      ? serializedBackup
      : mergeSerializedBackup(readProject(doc), serializedBackup)
    serializedBackupMerged = true
    reconcileDoc(doc, merged, Symbol('cadence-collab-backup-recovery'))
  }

  const recoverSerializedBackup = async () => {
    if (
      backupRecoveryAttempted ||
      config.role === 'viewer' ||
      !config.loadSerializedBackup
    ) {
      return
    }
    backupRecoveryAttempted = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), dependencies.persistenceTimeoutMs)
    })
    const backup = await Promise.race([
      Promise.resolve()
        .then(() => config.loadSerializedBackup?.() ?? null)
        .catch(() => null),
      timeout,
    ])
    if (timer !== undefined) clearTimeout(timer)
    if (destroyed || !backup) return
    serializedBackup = backup
    // With no authorized network, the backup is the only available state.
    // Live clients defer the additive backup-precedence merge until the relay's
    // initial state has arrived, avoiding an independently seeded duplicate tree.
    if (!socket) mergeBackupIntoDoc()
  }

  const finishPersistenceSync = (status: OfflinePersistenceStatus) => {
    if (destroyed || persistenceSynced) return
    persistenceSynced = true
    persistenceStatus = status
    persistenceStatusListeners.forEach((listener) => listener(status))
    persistenceListeners.forEach((listener) => listener())
    persistenceListeners.clear()
    if (socket && !socketStarted) {
      socketStarted = true
      socket.connect()
    }
  }

  const startPersistence = async () => {
    let initializationClosed = false
    const cancellation = new Promise<{ kind: 'cancelled' }>((resolve) => {
      cancelInitialization = () => resolve({ kind: 'cancelled' })
    })
    const timeout = new Promise<{ kind: 'failed'; error: Error }>((resolve) => {
      initializationTimer = setTimeout(
        () =>
          resolve({
            kind: 'failed',
            error: new Error(
              `IndexedDB collaboration persistence timed out after ${dependencies.persistenceTimeoutMs}ms.`,
            ),
          }),
        dependencies.persistenceTimeoutMs,
      )
    })
    const initialization = (async () => {
      const name = await dependencies.resolvePersistenceName(config)
      if (destroyed || initializationClosed) {
        return { kind: 'cancelled' } as const
      }
      dependencies.registerPersistence(config, name)
      persistence = dependencies.createPersistence(name, doc)
      if (persistence.synced) return { kind: 'ready' } as const
      const ready = persistence.whenSynced.then(
        () => ({ kind: 'ready' }) as const,
      )
      const failed =
        persistence.whenFailed?.then((error) => ({
          kind: 'failed' as const,
          error,
        })) ?? new Promise<never>(() => {})
      return Promise.race([ready, failed])
    })().catch((error) => ({ kind: 'failed' as const, error }))

    const outcome = await Promise.race([
      initialization,
      timeout,
      cancellation,
    ])
    initializationClosed = true
    if (initializationTimer !== undefined) clearTimeout(initializationTimer)
    initializationTimer = undefined
    cancelInitialization = undefined
    if (outcome.kind === 'cancelled' || destroyed) return
    if (outcome.kind === 'failed') {
      const failedPersistence = persistence
      persistence = undefined
      if (failedPersistence) {
        void Promise.resolve(failedPersistence.destroy()).catch(() => undefined)
      }
      await recoverSerializedBackup()
      console.warn(
        'Offline collaboration persistence is unavailable; continuing without reload durability.',
        outcome.error,
      )
      finishPersistenceSync('unavailable')
      return
    }
    if (isProjectDocEmpty(doc)) await recoverSerializedBackup()
    finishPersistenceSync('ready')
  }
  void startPersistence()

  return {
    doc,
    awareness: socket?.awareness ?? localAwareness!,
    onStatus: socket?.onStatus,
    onSynced: socket
      ? (listener) =>
          socket.onSynced(() => {
            mergeBackupIntoDoc()
            listener()
          })
      : undefined,
    onPersistenceSynced: (listener) => {
      if (persistenceSynced) {
        queueMicrotask(() => {
          if (!destroyed) listener()
        })
        return () => {}
      }
      persistenceListeners.add(listener)
      return () => persistenceListeners.delete(listener)
    },
    onPersistenceStatus: (listener) => {
      persistenceStatusListeners.add(listener)
      listener(persistenceStatus)
      return () => persistenceStatusListeners.delete(listener)
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      if (initializationTimer !== undefined) clearTimeout(initializationTimer)
      cancelInitialization?.()
      persistenceListeners.clear()
      persistenceStatusListeners.clear()
      socket?.destroy()
      localAwareness?.destroy()
      if (persistence) {
        void Promise.resolve(persistence.destroy()).catch(() => undefined)
      }
      doc.destroy()
    },
  }
}
