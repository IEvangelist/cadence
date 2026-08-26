import { describe, expect, it, vi } from 'vitest'
import { AuthClient, AuthError } from './authClient'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const withCsrf = (
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
  String(input).endsWith('/api/auth/csrf')
    ? json({ requestToken: 'test-csrf' })
    : handler(input, init),
)

describe('AuthClient', () => {
  it('never submits credentials when backend access is disabled', async () => {
    const fetchImpl = vi.fn()
    const client = new AuthClient(fetchImpl, '', false)

    await expect(client.login('person@example.com', 'secret')).rejects.toMatchObject({
      status: 0,
      message: 'Accounts are unavailable in this static app.',
    })
    await expect(
      client.register('person@example.com', 'secret', 'Person'),
    ).rejects.toMatchObject({ status: 0 })
    await expect(client.requestMagicLink('person@example.com')).rejects.toMatchObject({
      status: 0,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('me() returns the user on 200', async () => {
    const fetchImpl = withCsrf(async () =>
      json({ id: '1', email: 'a@b.com', displayName: 'A', tier: 'Free' }),
    )
    const client = new AuthClient(fetchImpl, '')

    const me = await client.me()

    expect(me).toEqual({ id: '1', email: 'a@b.com', displayName: 'A', tier: 'Free' })
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/me', { credentials: 'include' })
  })

  it('me() returns null on 401', async () => {
    const client = new AuthClient(async () => new Response(null, { status: 401 }), '')
    expect(await client.me()).toBeNull()
  })

  it('me() throws on unexpected error status', async () => {
    const client = new AuthClient(async () => new Response(null, { status: 500 }), '')
    await expect(client.me()).rejects.toBeInstanceOf(AuthError)
  })

  it('login() posts credentials and returns the user', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ id: '1', email: 'a@b.com', displayName: 'A', tier: 'Free' }),
    )
    const client = new AuthClient(fetchImpl, '')

    const me = await client.login('a@b.com', 'pw')

    expect(me.email).toBe('a@b.com')
    const [, init] = fetchImpl.mock.calls[0] as unknown as [unknown, RequestInit?]
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.com', password: 'pw' })
  })

  it('login() maps 401 to a friendly error', async () => {
    const client = new AuthClient(async () => new Response(null, { status: 401 }), '')
    await expect(client.login('a@b.com', 'bad')).rejects.toMatchObject({
      status: 401,
      message: 'Incorrect email or password.',
    })
  })

  it('register() resolves on a neutral 202 without reading a body', async () => {
    // The server returns 202 with no body for both new and existing emails;
    // register() must resolve (not throw, not attempt to parse JSON) and post the
    // full credential payload.
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    const client = new AuthClient(fetchImpl, '')

    await expect(client.register('a@b.com', 'secret12', 'Ada')).resolves.toBeUndefined()

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit?]
    expect(url).toBe('/api/auth/register')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      email: 'a@b.com',
      password: 'secret12',
      displayName: 'Ada',
    })
  })

  it('register() surfaces the first validation error', async () => {
    const client = new AuthClient(
      async () => json({ errors: { identity: ['Passwords must be 8 characters.'] } }, 400),
      '',
    )
    await expect(client.register('a@b.com', 'x')).rejects.toMatchObject({
      message: 'Passwords must be 8 characters.',
    })
  })

  it('requestMagicLink() posts the email', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }))
    const client = new AuthClient(fetchImpl, '')

    await client.requestMagicLink('a@b.com')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit?]
    expect(url).toBe('/api/auth/magic-link')
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'a@b.com' })
  })

  it('providers() returns the list, or [] on error', async () => {
    const ok = new AuthClient(async () => json({ providers: ['GitHub', 'Google'] }), '')
    expect(await ok.providers()).toEqual(['GitHub', 'Google'])

    const bad = new AuthClient(async () => new Response(null, { status: 500 }), '')
    expect(await bad.providers()).toEqual([])
  })

  it('externalSignInUrl() builds an encoded challenge URL', () => {
    const client = new AuthClient(async () => new Response(null), 'https://api.test')
    expect(client.externalSignInUrl('Micro soft')).toBe(
      'https://api.test/api/auth/external/Micro%20soft',
    )
  })

  it('updateProfile() PUTs the patch and returns the profile', async () => {
    const fetchImpl = withCsrf(async () =>
      json({
        id: '1',
        displayName: 'New',
        bio: null,
        avatarUrl: null,
        tier: 'Free',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      }),
    )
    const client = new AuthClient(fetchImpl, '')

    const profile = await client.updateProfile({ displayName: 'New' })

    expect(profile.displayName).toBe('New')
    const [url, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit?]
    expect(url).toBe('/api/profile')
    expect(init?.method).toBe('PUT')
    expect(new Headers(init?.headers).get('X-CSRF-TOKEN')).toBe('test-csrf')
  })

  it('getProfile() throws on error', async () => {
    const client = new AuthClient(async () => new Response(null, { status: 500 }), '')
    await expect(client.getProfile()).rejects.toBeInstanceOf(AuthError)
  })
})
