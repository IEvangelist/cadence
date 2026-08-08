/**
 * Thin, typed client for the Cadence auth + profile API.
 *
 * Every call sends the auth cookie (`credentials: 'include'`) so the browser
 * session flows to the backend. The fetch implementation and base URL are
 * injectable to keep the client unit-testable without a live server. The base
 * URL defaults to same-origin; set `VITE_API_BASE_URL` to target a separate API
 * origin during local development.
 */

/** The signed-in user's identity summary (mirror of the API's MeResponse). */
export interface Me {
  id: string
  email: string
  displayName: string
  tier: string
}

/** Full profile projection (mirror of the API's ProfileResponse). */
export interface Profile {
  id: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  tier: string
  createdAt: string
  updatedAt: string
}

/** Editable profile fields; omitted (undefined) fields are left unchanged. */
export interface ProfilePatch {
  displayName?: string
  bio?: string
  avatarUrl?: string
}

/** An API call failed with a non-success status. */
export class AuthError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function defaultBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_BASE_URL as string | undefined
  return (configured ?? '').replace(/\/+$/, '')
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const problem = (await response.json()) as { title?: string; errors?: Record<string, string[]> }
    if (problem.errors) {
      const first = Object.values(problem.errors).flat()[0]
      if (first) return first
    }
    if (problem.title) return problem.title
  } catch {
    // Non-JSON body — fall through to the generic message.
  }
  return fallback
}

/** Client for `/api/auth/*` and `/api/profile`. */
export class AuthClient {
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string

  constructor(fetchImpl?: FetchLike, baseUrl?: string) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init))
    this.baseUrl = baseUrl ?? defaultBaseUrl()
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private async postJson(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(this.url(path), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  /** The current session, or null when signed out (401). */
  async me(): Promise<Me | null> {
    const response = await this.fetchImpl(this.url('/api/auth/me'), { credentials: 'include' })
    if (response.status === 401) return null
    if (!response.ok) throw new AuthError(response.status, 'Could not load the current session.')
    return (await response.json()) as Me
  }

  /** Register a local account; the response signs the browser in. */
  async register(email: string, password: string, displayName?: string): Promise<Me> {
    const response = await this.postJson('/api/auth/register', { email, password, displayName })
    if (!response.ok) throw new AuthError(response.status, await readError(response, 'Registration failed.'))
    return (await response.json()) as Me
  }

  /** Sign in with a local account. */
  async login(email: string, password: string): Promise<Me> {
    const response = await this.postJson('/api/auth/login', { email, password })
    if (response.status === 401) throw new AuthError(401, 'Incorrect email or password.')
    if (!response.ok) throw new AuthError(response.status, await readError(response, 'Sign in failed.'))
    return (await response.json()) as Me
  }

  /** Sign out the current session. */
  async logout(): Promise<void> {
    await this.fetchImpl(this.url('/api/auth/logout'), { method: 'POST', credentials: 'include' })
  }

  /** Request a passwordless magic-link email (always resolves; never enumerates). */
  async requestMagicLink(email: string): Promise<void> {
    await this.postJson('/api/auth/magic-link', { email })
  }

  /** The external OAuth providers the server has wired. */
  async providers(): Promise<string[]> {
    const response = await this.fetchImpl(this.url('/api/auth/providers'), { credentials: 'include' })
    if (!response.ok) return []
    const body = (await response.json()) as { providers: string[] }
    return body.providers ?? []
  }

  /** Absolute URL that starts the external OAuth challenge for a provider. */
  externalSignInUrl(provider: string): string {
    return this.url(`/api/auth/external/${encodeURIComponent(provider)}`)
  }

  /** Load the current user's profile. */
  async getProfile(): Promise<Profile> {
    const response = await this.fetchImpl(this.url('/api/profile'), { credentials: 'include' })
    if (!response.ok) throw new AuthError(response.status, 'Could not load your profile.')
    return (await response.json()) as Profile
  }

  /** Update the current user's profile. */
  async updateProfile(patch: ProfilePatch): Promise<Profile> {
    const response = await this.fetchImpl(this.url('/api/profile'), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!response.ok) throw new AuthError(response.status, await readError(response, 'Could not save your profile.'))
    return (await response.json()) as Profile
  }
}
