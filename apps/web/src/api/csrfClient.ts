import {
  EXPECTED_OWNER_HEADER,
  type AuthMutationContext,
} from '../auth/authMutationCoordinator'

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
  private tokenCacheKey: string | null = null
  private readonly fetchImpl: FetchLike
  private readonly baseUrl: string

  constructor(fetchImpl: FetchLike, baseUrl: string) {
    this.fetchImpl = fetchImpl
    this.baseUrl = baseUrl
  }

  clear(): void {
    this.tokenPromise = null
    this.tokenCacheKey = null
  }

  async mutation(
    path: string,
    init: RequestInit,
    context?: AuthMutationContext,
  ): Promise<Response> {
    this.assertApiPath(path)
    this.ensureCurrent(context)
    if (context && this.tokenCacheKey !== context.cacheKey) this.clear()
    if (context) this.tokenCacheKey = context.cacheKey
    const guardedInit = {
      ...init,
      signal: combineSignals(init.signal, context?.signal),
    }
    const tokenPromise = this.getToken(context)
    const token = await tokenPromise
    this.ensureCurrent(context)
    const response = await this.send(path, guardedInit, token, context)

    if (!(await isInvalidCsrfResponse(response))) return response

    // A token or auth session can rotate while the SPA is open. Invalidate only
    // the token used by this request (another concurrent request may already have
    // refreshed it), fetch a fresh pair, and retry exactly once.
    if (this.tokenPromise === tokenPromise) this.tokenPromise = null
    this.ensureCurrent(context)
    const refreshed = await this.getToken(context)
    this.ensureCurrent(context)
    return this.send(path, guardedInit, refreshed, context)
  }

  private getToken(context?: AuthMutationContext): Promise<string> {
    if (this.tokenPromise) return this.tokenPromise

    const tokenPromise = this.fetchToken(context?.signal)
    this.tokenPromise = tokenPromise
    void tokenPromise.catch(() => {
      // Do not let one transient acquisition failure poison this singleton.
      // A newer request may already be in flight, so clear by identity only.
      if (this.tokenPromise === tokenPromise) this.tokenPromise = null
    })
    return tokenPromise
  }

  private async fetchToken(signal?: AbortSignal): Promise<string> {
    const response = await this.fetchImpl(this.url(CSRF_ENDPOINT), {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      ...(signal ? { signal } : {}),
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

  private send(
    path: string,
    init: RequestInit,
    token: string,
    context?: AuthMutationContext,
  ): Promise<Response> {
    this.ensureCurrent(context)
    const headers = new Headers(init.headers)
    headers.set(CSRF_HEADER, token)
    if (context) headers.set(EXPECTED_OWNER_HEADER, context.ownerId)
    return this.fetchImpl(this.url(path), {
      ...init,
      credentials: 'include',
      redirect: 'error',
      headers,
    })
  }

  private ensureCurrent(context?: AuthMutationContext): void {
    if (context && !context.isCurrent()) {
      throw new DOMException('Authenticated mutation was invalidated.', 'AbortError')
    }
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

function combineSignals(
  requestSignal?: AbortSignal | null,
  authSignal?: AbortSignal,
): AbortSignal | undefined {
  const signals = [requestSignal, authSignal].filter(
    (signal): signal is AbortSignal => signal !== undefined && signal !== null,
  )
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  return AbortSignal.any(signals)
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
