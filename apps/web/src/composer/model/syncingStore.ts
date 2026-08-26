/**
 * Offline-first {@link ProjectStore} that routes to the browser-local store when
 * signed out and to the remote (server) store when signed in.
 *
 * The active backend is decided per call from a small mutable auth flag. Normal
 * signed-out work uses the existing local store; signed-in work uses the remote
 * store. A collaboration-scoped view keeps remote authoritative while also
 * maintaining a separately owner-scoped backup, and exposes only that backup
 * when server auth verification is offline.
 */
import { createEmptyProject, type Project } from './project'
import {
  type ProjectStore,
  type StoredProjectMeta,
  type SyncStorage,
} from './storage'
import type { CollabConfig } from './collab/useCollaboration'
import {
  clearOwnerCollaborationData,
  createCollaborationBackupStore,
  retryPendingCollaborationCleanup,
  retryPendingOwnerCollaborationCleanup,
} from './collab/offlineCollabStorage'

/** A tiny mutable holder read on every call to pick the active backend. */
export interface AuthFlag {
  current: boolean
  mode: 'authenticated' | 'offline' | 'anonymous'
  ownerId: string | null
  generation: number
}

export interface CollaborationScopedProjectStore extends ProjectStore {
  forCollaboration(config: CollabConfig): ProjectStore
  loadCollaborationBackup(config: CollabConfig): Promise<Project | null>
  clearOwnerCollaborationData(ownerId: string): Promise<void>
  retryPendingCollaborationData(ownerId?: string): Promise<void>
}

export function supportsCollaborationScope(
  store: ProjectStore,
): store is CollaborationScopedProjectStore {
  return 'forCollaboration' in store &&
    typeof store.forCollaboration === 'function'
}

class CollaborativeProjectStore implements ProjectStore {
  private readonly remote: ProjectStore
  private readonly backup: ProjectStore
  private readonly auth: AuthFlag
  private readonly accountId: string
  private readonly projectId: string

  constructor(
    remote: ProjectStore,
    backup: ProjectStore,
    auth: AuthFlag,
    accountId: string,
    projectId: string,
  ) {
    this.remote = remote
    this.backup = backup
    this.auth = auth
    this.accountId = accountId
    this.projectId = projectId
  }

  private access(): 'authenticated' | 'offline' | 'denied' {
    if (this.auth.ownerId !== this.accountId) return 'denied'
    return this.auth.mode === 'authenticated'
      ? 'authenticated'
      : this.auth.mode === 'offline'
        ? 'offline'
        : 'denied'
  }

  private capture(mode: 'authenticated' | 'offline') {
    return {
      generation: this.auth.generation,
      mode,
      ownerId: this.accountId,
    } as const
  }

  private isCurrent(
    snapshot: ReturnType<CollaborativeProjectStore['capture']>,
  ): boolean {
    return this.auth.generation === snapshot.generation &&
      this.auth.mode === snapshot.mode &&
      this.auth.ownerId === snapshot.ownerId
  }

  private async guardedBackup<T>(
    project: Project,
    snapshot: ReturnType<CollaborativeProjectStore['capture']>,
    backup: () => Promise<T>,
  ): Promise<T | undefined> {
    if (!this.isCurrent(snapshot)) return undefined
    const result = await backup()
    if (!this.isCurrent(snapshot)) {
      // A sign-out/account switch may have purged while hashing the scope.
      // Remove a late write so it cannot resurrect the old owner's backup.
      try {
        await this.backup.remove(project.id)
      } catch {
        // Cleanup retry remains owner-scoped; never expose the stale result.
      }
      return undefined
    }
    return result
  }

  private async backupAfterRemote<T>(
    project: Project,
    snapshot: ReturnType<CollaborativeProjectStore['capture']>,
    remote: () => Promise<T>,
    backup: () => Promise<unknown>,
  ): Promise<T> {
    try {
      const result = await remote()
      if (!this.isCurrent(snapshot)) return result
      try {
        await this.guardedBackup(project, snapshot, backup)
      } catch (error) {
        console.warn(
          'The project was saved remotely, but its offline collaboration backup failed.',
          error,
        )
      }
      return result
    } catch (remoteError) {
      // This is a deliberate backup, not a silent fallback: preserve the local
      // snapshot but propagate the primary remote failure to autosave state.
      try {
        await this.guardedBackup(project, snapshot, backup)
      } catch {
        // The remote error remains authoritative.
      }
      throw remoteError
    }
  }

  private denyWrite(): never {
    throw new Error(
      'Collaborative project persistence requires a matching confirmed or cached offline identity.',
    )
  }

  async save(project: Project): Promise<StoredProjectMeta> {
    const access = this.access()
    if (access === 'offline') {
      const result = await this.guardedBackup(
        project,
        this.capture('offline'),
        () => this.backup.save(project),
      )
      if (result) return result
      return this.denyWrite()
    }
    if (access === 'denied') return this.denyWrite()
    return this.backupAfterRemote(
      project,
      this.capture('authenticated'),
      () => this.remote.save(project),
      () => this.backup.save(project),
    )
  }

  async persist(project: Project): Promise<StoredProjectMeta> {
    const access = this.access()
    if (access === 'offline') {
      const result = await this.guardedBackup(
        project,
        this.capture('offline'),
        () =>
          this.backup.persist
            ? this.backup.persist(project)
            : this.backup.save(project),
      )
      if (result) return result
      return this.denyWrite()
    }
    if (access === 'denied') return this.denyWrite()
    return this.backupAfterRemote(
      project,
      this.capture('authenticated'),
      async () => {
        if (this.remote.persist) return this.remote.persist(project)
        const meta = await this.remote.save(project)
        await this.remote.setLast(project.id)
        return meta
      },
      async () => {
        if (this.backup.persist) await this.backup.persist(project)
        else {
          await this.backup.save(project)
          await this.backup.setLast(project.id)
        }
      },
    )
  }

