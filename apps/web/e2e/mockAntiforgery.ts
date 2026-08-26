import type { Route } from '@playwright/test'

export const E2E_CSRF_TOKEN = 'e2e-antiforgery-token'

export async function mockAntiforgery(route: Route): Promise<boolean> {
  if (new URL(route.request().url()).pathname !== '/api/auth/csrf') return false

  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ requestToken: E2E_CSRF_TOKEN }),
  })
  return true
}
