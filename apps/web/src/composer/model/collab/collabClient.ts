/**
 * Client for the collaboration share-link API (`/api/projects/{id}/shares`).
 *
 * Share links carry a server-issued role (owner/editor/viewer). The role and
 * token are minted and validated server-side; this client only creates, lists,
 * and revokes them for the project owner, and formats the shareable URL.
 */
import type { CollaborationRole } from './useCollaboration'
import { CsrfClient, type FetchLike } from '../../../api/csrfClient'

/** A server-issued share link for a project. */
export interface ShareLink {
  token: string
  ownerId: string
  role: CollaborationRole
  createdAt: string
}

function defaultBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined
  return (configured ?? '').replace(/\/+$/, '')
}

/** Build the shareable URL a collaborator opens to join a project. */
export function shareLinkUrl(origin: string, projectId: string, share: ShareLink): string {
  const base = origin.replace(/\/+$/, '')
  const params = new URLSearchParams({
    collab: projectId,
    owner: share.ownerId,
    role: share.role,
    share: share.token,
  })
  return `${base}/?${params.toString()}`
}

export class CollabShareClient {
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string
  private readonly csrf: CsrfClient

  constructor(fetchImpl?: FetchLike, baseUrl?: string) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.baseUrl = baseUrl ?? defaultBaseUrl()
    this.csrf = new CsrfClient(this.fetchImpl, this.baseUrl)
  }

  private url(projectId: string, suffix = ''): string {
    return `${this.baseUrl}/api/projects/${encodeURIComponent(projectId)}/shares${suffix}`
  }

  async list(projectId: string): Promise<ShareLink[]> {
    const response = await this.fetchImpl(this.url(projectId), { credentials: 'include' })
    if (!response.ok) throw new Error(`Failed to list share links (${response.status}).`)
    return (await response.json()) as ShareLink[]
  }

  async create(projectId: string, role: CollaborationRole): Promise<ShareLink> {
    const response = await this.csrf.mutation(`/api/projects/${encodeURIComponent(projectId)}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!response.ok) throw new Error(`Failed to create share link (${response.status}).`)
    return (await response.json()) as ShareLink
  }

  async revoke(projectId: string, token: string): Promise<void> {
    const response = await this.csrf.mutation(
      `/api/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    )
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to revoke share link (${response.status}).`)
    }
  }
}
