import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Route } from '@playwright/test'

// Pricing page e2e against the production build. There is no backend in e2e, so
// every `/api/**` call is mocked with `page.route`. We prove:
//   1. the in-app pricing page renders, reflects the free tier, and is axe-clean,
//   2. the upgrade CTA starts a Stripe Checkout session via the billing API.
const freeEntitlements = {
  tier: 'Free',
  watermarkExports: true,
  maxProjects: 10,
  aiGenerationsPerDay: 50,
  advancedFormats: false,
  stemSeparation: false,
  collaborationSeats: 1,
}

async function mockApi(route: Route): Promise<void> {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') return json({}, 401)
  if (path === '/api/auth/providers') return json({ providers: [] })
  if (path === '/api/entitlements') return json(freeEntitlements)
  if (path === '/api/billing/checkout' && method === 'POST') {
    // Same-origin URL so the post-checkout redirect stays inside the app.
    return json({ url: new URL('/?checkout=success', url.origin).toString() })
  }
  // Anything else the app happens to call: succeed emptily.
  return json({}, method === 'GET' ? 200 : 204)
}

test.describe('pricing', () => {
  test('pricing page reflects the free tier and is accessible', async ({ page }) => {
    await page.route('**/api/**', mockApi)
    await page.goto('/')

    await page.getByRole('button', { name: 'Pricing' }).click()

    await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Free' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pro' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })

  test('upgrade CTA starts a checkout session', async ({ page }) => {
    await page.route('**/api/**', mockApi)
    await page.goto('/')

    await page.getByRole('button', { name: 'Pricing' }).click()
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible()

    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes('/api/billing/checkout') && r.method() === 'POST',
      ),
      page.getByRole('button', { name: 'Upgrade to Pro' }).click(),
    ])

    expect(request).toBeTruthy()
  })
})
