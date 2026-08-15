import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ensureAssetsCached,
  prefetchSecondaryRoutes,
} from './routePrefetch'

function fakeCacheStorage(options: { failPut?: boolean; dropPut?: boolean } = {}) {
  const stored = new Map<string, Response>()
  const cache = {
    match: vi.fn(async (url: string) => stored.get(url)),
    put: vi.fn(async (url: string, response: Response) => {
      if (options.failPut) throw new Error('quota denied')
      if (!options.dropPut) stored.set(url, response)
    }),
  }
  const storage = {
    open: vi.fn(async () => cache),
  } as unknown as CacheStorage
  return { cache, storage, stored }
}

describe('route prefetch', () => {
  beforeEach(() => {
    window.__CADENCE_ROUTE_PREFETCH_READY__ = false
    window.__CADENCE_ROUTE_PREFETCH_CACHE_READY__ = false
  })

  it('publishes readiness only after every route asset is verified in cache', async () => {
    const { cache, storage } = fakeCacheStorage()
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      new Response(String(url), { status: 200 }),
    ) as typeof fetch
    const urls = ['http://localhost/assets/StemsRoute-a.js', 'http://localhost/assets/a.css']

    const oldControllerNavigator = {
      serviceWorker: {
        ready: Promise.resolve({}),
        controller: { scriptURL: '/old-sw.js' },
        addEventListener: vi.fn(),
      },
    } as unknown as Navigator

    await prefetchSecondaryRoutes({
      win: window,
      nav: oldControllerNavigator,
      loaders: [vi.fn(async () => undefined)],
      cacheStorage: storage,
      fetchImpl,
      resourceUrls: () => urls,
    })

    expect(cache.put).toHaveBeenCalledTimes(2)
    expect(cache.match).toHaveBeenCalledTimes(4)
    expect(window.__CADENCE_ROUTE_PREFETCH_CACHE_READY__).toBe(true)
    expect(window.__CADENCE_ROUTE_PREFETCH_READY__).toBe(true)
  })

  it('rejects and leaves readiness false when durable cache writes fail', async () => {
    const { storage } = fakeCacheStorage({ failPut: true })
    const fetchImpl = vi.fn(async () => new Response('asset', { status: 200 })) as typeof fetch

    await expect(
      prefetchSecondaryRoutes({
        win: window,
        nav: navigator,
        loaders: [vi.fn(async () => undefined)],
        cacheStorage: storage,
        fetchImpl,
        resourceUrls: () => ['http://localhost/assets/PricingRoute-a.js'],
      }),
    ).rejects.toThrow('quota denied')

    expect(window.__CADENCE_ROUTE_PREFETCH_CACHE_READY__).toBe(false)
    expect(window.__CADENCE_ROUTE_PREFETCH_READY__).toBe(false)
  })

  it('warms modules without claiming cache readiness on unsupported platforms', async () => {
    const load = vi.fn(async () => undefined)

    await prefetchSecondaryRoutes({
      win: window,
      nav: navigator,
      loaders: [load],
      cacheStorage: null,
    })

    expect(load).toHaveBeenCalledTimes(1)
    expect(window.__CADENCE_ROUTE_PREFETCH_CACHE_READY__).toBe(false)
    expect(window.__CADENCE_ROUTE_PREFETCH_READY__).toBe(true)
  })

  it('rejects when cache verification cannot match an asset after put', async () => {
    const { storage } = fakeCacheStorage({ dropPut: true })
    const fetchImpl = vi.fn(async () => new Response('asset', { status: 200 })) as typeof fetch

    await expect(
      prefetchSecondaryRoutes({
        win: window,
        nav: navigator,
        loaders: [vi.fn(async () => undefined)],
        cacheStorage: storage,
        fetchImpl,
        resourceUrls: () => ['http://localhost/assets/LicensesRoute-a.js'],
      }),
    ).rejects.toThrow('Route asset was not cached')

    expect(window.__CADENCE_ROUTE_PREFETCH_READY__).toBe(false)
  })

  it('refetches only assets missing from the current cache', async () => {
    const { storage, stored } = fakeCacheStorage()
    stored.set('http://localhost/assets/already.js', new Response('cached'))
    const fetchImpl = vi.fn(async () => new Response('new', { status: 200 })) as typeof fetch

    await ensureAssetsCached(
      ['http://localhost/assets/already.js', 'http://localhost/assets/new.js'],
      storage,
      fetchImpl,
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(stored.has('http://localhost/assets/new.js')).toBe(true)
  })
})
