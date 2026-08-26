import { describe, expect, it, vi } from 'vitest'
import { CollabShareClient, shareLinkUrl, type ShareLink } from './collabClient'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const withCsrf = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
  String(input).endsWith('/api/auth/csrf')
    ? json({ requestToken: 'test-csrf' })
    : handler(input, init),
)

const link = (token: string, role: ShareLink['role']): ShareLink => ({
  token,
  role,
  createdAt: '2024-01-01T00:00:00Z',
})

describe('CollabShareClient', () => {
  it('lists share links for a project', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toBe('/api/projects/p1/shares')
      return json([link('t1', 'editor'), link('t2', 'viewer')])
    })
    const client = new CollabShareClient(fetchImpl, '')
    const links = await client.list('p1')
    expect(links).toHaveLength(2)
    expect(links[0].role).toBe('editor')
  })

  it('creates a share link with the requested role', async () => {
    const fetchImpl = withCsrf(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/projects/p1/shares')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('X-CSRF-TOKEN')).toBe('test-csrf')
      expect(JSON.parse(String(init?.body))).toEqual({ role: 'viewer' })
      return json(link('newtok', 'viewer'), 201)
    })
    const client = new CollabShareClient(fetchImpl, '')
    const created = await client.create('p1', 'viewer')
    expect(created.token).toBe('newtok')
  })

  it('revokes a share link by token', async () => {
    const fetchImpl = withCsrf(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('/api/projects/p1/shares/tok')
      expect(init?.method).toBe('DELETE')
      return new Response(null, { status: 204 })
    })
    const client = new CollabShareClient(fetchImpl, '')
    await expect(client.revoke('p1', 'tok')).resolves.toBeUndefined()
  })

  it('treats a 404 on revoke as success (idempotent)', async () => {
    const client = new CollabShareClient(
      withCsrf(async () => new Response(null, { status: 404 })),
      '',
    )
    await expect(client.revoke('p1', 'gone')).resolves.toBeUndefined()
  })

  it('throws on a server error', async () => {
    const client = new CollabShareClient(async () => new Response(null, { status: 500 }), '')
    await expect(client.list('p1')).rejects.toThrow(/Failed to list/)
  })
})

describe('shareLinkUrl', () => {
  it('formats a joinable URL with collab params', () => {
    const url = shareLinkUrl('https://app.test', 'p1', link('tok', 'viewer'))
    expect(url).toBe('https://app.test/?collab=p1&role=viewer&share=tok')
  })

  it('trims a trailing slash from the origin', () => {
    const url = shareLinkUrl('https://app.test/', 'p1', link('tok', 'editor'))
    expect(url).toBe('https://app.test/?collab=p1&role=editor&share=tok')
  })
})
