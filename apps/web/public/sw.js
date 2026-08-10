// Offline shell service worker: precache the document shell, then cache same-origin static assets as they are visited.
const CACHE = 'cadence-shell-v1'
const APP_SHELL = ['/', '/index.html', '/site.webmanifest', '/favicon.svg']

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

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }

  if (NETWORK_ONLY.test(url.pathname)) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/index.html')) || caches.match('/')),
    )
    return
  }

  if (!STATIC_ASSET_PATTERN.test(url.pathname)) {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(request).then((response) => {
        if (response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }

        return response
      })
    }),
  )
})
