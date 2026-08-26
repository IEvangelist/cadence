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
        match: vi.fn(async () => undefined),
        open: vi.fn(async () => ({
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

  it('deletes only stale caches owned by the current Cadence app base', async () => {
    const listeners = new Map<string, (event: unknown) => void>()
    const remove = vi.fn(async () => true)
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
          'cadence-shell:/:v2',
          'cadence-shell:/cadence/app/:v1',
          'cadence-shell:/cadence/app/:v2',
        ]),
        delete: remove,
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
    execute(context.self, context.caches, vi.fn(), URL)

    let activation: Promise<unknown> | undefined
    listeners.get('activate')?.({
      waitUntil: (promise: Promise<unknown>) => {
        activation = promise
      },
    })
    await activation

    expect(remove).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('cadence-shell:/cadence/app/:v1')
    expect(remove).not.toHaveBeenCalledWith('unrelated-image-cache')
    expect(remove).not.toHaveBeenCalledWith('cadence-shell:/:v2')
  })
})
