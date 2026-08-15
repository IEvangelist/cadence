import { warmRouteLoaders } from './routeLoaders'

declare global {
  interface Window {
    __CADENCE_ROUTE_PREFETCH_READY__?: boolean
    __CADENCE_ROUTE_PREFETCH_CACHE_READY__?: boolean
  }
}

type RouteLoader = () => Promise<unknown>

export interface RoutePrefetchOptions {
  win?: Window
  nav?: Navigator
  loaders?: readonly RouteLoader[]
  /** Pass null for platforms without CacheStorage (for example a desktop webview). */
  cacheStorage?: CacheStorage | null
  fetchImpl?: typeof fetch
  resourceUrls?: () => readonly string[]
}

async function waitForLoadedResources(win: Window): Promise<void> {
  const fonts = (win.document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts) await fonts.ready
  await new Promise<void>((resolve) => {
    const finish = () => setTimeout(resolve, 0)
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => win.requestAnimationFrame(finish))
    } else {
      finish()
    }
  })
}

function waitForIdle(win: Window): Promise<void> {
  return new Promise((resolve) => {
    const requestIdle = (
      win as Window & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => number
      }
    ).requestIdleCallback
    if (typeof requestIdle === 'function') {
      requestIdle(() => resolve(), { timeout: 2_000 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

async function waitForServiceWorkerControl(nav: Navigator): Promise<void> {
  if (!('serviceWorker' in nav)) return
  await nav.serviceWorker.ready
  if (nav.serviceWorker.controller) return
  await new Promise<void>((resolve) => {
    nav.serviceWorker.addEventListener('controllerchange', () => resolve(), {
      once: true,
    })
  })
}

export function loadedStaticAssetUrls(win: Window = window): string[] {
  return [
    ...new Set(
      win.performance
        .getEntriesByType('resource')
        .map((entry) => new URL(entry.name, win.location.href))
        .filter(
          (url) =>
            url.origin === win.location.origin && url.pathname.startsWith('/assets/'),
        )
        .map((url) => url.href),
    ),
  ]
}

export async function ensureAssetsCached(
  urls: readonly string[],
  cacheStorage: CacheStorage,
  fetchImpl: typeof fetch,
): Promise<void> {
  const cache = await cacheStorage.open('cadence-shell-v1')
  for (const url of urls) {
    if (!(await cache.match(url, { ignoreVary: true }))) {
      const response = await fetchImpl(url, { cache: 'force-cache' })
      if (!response.ok) {
        throw new Error(`Could not prefetch route asset (${response.status}): ${url}`)
      }
      await cache.put(url, response)
    }
    if (!(await cache.match(url, { ignoreVary: true }))) {
      throw new Error(`Route asset was not cached: ${url}`)
    }
  }
}

/**
 * Warm route chunks only after first paint and service-worker control. In
 * PWA-capable browsers readiness means every observed same-origin `/assets/*`
 * resource is durably present in CacheStorage, regardless of which worker
 * version currently controls the page. Platforms without CacheStorage still
 * warm the modules but expose cache readiness as false.
 */
export async function prefetchSecondaryRoutes(
  options: RoutePrefetchOptions = {},
): Promise<void> {
  const win = options.win ?? window
  const nav = options.nav ?? navigator
  if (win.__CADENCE_ROUTE_PREFETCH_READY__) return
  win.__CADENCE_ROUTE_PREFETCH_CACHE_READY__ = false

  await waitForServiceWorkerControl(nav)
  await waitForIdle(win)
  await Promise.all((options.loaders ?? warmRouteLoaders).map((load) => load()))
  await waitForLoadedResources(win)

  const cacheStorage =
    options.cacheStorage === undefined
      ? 'caches' in win
        ? win.caches
        : null
      : options.cacheStorage
  if (cacheStorage) {
    await ensureAssetsCached(
      options.resourceUrls?.() ?? loadedStaticAssetUrls(win),
      cacheStorage,
      options.fetchImpl ?? win.fetch.bind(win),
    )
    win.__CADENCE_ROUTE_PREFETCH_CACHE_READY__ = true
  }

  win.__CADENCE_ROUTE_PREFETCH_READY__ = true
  win.dispatchEvent(new Event('cadence:route-prefetch-ready'))
}
