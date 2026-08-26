import { expect, test } from '@playwright/test'

const APP = '/cadence/app/'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cadence.v1.onboarding.seen', '1')
  })
})

test('keeps the Astro site and boots the composer from the Pages app route', async ({
  page,
}) => {
  await page.goto('/cadence/', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Make the idea land.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open web composer' })).toHaveAttribute(
    'href',
    APP,
  )
  await expect(page.getByRole('link', { name: 'Download', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Docs', exact: true }).first()).toBeVisible()

  const badAssets: string[] = []
  page.on('response', (response) => {
    if (
      response.url().includes('/cadence/app/assets/') &&
      response.status() >= 400
    ) {
      badAssets.push(`${response.status()} ${response.url()}`)
    }
  })
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Cadence' })).toBeVisible()

  const assetPaths = await page.locator('script[src], link[href]').evaluateAll((elements) =>
    elements
      .map((element) => {
        const value = element.getAttribute('src') ?? element.getAttribute('href')
        return value ? new URL(value, location.href).pathname : ''
      })
      .filter((path) => path.includes('/assets/')),
  )
  expect(assetPaths.length).toBeGreaterThan(0)
  expect(assetPaths.every((path) => path.startsWith('/cadence/app/assets/'))).toBe(true)
  expect(badAssets).toEqual([])
  await expect(page.locator('.studio-identity__mark')).toHaveAttribute(
    'src',
    '/cadence/app/favicon.svg',
  )

  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestUrl).toBe('/cadence/app/site.webmanifest')
  const manifest = await page.request.get(manifestUrl!)
  expect(manifest.ok()).toBe(true)
  expect(await manifest.json()).toMatchObject({ start_url: './', scope: './' })
})

test('keeps the static build local-only without API or server forms', async ({
  page,
}) => {
  const apiRequests: string[] = []
  const sockets: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      apiRequests.push(request.url())
    }
  })
  page.on('websocket', (socket) => sockets.push(socket.url()))

  await page.goto(`${APP}?collab=room-1&role=editor&share=token`)
  await expect(page.getByText(/Local-only mode/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0)

  await page.goto('/cadence/app/profile')
  await expect(page.getByRole('heading', { name: 'Accounts unavailable' })).toBeVisible()
  await expect(page.locator('form')).toHaveCount(0)

  await page.goto('/cadence/app/pricing')
  await expect(page.getByRole('heading', { name: 'Plans are not connected' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Upgrade|billing/i })).toHaveCount(0)

  await page.goto('/cadence/app/stems')
  await expect(page.getByRole('heading', { name: 'Stems need a Cadence backend' })).toBeVisible()
  await expect(page.locator('input[type="file"]')).toHaveCount(0)
  expect(apiRequests).toEqual([])
  expect(sockets).toEqual([])
})

test('routes base-aware AI plan links inside the Pages app', async ({ page }) => {
  await page.goto(APP)
  await page.getByRole('button', { name: /Demo pattern/ }).click()
  const inspector = page.getByRole('button', { name: 'Inspector' })
  if ((await inspector.getAttribute('aria-expanded')) === 'false') {
    await inspector.click()
  }
  await page.getByRole('tab', { name: 'AI' }).click()
  await page.getByRole('tab', { name: 'Advanced' }).click()
  await page.getByRole('radio', { name: /Style transfer/ }).click()

  const plans = page.getByRole('link', { name: 'View plans' })
  await expect(plans).toHaveAttribute('href', '/cadence/app/pricing')
  await plans.click()
  await expect(page).toHaveURL(/\/cadence\/app\/pricing$/)
  await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
})

test('preserves query and hash routes across direct loads and the 404 fallback', async ({
  page,
}) => {
  const route =
    '/cadence/app/stems?collab=room-1&role=viewer&share=token#project=encoded'
  await page.goto(route)
  await expect(page.getByRole('heading', { name: 'Stem separation' })).toBeVisible()
  expect(`${locationPath(page.url())}`).toBe(route)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Stem separation' })).toBeVisible()

  const missing =
    '/cadence/app/not-a-route?collab=room-2&role=viewer&share=token#project=encoded'
  await page.goto(missing)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  expect(locationPath(page.url())).toBe(missing)
})

function locationPath(value: string): string {
  const url = new URL(value)
  return `${url.pathname}${url.search}${url.hash}`
}

test('serves a prefetched route from the app-scoped service worker while offline', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto(APP)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await page.waitForFunction(
    () =>
      (window as Window & { __CADENCE_ROUTE_PREFETCH_READY__?: boolean })
        .__CADENCE_ROUTE_PREFETCH_READY__ === true,
  )

  try {
    await page.context().setOffline(true)
    await page.goto('/cadence/app/pricing')
    await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
  } finally {
    await page.context().setOffline(false)
  }
})
