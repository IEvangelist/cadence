import { describe, expect, it, vi } from 'vitest'
import { BillingError, EntitlementsClient } from './entitlementsClient'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const withCsrf = (response: Response) => vi.fn(async (input: RequestInfo | URL) =>
  String(input).endsWith('/api/auth/csrf') ? json({ requestToken: 'test-csrf' }) : response,
)

const freeEntitlements = {
  tier: 'Free',
  watermarkExports: true,
  maxProjects: 10,
  aiGenerationsPerDay: 50,
  advancedFormats: false,
  stemSeparation: false,
  collaborationSeats: 1,
}

describe('EntitlementsClient', () => {
  it('getEntitlements() returns the typed set on 200', async () => {
    const fetchImpl = vi.fn(async () => json(freeEntitlements))
    const client = new EntitlementsClient(fetchImpl, '')

    const result = await client.getEntitlements()

    expect(result).toEqual(freeEntitlements)
    expect(fetchImpl).toHaveBeenCalledWith('/api/entitlements', { credentials: 'include' })
  })

  it('getEntitlements() throws a BillingError on failure', async () => {
    const client = new EntitlementsClient(async () => new Response(null, { status: 401 }), '')
    await expect(client.getEntitlements()).rejects.toBeInstanceOf(BillingError)
  })

  it('startCheckout() posts and returns the redirect URL', async () => {
    const fetchImpl = withCsrf(json({ url: 'https://stripe.test/checkout' }))
    const client = new EntitlementsClient(fetchImpl, '')

    const url = await client.startCheckout()

    expect(url).toBe('https://stripe.test/checkout')
    const [path, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit]
    expect(path).toBe('/api/billing/checkout')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-CSRF-TOKEN')).toBe('test-csrf')
  })

  it('startCheckout() throws a BillingError when unavailable', async () => {
    const client = new EntitlementsClient(withCsrf(new Response(null, { status: 503 })), '')
    await expect(client.startCheckout()).rejects.toMatchObject({ status: 503 })
  })

  it('openPortal() posts and returns the portal URL', async () => {
    const fetchImpl = withCsrf(json({ url: 'https://stripe.test/portal' }))
    const client = new EntitlementsClient(fetchImpl, '')

    const url = await client.openPortal()

    expect(url).toBe('https://stripe.test/portal')
    expect((fetchImpl.mock.calls[1] as unknown as [string])[0]).toBe('/api/billing/portal')
  })

  it('openPortal() maps 402 (paid-only) to a BillingError', async () => {
    const client = new EntitlementsClient(withCsrf(new Response(null, { status: 402 })), '')
    await expect(client.openPortal()).rejects.toMatchObject({ status: 402 })
  })

  it('honours a configured base URL', async () => {
    const fetchImpl = vi.fn(async () => json(freeEntitlements))
    const client = new EntitlementsClient(fetchImpl, 'https://api.example.com')

    await client.getEntitlements()

    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/api/entitlements', {
      credentials: 'include',
    })
  })
})
