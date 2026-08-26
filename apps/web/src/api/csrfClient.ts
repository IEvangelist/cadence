export const CSRF_HEADER = 'X-CSRF-TOKEN'
export const CSRF_ENDPOINT = '/api/auth/csrf'
export const INVALID_CSRF_PROBLEM = 'https://cadence.app/problems/invalid-csrf-token'

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class CsrfTokenError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'CsrfTokenError'
    this.status = status
  }
}

/**
 * Fetches and caches the server-issued antiforgery request token, then attaches
 * it to authenticated mutations. Only API-relative paths are accepted and
 * redirects are rejected so the token cannot be forwarded to another origin.
 */
export class CsrfClient {
  private tokenPromise: Promise<string> | null = null
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string

  constructor(fetchImpl: FetchLike, baseUrl: string) {
    this.fetchImpl = fetchImpl
    this.baseUrl = baseUrl
  }

  clear(): void {
    this.tokenPromise = null
  }

  async mutation(path: string, init: RequestInit): Promise<Response> {
    this.assertApiPath(path)
    const tokenPromise = this.getToken()
    const response = await this.send(path, init, await tokenPromise)

    if (!(await isInvalidCsrfResponse(response))) return response

    // A token or auth session can rotate while the SPA is open. Invalidate only
    // the token used by this request (another concurrent request may already have
    // refreshed it), fetch a fresh pair, and retry exactly once.
    if (this.tokenPromise === tokenPromise) this.tokenPromise = null
    return this.send(path, init, await this.getToken())
  }

  private getToken(): Promise<string> {
    if (this.tokenPromise) return this.tokenPromise

    const tokenPromise = this.fetchToken()
    this.tokenPromise = tokenPromise
    void tokenPromise.catch(() => {
      // Do not let one transient acquisition failure poison this singleton.
      // A newer request may already be in flight, so clear by identity only.
      if (this.tokenPromise === tokenPromise) this.tokenPromise = null
    })
    return tokenPromise
  }

  private async fetchToken(): Promise<string> {
    const response = await this.fetchImpl(this.url(CSRF_ENDPOINT), {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
    })
    if (!response.ok) {
      throw new CsrfTokenError(response.status, 'Could not establish a secure request session.')
    }

    const body = (await response.json()) as { requestToken?: unknown }
    if (typeof body.requestToken !== 'string' || body.requestToken.length === 0) {
      throw new CsrfTokenError(response.status, 'The server returned an invalid antiforgery token.')
    }
    return body.requestToken
  }

  private send(path: string, init: RequestInit, token: string): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set(CSRF_HEADER, token)
    return this.fetchImpl(this.url(path), {
      ...init,
      credentials: 'include',
      redirect: 'error',
      headers,
    })
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`
  }

  private assertApiPath(path: string): void {
    if (!path.startsWith('/api/') || path.startsWith('//')) {
      throw new TypeError('Antiforgery tokens may only be sent to API-relative paths.')
    }
  }
}

async function isInvalidCsrfResponse(response: Response): Promise<boolean> {
  if (response.status !== 400) return false
  try {
    const body = (await response.clone().json()) as { type?: unknown }
    return body.type === INVALID_CSRF_PROBLEM
  } catch {
    return false
  }
}
