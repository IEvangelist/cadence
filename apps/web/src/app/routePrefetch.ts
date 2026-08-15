import { secondaryRouteLoaders } from './routeLoaders'

declare global {
  interface Window {
    __CADENCE_ROUTE_PREFETCH_READY__?: boolean
  }
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

async function waitForServiceWorkerControl(
  nav: Navigator,
): Promise<void> {
  if (!('serviceWorker' in nav)) return
  await nav.serviceWorker.ready
  if (nav.serviceWorker.controller) return
  await new Promise<void>((resolve) => {
    nav.serviceWorker.addEventListener('controllerchange', () => resolve(), {
      once: true,
    })
  })
}

/**
 * Warm route chunks only after first paint and service-worker control. The
 * dynamic imports stay split from the synchronous root bundle, while their
 * responses complete only after the worker durably writes its static-asset cache.
 */
export async function prefetchSecondaryRoutes(
  win: Window = window,
  nav: Navigator = navigator,
): Promise<void> {
  if (win.__CADENCE_ROUTE_PREFETCH_READY__) return
  await waitForServiceWorkerControl(nav)
  await waitForIdle(win)
  await Promise.all(secondaryRouteLoaders.map((load) => load()))
  win.__CADENCE_ROUTE_PREFETCH_READY__ = true
  win.dispatchEvent(new Event('cadence:route-prefetch-ready'))
}
