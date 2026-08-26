/**
 * Thin, typed client for the Cadence stem-separation API (`/api/stems`).
 *
 * Mirrors the conventions of `billing/entitlementsClient.ts`: the fetch
 * implementation and base URL are injectable so the client is unit-testable
 * without a live server, and every call sends the auth cookie
 * (`credentials: 'include'`). The server is authoritative for entitlements and
 * ownership — this client only uploads a mix, reads job status, and resolves the
 * owner-scoped download URLs the API returns.
 */
import { CsrfClient, type FetchLike } from '../api/csrfClient'
import {
  captureAuthMutation,
  type AuthMutationContextFactory,
} from '../auth/authMutationCoordinator'

/** Lifecycle states a separation job moves through, mirroring the server enum. */
export type StemJobStatus = 'Queued' | 'Processing' | 'Completed' | 'Failed'

/** One separated stem with its owner-scoped, server-relative download URL. */
export interface Stem {
  label: string
  sizeBytes: number
  url: string
}

/** A separation job and, once completed, its labeled stems. */
export interface StemJob {
  id: string
  status: StemJobStatus
  originalFileName: string
  contentType: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  errorMessage: string | null
  stems: Stem[]
}

/** A lightweight job listing entry (no stems). */
export interface StemJobSummary {
  id: string
  status: StemJobStatus
  originalFileName: string
  sizeBytes: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

/** A stems API call failed with a non-success status. */
export class StemsError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'StemsError'
    this.status = status
  }
}

function defaultBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined
  return (configured ?? '').replace(/\/+$/, '')
}

/** Client for `/api/stems/jobs` upload, status, listing, and downloads. */
export class StemsClient {
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string
  private readonly csrf: CsrfClient
  private readonly mutationContext?: AuthMutationContextFactory

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

  /**
   * Upload a mix and queue a separation job. The raw file is the request body
   * (no multipart), matching the server's raw-body endpoint. A 402 surfaces as a
   * {@link StemsError} so the caller can show the upgrade CTA.
   */
  async createJob(file: File): Promise<StemJob> {
    const name = encodeURIComponent(file.name || 'mix')
    const response = await this.csrf.mutation(`/api/stems/jobs?name=${name}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }, this.mutationContext?.())
    if (!response.ok) {
      throw new StemsError(response.status, uploadErrorMessage(response.status))
    }
    return (await response.json()) as StemJob
  }

  /** Read a single owner-scoped job (404 -> {@link StemsError}). */
  async getJob(id: string): Promise<StemJob> {
    const response = await this.fetchImpl(this.url(`/api/stems/jobs/${encodeURIComponent(id)}`), {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new StemsError(response.status, 'We couldn’t load that job.')
    }
    return (await response.json()) as StemJob
  }

  /** List the caller's jobs, newest first (as ordered by the server). */
  async listJobs(): Promise<StemJobSummary[]> {
    const response = await this.fetchImpl(this.url('/api/stems/jobs'), {
      credentials: 'include',
    })
    if (!response.ok) {
      throw new StemsError(response.status, 'We couldn’t load your jobs.')
    }
    return (await response.json()) as StemJobSummary[]
  }

  /** Resolve a stem's server-relative URL to an absolute one for the base URL. */
  downloadUrl(stem: Stem): string {
    return `${this.baseUrl}${stem.url}`
  }
}

function uploadErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Please sign in to separate stems.'
    case 402:
      return 'Stem separation is a Pro feature.'
    case 413:
      return 'That file is too large or too long.'
    case 415:
      return 'That audio format isn’t supported.'
    default:
      return 'We couldn’t start that separation. Please try again.'
  }
}