  load(id: string): Promise<Project | null> {
    const access = this.access()
    if (access === 'offline') return this.backup.load(id)
    if (access === 'authenticated') return this.remote.load(id)
    return Promise.resolve(null)
  }

  list(): Promise<StoredProjectMeta[]> {
    const access = this.access()
    if (access === 'offline') return this.backup.list()
    if (access === 'authenticated') return this.remote.list()
    return Promise.resolve([])
  }

  async remove(id: string): Promise<void> {
    const access = this.access()
    if (access === 'offline') return this.backup.remove(id)
    if (access === 'denied') return this.denyWrite()
    const snapshot = this.capture('authenticated')
    await this.remote.remove(id)
    if (!this.isCurrent(snapshot)) return
    try {
      await this.backup.remove(id)
    } catch (error) {
      console.warn('Could not remove the offline collaboration backup.', error)
    }
  }

  async loadLast(): Promise<Project | null> {
    const access = this.access()
    if (access === 'offline') {
      return (await this.backup.loadLast()) ?? createEmptyProject(this.projectId)
    }
    if (access === 'authenticated') return this.remote.loadLast()
    return Promise.resolve(null)
  }

  async setLast(id: string): Promise<void> {
    const access = this.access()
    if (access === 'offline') return this.backup.setLast(id)
    if (access === 'denied') return this.denyWrite()
    const snapshot = this.capture('authenticated')
    await this.remote.setLast(id)
    if (!this.isCurrent(snapshot)) return
    try {
      await this.backup.setLast(id)
    } catch (error) {
      console.warn('Could not update the offline collaboration backup.', error)
    }
  }
}

/** Routes persistence to local or remote based on the current auth flag. */
export class SyncingProjectStore implements CollaborationScopedProjectStore {
  private readonly local: ProjectStore
  private readonly remote: ProjectStore
  private readonly auth: AuthFlag
  private readonly collaborationStorage?: SyncStorage

  constructor(
    local: ProjectStore,
    remote: ProjectStore,
    auth: AuthFlag,
    collaborationStorage?: SyncStorage,
  ) {
    this.local = local
    this.remote = remote
    this.auth = auth
    this.collaborationStorage = collaborationStorage
  }

  private active(): ProjectStore {
    return this.auth.current ? this.remote : this.local
  }

  save(project: Project): Promise<StoredProjectMeta> {
    return this.active().save(project)
  }

  async persist(project: Project): Promise<StoredProjectMeta> {
    const backend = this.active()
    if (backend.persist) return backend.persist(project)
    const meta = await backend.save(project)
    await backend.setLast(project.id)
    return meta
  }

  load(id: string): Promise<Project | null> {
    return this.active().load(id)
  }

  list(): Promise<StoredProjectMeta[]> {
    return this.active().list()
  }

  remove(id: string): Promise<void> {
    return this.active().remove(id)
  }

  loadLast(): Promise<Project | null> {
    return this.active().loadLast()
  }

  setLast(id: string): Promise<void> {
    return this.active().setLast(id)
  }

  forCollaboration(config: CollabConfig): ProjectStore {
    return new CollaborativeProjectStore(
      this.remote,
      createCollaborationBackupStore(config, this.collaborationStorage),
      this.auth,
      config.user.id,
      config.projectId,
    )
  }

  loadCollaborationBackup(config: CollabConfig): Promise<Project | null> {
    return createCollaborationBackupStore(
      config,
      this.collaborationStorage,
    ).loadLast()
  }

  clearOwnerCollaborationData(ownerId: string): Promise<void> {
    return clearOwnerCollaborationData(ownerId, {
      storage: this.collaborationStorage,
    })
  }

  retryPendingCollaborationData(ownerId?: string): Promise<void> {
    return ownerId
      ? retryPendingOwnerCollaborationCleanup(ownerId, {
          storage: this.collaborationStorage,
        })
      : retryPendingCollaborationCleanup({
          storage: this.collaborationStorage,
        })
  }

  /**
   * Reconcile local projects up to the remote store when the user transitions to
   * signed-in. A project is pushed when the server doesn't have it yet, or when the
   * local copy is strictly newer than the server's (last-writer-wins by
   * `updatedAt`) — so edits made offline to an already-synced project are not lost.
   * Returns the number of projects uploaded.
   */
  async syncLocalToRemote(): Promise<number> {
    const [localMetas, remoteMetas] = await Promise.all([this.local.list(), this.remote.list()])
    const remoteById = new Map(remoteMetas.map((m) => [m.id, m]))
    const remoteLast = remoteMetas.length > 0 ? await this.remote.loadLast() : null

    let synced = 0
    let newestSyncedLocalId: string | null = null
    let syncError: unknown
    let restoreError: unknown
    try {
      for (const meta of localMetas) {
        const remote = remoteById.get(meta.id)
        // Skip only when the server already has a copy that is at least as new.
        if (remote && remote.updatedAt >= meta.updatedAt) continue
        const project = await this.local.load(meta.id)
        if (!project) continue
        // remote.save() upserts (POST, falling back to PUT on conflict).
        await this.remote.save(project)
        newestSyncedLocalId ??= meta.id
        synced += 1
      }
    } catch (error) {
      syncError = error
    } finally {
      try {
        if (remoteLast) {
          await this.remote.setLast(remoteLast.id)
        } else if (newestSyncedLocalId) {
          await this.remote.setLast(newestSyncedLocalId)
        }
      } catch (error) {
        restoreError = error
      }
    }
    if (syncError !== undefined) throw syncError
    if (restoreError !== undefined) throw restoreError
    return synced
  }
}
