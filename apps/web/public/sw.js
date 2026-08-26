// Offline shell service worker: precache the document shell, then cache same-origin static assets as they are visited.
const CACHE = 'cadence-shell-v1'
const APP_BASE = new URL(self.registration.scope).pathname
const APP_SHELL = [
  APP_BASE,
  `${APP_BASE}index.html`,
  `${APP_BASE}site.webmanifest`,
  `${APP_BASE}favicon.svg`,
]

const STATIC_ASSET_PATTERN = /(?:^\/assets\/|\/(?:favicon|apple-touch-icon|pwa-|maskable-).*\.(?:svg|png|ico)$|\.(?:css|js|svg|png|ico|woff2)$)/i

// Never intercept authenticated API responses or realtime-collaboration traffic.
// Cross-origin transports (Stripe, external API base URLs) are excluded by the origin check above.
// WebSocket upgrades never fire SW fetch events — this guard covers same-origin HTTP paths only.
const NETWORK_ONLY = /^\/(?:api|collab|ws|socket|realtime|sync)(?:\/|$)/i

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  const appPath = url.pathname.startsWith(APP_BASE)
    ? `/${url.pathname.slice(APP_BASE.length)}`
    : url.pathname

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  if (NETWORK_ONLY.test(url.pathname) || NETWORK_ONLY.test(appPath)) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.status !== 404) return response
          return (
            (await caches.match(`${APP_BASE}index.html`)) ||
            (await caches.match(APP_BASE)) ||
            response
          )
        })
        .catch(
          async () =>
            (await caches.match(`${APP_BASE}index.html`)) ||
            caches.match(APP_BASE),
        ),
    )
    return
  }

  if (!STATIC_ASSET_PATTERN.test(url.pathname)) {
    return
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(request).then(async (response) => {
        if (response.status === 200 && response.type === 'basic') {
          try {
            const copy = response.clone()
            const cache = await caches.open(CACHE)
            await cache.put(request, copy)
          } catch {
            // Caching is an optimization; never discard a successful network asset.
          }
        }

        return response
      })
    }),
  )
})
