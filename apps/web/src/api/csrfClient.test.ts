import { describe, expect, it, vi } from 'vitest'
import {
  CSRF_ENDPOINT,
  CSRF_HEADER,
  CsrfClient,
  CsrfTokenError,
  INVALID_CSRF_PROBLEM,
} from './csrfClient'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('CsrfClient', () => {
  it('fetches once, caches, and attaches the token to every mutation', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void init
      return String(input) === CSRF_ENDPOINT
        ? json({ requestToken: 'token-1' })
        : new Response(null, { status: 204 })
    })
    const client = new CsrfClient(fetchImpl, '')

    await client.mutation('/api/projects', { method: 'POST' })
    await client.mutation('/api/projects/p1', { method: 'DELETE' })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[0]).toEqual([
      CSRF_ENDPOINT,
      { credentials: 'include', cache: 'no-store', redirect: 'error' },
    ])
    for (const call of fetchImpl.mock.calls.slice(1)) {
      const init = call[1] as RequestInit
      expect(init.credentials).toBe('include')
      expect(init.redirect).toBe('error')
      expect(new Headers(init.headers).get(CSRF_HEADER)).toBe('token-1')
    }
  })

  it('refreshes and retries exactly once only for the typed rotation response', async () => {
    let tokenCount = 0
    let mutationCount = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === CSRF_ENDPOINT) {
        tokenCount += 1
        return json({ requestToken: `token-${tokenCount}` })
      }
      mutationCount += 1
      if (mutationCount === 1) {
        expect(new Headers(init?.headers).get(CSRF_HEADER)).toBe('token-1')
        return json({ type: INVALID_CSRF_PROBLEM }, 400)
      }
      expect(new Headers(init?.headers).get(CSRF_HEADER)).toBe('token-2')
      return new Response(null, { status: 204 })
    })

    const response = await new CsrfClient(fetchImpl, '').mutation('/api/profile', { method: 'PUT' })

    expect(response.status).toBe(204)
    expect(tokenCount).toBe(2)
    expect(mutationCount).toBe(2)
  })

  it('does not retry an unrelated 400', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === CSRF_ENDPOINT
        ? json({ requestToken: 'token' })
        : json({ type: 'https://example.test/validation' }, 400),
    )

    const response = await new CsrfClient(fetchImpl, '').mutation('/api/profile', { method: 'PUT' })

    expect(response.status).toBe(400)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('fails closed when token acquisition is unauthorized or malformed', async () => {
    const unauthorized = new CsrfClient(
      async () => new Response(null, { status: 401 }),
      '',
    )
    await expect(unauthorized.mutation('/api/projects', { method: 'POST' }))
      .rejects.toMatchObject({ status: 401 })

    const malformed = new CsrfClient(async () => json({ requestToken: '' }), '')
    await expect(malformed.mutation('/api/projects', { method: 'POST' }))
      .rejects.toBeInstanceOf(CsrfTokenError)
  })

  it('never sends a token to an absolute or non-API path', async () => {
    const fetchImpl = vi.fn(async () => json({ requestToken: 'secret' }))
    const client = new CsrfClient(fetchImpl, '')

    await expect(client.mutation('https://evil.example/collect', { method: 'POST' }))
      .rejects.toBeInstanceOf(TypeError)
    await expect(client.mutation('/other', { method: 'POST' })).rejects.toBeInstanceOf(TypeError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
