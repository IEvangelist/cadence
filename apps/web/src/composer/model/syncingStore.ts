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
   * Push every local project that the server doesn't already have up to the
   * remote store. Called once when the user transitions to signed-in. Returns
   * the number of projects uploaded.
   */
  async syncLocalToRemote(): Promise<number> {
    const [localMetas, remoteMetas] = await Promise.all([this.local.list(), this.remote.list()])
    const remoteIds = new Set(remoteMetas.map((m) => m.id))

    let synced = 0
    for (const meta of localMetas) {
      if (remoteIds.has(meta.id)) continue
      const project = await this.local.load(meta.id)
      if (!project) continue
      await this.remote.save(project)
      synced += 1
    }
    return synced
  }
}
