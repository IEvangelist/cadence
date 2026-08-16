/**
 * Offline-first {@link ProjectStore} that routes to the browser-local store when
 * signed out and to the remote (server) store when signed in.
 *
 * The active backend is decided per call from a small mutable auth flag, so the
 * same store instance can be handed to the composer once and transparently
 * follow the user's sign-in state. When the user signs in, {@link syncLocalToRemote}
 * pushes any local-only projects up to the server so nothing made while offline
 * is lost.
 */
import { type Project } from './project'
import { type ProjectStore, type StoredProjectMeta } from './storage'

/** A tiny mutable holder read on every call to pick the active backend. */
export interface AuthFlag {
  current: boolean
}

/** Routes persistence to local or remote based on the current auth flag. */
export class SyncingProjectStore implements ProjectStore {
  private readonly local: ProjectStore
  private readonly remote: ProjectStore
  private readonly auth: AuthFlag

  constructor(local: ProjectStore, remote: ProjectStore, auth: AuthFlag) {
    this.local = local
    this.remote = remote
    this.auth = auth
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
