import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('service worker static cache failure', () => {
  it('returns a successful network asset when cache.put rejects', async () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const networkResponse = {
      status: 200,
      type: 'basic',
      clone: () => ({ body: 'copy' }),
    }
    const context = {
      self: {
        location: { origin: 'https://cadence.test' },
        registration: { scope: 'https://cadence.test/' },
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
      },
      caches: {
        open: vi.fn(async () => ({
          match: vi.fn(async () => undefined),
          put: vi.fn(async () => Promise.reject(new Error('quota denied'))),
        })),
      },
      fetch: vi.fn(async () => networkResponse),
      URL,
    }
    const source = readFileSync(
      path.resolve(process.cwd(), 'public/sw.js'),
      'utf8',
    )
    const execute = new Function(
      'self',
      'caches',
      'fetch',
      'URL',
      source,
    )
    execute(context.self, context.caches, context.fetch, context.URL)

    let responsePromise: Promise<unknown> | undefined
    listeners.get('fetch')?.({
      request: {
        method: 'GET',
        url: 'https://cadence.test/assets/app.js',
        mode: 'cors',
      },
      respondWith: (promise: Promise<unknown>) => {
        responsePromise = promise
      },
    })

    await expect(responsePromise).resolves.toBe(networkResponse)
    expect(context.fetch).toHaveBeenCalledTimes(1)
  })

  it('migrates legacy caches and serves only the current app cache', async () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const remove = vi.fn(async () => true)
    const currentResponse = { source: 'current' }
    const legacyResponse = { source: 'legacy' }
    const currentCache = {
      match: vi.fn(async () => currentResponse),
      put: vi.fn(),
    }
    const globalMatch = vi.fn(async () => legacyResponse)
    const network = vi.fn()
    const context = {
      self: {
        location: { origin: 'https://cadence.test' },
        registration: { scope: 'https://cadence.test/cadence/app/' },
        clients: { claim: vi.fn(async () => undefined) },
        addEventListener: (type: string, listener: (event: unknown) => void) =>
          listeners.set(type, listener),
      },
      caches: {
        keys: vi.fn(async () => [
          'unrelated-image-cache',
          'cadence-shell-v1',
          'cadence-shell:/:v2',
          'cadence-shell:/cadence/app/:v1',
          'cadence-shell:/cadence/app/:v2',
        ]),
        delete: remove,
        match: globalMatch,
        open: vi.fn(async (name: string) => {
          expect(name).toBe('cadence-shell:/cadence/app/:v2')
          return currentCache
        }),
      },
    }
    const source = readFileSync(
      path.resolve(process.cwd(), 'public/sw.js'),
      'utf8',
    )
    const execute = new Function(
      'self',
      'caches',
      'fetch',
      'URL',
      source,
    )
    execute(context.self, context.caches, network, URL)

    let activation: Promise<unknown> | undefined
    listeners.get('activate')?.({
      waitUntil: (promise: Promise<unknown>) => {
        activation = promise
      },
    })
    await activation

    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith('cadence-shell-v1')
    expect(remove).toHaveBeenCalledWith('cadence-shell:/cadence/app/:v1')
    expect(remove).not.toHaveBeenCalledWith('unrelated-image-cache')
    expect(remove).not.toHaveBeenCalledWith('cadence-shell:/:v2')

    let responsePromise: Promise<unknown> | undefined
    listeners.get('fetch')?.({
      request: {
        method: 'GET',
        url: 'https://cadence.test/cadence/app/assets/app.js',
        mode: 'cors',
      },
      respondWith: (promise: Promise<unknown>) => {
        responsePromise = promise
      },
    })

    await expect(responsePromise).resolves.toBe(currentResponse)
    expect(globalMatch).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  })
})
