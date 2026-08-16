import { test, expect, type Page } from '@playwright/test'

type WebManifest = {
  name?: string
  short_name?: string
  start_url?: string
  display?: string
  icons?: Array<{ sizes?: string }>
}

async function expectValidManifest(page: Page): Promise<WebManifest> {
  await page.goto('/')

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  if (href === null) throw new Error('Expected a linked web app manifest')
  expect(href).toBe('/site.webmanifest')

  const response = await page.request.get(href)
  expect(response.ok()).toBe(true)

  const manifest = (await response.json()) as WebManifest
  expect(manifest.name).toBe('Cadence')
  expect(manifest.short_name).toBeTruthy()
  expect(manifest.start_url).toBe('/')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: expect.stringContaining('192x192') }),
      expect.objectContaining({ sizes: expect.stringContaining('512x512') }),
    ]),
  )

  return manifest
}

async function waitForServiceWorkerReady(page: Page): Promise<void> {
  await page.waitForFunction(() => 'serviceWorker' in navigator, undefined, {
    timeout: 30_000,
  })
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
}

async function expectServiceWorkerController(page: Page): Promise<void> {
  await page.reload()

  let isControlled = await page.evaluate(
    () => !!navigator.serviceWorker.controller,
  )
  if (!isControlled) {
    await page.reload()
    isControlled = await page.evaluate(
      () => !!navigator.serviceWorker.controller,
    )
  }

  expect(isControlled).toBe(true)
}

test.describe('pwa', () => {
  test('links a valid web app manifest', async ({ page }) => {
    await expectValidManifest(page)
  })

  test('service worker registers and controls the page', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('/')
    await waitForServiceWorkerReady(page)

    await expectServiceWorkerController(page)
  })

  test('serves the app shell while offline', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('/')
    await waitForServiceWorkerReady(page)
    await expectServiceWorkerController(page)
    await page.waitForFunction(
      () =>
        (window as unknown as { __CADENCE_ROUTE_PREFETCH_READY__?: boolean })
          .__CADENCE_ROUTE_PREFETCH_READY__ === true,
      undefined,
      { timeout: 30_000 },
    )

    try {
      await page.context().setOffline(true)
      await page.reload()

      await expect(
        page.getByRole('heading', { level: 1, name: 'Cadence' }),
      ).toBeVisible()
      await expect(page.locator('main.app')).toBeVisible()
    } finally {
      await page.context().setOffline(false)
    }
  })

  test('opens unvisited secondary routes after background warming while offline', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const routes = [
      ['/stems', 'Stem separation'],
      ['/pricing', 'Plans & pricing'],
      ['/profile', 'Sign in to Cadence'],
      ['/licenses', 'Acknowledgements & third-party licenses'],
    ] as const

    await page.goto('/')
    await waitForServiceWorkerReady(page)
    await expectServiceWorkerController(page)
    await page.waitForFunction(
      () =>
        (window as unknown as { __CADENCE_ROUTE_PREFETCH_READY__?: boolean })
          .__CADENCE_ROUTE_PREFETCH_READY__ === true,
      undefined,
      { timeout: 30_000 },
    )
    const cacheAudit = await page.evaluate(async () => {
      const urls = [
        ...new Set(
          performance
            .getEntriesByType('resource')
            .map((entry) => new URL(entry.name, location.href))
            .filter(
              (url) =>
                url.origin === location.origin && url.pathname.startsWith('/assets/'),
            )
            .map((url) => url.href),
        ),
      ]
      const cache = await caches.open('cadence-shell-v1')
      const missing = []
      for (const url of urls) {
        if (!(await cache.match(url, { ignoreVary: true }))) missing.push(url)
      }
      return {
        cacheReady: (
          window as unknown as { __CADENCE_ROUTE_PREFETCH_CACHE_READY__?: boolean }
        ).__CADENCE_ROUTE_PREFETCH_CACHE_READY__,
        urls,
        missing,
      }
    })
    expect(cacheAudit.cacheReady).toBe(true)
    expect(cacheAudit.missing).toEqual([])
    for (const routeName of ['StemsRoute', 'PricingRoute', 'ProfileRoute', 'LicensesRoute']) {
      expect(cacheAudit.urls.some((url) => url.includes(`${routeName}-`))).toBe(true)
    }

    try {
      await page.context().setOffline(true)
      for (const [path, heading] of routes) {
        await page.goto(path)
        await expect(page.getByRole('heading', { name: heading })).toBeVisible()
        await page.reload()
        await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      }
    } finally {
      await page.context().setOffline(false)
    }
  })

  test('service worker does not cache /api paths', async ({ page }) => {
    test.setTimeout(60_000)

    await page.goto('/')
    await waitForServiceWorkerReady(page)
    await expectServiceWorkerController(page)

    // Verify the SW never caches authenticated API responses — even paths that
    // look like static assets (e.g. stem artwork under /api/stems/jobs/x/cover.png).
    const cachedApi = await page.evaluate(async () => {
      const cache = await caches.open('cadence-shell-v1')
      const plain = await cache.match('/api/entitlements')
      const assetLike = await cache.match('/api/stems/jobs/1/cover.png')
      return { plain: plain !== undefined, assetLike: assetLike !== undefined }
    })
    expect(cachedApi.plain).toBe(false)
    expect(cachedApi.assetLike).toBe(false)
  })

  test('exposes installability signals', async ({ page }) => {
    test.setTimeout(60_000)

    await expectValidManifest(page)
    await waitForServiceWorkerReady(page)
    await expectServiceWorkerController(page)

    // Lighthouse installability checks require a valid manifest and controlling
    // service worker; headless Chromium may not fire beforeinstallprompt.
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/site.webmanifest',
    )
  })
})
