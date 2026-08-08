/**
 * Project persistence store.
 *
 * The {@link ProjectStore} interface is intentionally async so a real
 * database/backend can replace the browser-local implementation later without
 * touching callers. The default {@link LocalStorageProjectStore} keeps the MVP
 * self-contained: projects and a small index live in `localStorage` behind a
 * versioned key namespace.
 */
import { type Project } from './project'
import { parseProject, serializeProject } from './persistence'

/** Lightweight listing entry for the "my projects" UI. */
export interface StoredProjectMeta {
  id: string
  name: string
  updatedAt: number
}

export interface ProjectStore {
  /** Insert or update a project; returns its listing metadata. */
  save(project: Project): Promise<StoredProjectMeta>
  /** Load a project by id, or null when it is absent/corrupt. */
  load(id: string): Promise<Project | null>
  /** All stored projects, most-recently-updated first. */
  list(): Promise<StoredProjectMeta[]>
  /** Delete a project by id. */
  remove(id: string): Promise<void>
  /** Load the last opened/saved project (autosave restore), if any. */
  loadLast(): Promise<Project | null>
  /** Record the last opened/saved project id. */
  setLast(id: string): Promise<void>
}

const NS = 'cadence.v1'
const projectKey = (id: string): string => `${NS}.project.${id}`
const INDEX_KEY = `${NS}.index`
const LAST_KEY = `${NS}.last`

/** A minimal synchronous key/value backend (satisfied by `window.localStorage`). */
export interface SyncStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export class LocalStorageProjectStore implements ProjectStore {
  private readonly storage: SyncStorage

  constructor(storage: SyncStorage) {
    this.storage = storage
  }

  private readIndex(): StoredProjectMeta[] {
    const raw = this.storage.getItem(INDEX_KEY)
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as StoredProjectMeta[]) : []
    } catch {
      return []
    }
  }

  private writeIndex(index: StoredProjectMeta[]): void {
    this.storage.setItem(INDEX_KEY, JSON.stringify(index))
  }

  async save(project: Project): Promise<StoredProjectMeta> {
    const meta: StoredProjectMeta = {
      id: project.id,
      name: project.name,
      updatedAt: Date.now(),
    }
    this.storage.setItem(projectKey(project.id), serializeProject(project))
    const index = this.readIndex().filter((m) => m.id !== project.id)
    index.unshift(meta)
    this.writeIndex(index)
    return meta
  }

  async load(id: string): Promise<Project | null> {
    const raw = this.storage.getItem(projectKey(id))
    if (!raw) return null
    try {
      return parseProject(raw)
    } catch {
      return null
    }
  }

  async list(): Promise<StoredProjectMeta[]> {
    return [...this.readIndex()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(projectKey(id))
    this.writeIndex(this.readIndex().filter((m) => m.id !== id))
    if (this.storage.getItem(LAST_KEY) === id) {
      this.storage.removeItem(LAST_KEY)
    }
  }

  async loadLast(): Promise<Project | null> {
    const id = this.storage.getItem(LAST_KEY)
    return id ? this.load(id) : null
  }

  async setLast(id: string): Promise<void> {
    this.storage.setItem(LAST_KEY, id)
  }
}

/** An in-memory {@link SyncStorage}, handy for tests and non-browser contexts. */
export class MemoryStorage implements SyncStorage {
  private readonly map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }
}

/** Build the default browser-backed store, or a memory store when unavailable. */
export function createProjectStore(): ProjectStore {
  const hasLocalStorage =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined'
  const backend: SyncStorage = hasLocalStorage
    ? (globalThis as unknown as { localStorage: SyncStorage }).localStorage
    : new MemoryStorage()
  return new LocalStorageProjectStore(backend)
}
