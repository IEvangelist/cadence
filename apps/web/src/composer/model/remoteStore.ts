/**
 * Remote {@link ProjectStore} backed by the Cadence Projects API.
 *
 * It implements the exact same async contract as the browser-local store, so the
 * composer's persistence seam is swapped without any change to callers. Projects
 * are serialized with the shared {@link serializeProject}/{@link parseProject}
 * helpers, so the versioned document shape round-trips through the server's
 * opaque `data` column unchanged.
 */
import { type Project } from './project'
import { parseProject, serializeProject } from './persistence'
import { type ProjectStore, type StoredProjectMeta } from './storage'
import { CsrfClient, type FetchLike } from '../../api/csrfClient'
import {
  captureAuthMutation,
  type AuthMutationContextFactory,
} from '../../auth/authMutationCoordinator'

interface ProjectSummaryDto {
  id: string
  name: string
  schemaVersion: number
  createdAt: string
  updatedAt: string
}

interface ProjectDetailDto extends ProjectSummaryDto {
  data: string
}

function defaultBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined
  return (configured ?? '').replace(/\/+$/, '')
}

const toMeta = (dto: ProjectSummaryDto): StoredProjectMeta => ({
  id: dto.id,
  name: dto.name,
  updatedAt: Date.parse(dto.updatedAt) || Date.now(),
})

/** {@link ProjectStore} that persists to `/api/projects` for the signed-in user. */
export class RemoteProjectStore implements ProjectStore {
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string
  private readonly csrf: CsrfClient
  private readonly mutationContext?: AuthMutationContextFactory
  private lastId: string | null = null

  constructor(
    fetchImpl?: FetchLike,
    baseUrl?: string,
    mutationContext?: AuthMutationContextFactory,
  ) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.baseUrl = baseUrl ?? defaultBaseUrl()
    this.csrf = new CsrfClient(this.fetchImpl, this.baseUrl)
    this.mutationContext =
      mutationContext ?? (fetchImpl === undefined ? captureAuthMutation : undefined)
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  async save(project: Project): Promise<StoredProjectMeta> {
    const payload = {
      id: project.id,
      name: project.name,
      schemaVersion: project.schemaVersion,
      data: serializeProject(project),
    }

    // Upsert: try to create, and fall back to update when the id already exists.
    const context = this.mutationContext?.()
    let response = await this.csrf.mutation('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, context)

    if (response.status === 409) {
      response = await this.csrf.mutation(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, context)
    }

    if (!response.ok) {
      throw new Error(`Failed to save project (${response.status}).`)
    }

    const dto = (await response.json()) as ProjectDetailDto
    this.lastId = dto.id
    return toMeta(dto)
  }

  async persist(project: Project): Promise<StoredProjectMeta> {
    const meta = await this.save(project)
    await this.setLast(project.id)
    return meta
  }

  async load(id: string): Promise<Project | null> {
    const response = await this.fetchImpl(this.url(`/api/projects/${encodeURIComponent(id)}`), {
      credentials: 'include',
    })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Failed to load project (${response.status}).`)

    const dto = (await response.json()) as ProjectDetailDto
    try {
      return parseProject(dto.data)
    } catch {
      return null
    }
  }

  async list(): Promise<StoredProjectMeta[]> {
    const response = await this.fetchImpl(this.url('/api/projects'), { credentials: 'include' })
    if (!response.ok) throw new Error(`Failed to list projects (${response.status}).`)
    const dtos = (await response.json()) as ProjectSummaryDto[]
    return dtos.map(toMeta)
  }

  async remove(id: string): Promise<void> {
    const response = await this.csrf.mutation(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }, this.mutationContext?.())
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete project (${response.status}).`)
    }
    if (this.lastId === id) this.lastId = null
  }

  async loadLast(): Promise<Project | null> {
    if (this.lastId) {
      const byId = await this.load(this.lastId)
      if (byId) return byId
    }
    // Fall back to the most recently updated project (the server lists newest first).
    const list = await this.list()
    return list.length > 0 ? this.load(list[0].id) : null
  }

  async setLast(id: string): Promise<void> {
    this.lastId = id
  }
}
