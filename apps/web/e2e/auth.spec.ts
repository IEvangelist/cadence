import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Route } from '@playwright/test'
import { createBlankProject } from './projectActions'

// Auth + remote-persistence smoke against the production build. There is no
// backend in e2e, so every `/api/**` call is mocked with `page.route`. We prove:
//   1. the anonymous app renders and the sign-in panel is accessible (axe-clean),
//   2. a mocked local sign-in flips the app to the authenticated state, and
//   3. creating + saving a project while signed in POSTs it to the Projects API
//      (i.e. persistence has swapped from local storage to the remote store).
const me = { id: 'u1', email: 'ada@example.com', displayName: 'Ada', tier: 'Free' }

async function mockApi(
  route: Route,
  onCreateProject: () => void,
): Promise<void> {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') return json({}, 401)
  if (path === '/api/auth/providers') return json({ providers: ['GitHub'] })
  if (path === '/api/auth/login' && method === 'POST') return json(me)
  if (path === '/api/projects' && method === 'GET') return json([])
  if (path === '/api/projects' && method === 'POST') {
    onCreateProject()
    const payload = request.postDataJSON() as { id: string; name: string; data: string }
    return json(
      {
        id: payload.id,
        name: payload.name,
        schemaVersion: 1,
        data: payload.data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      201,
    )
  }
  // Anything else the app happens to call: succeed emptily.
  return json({}, method === 'GET' ? 200 : 204)
}

test.describe('auth', () => {
  test('sign-in panel is accessible', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, () => {}))
    await page.goto('/')

    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('dialog', { name: 'Sign in to Cadence' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sign in to Cadence' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })

  test('sign in, create a project, and persist it server-side', async ({ page }) => {
    let projectCreated = false
    await page.route('**/api/**', (route) => mockApi(route, () => (projectCreated = true)))
    await page.goto('/')

    // Open the panel and sign in with the mocked local credentials.
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Password').fill('correct horse battery')
    await page.getByRole('button', { name: 'Sign in' }).click()

    // The header now reflects the signed-in user.
    await expect(page.getByText('Ada')).toBeVisible()

    // Create a fresh project and place a note so there is something to save.
    await createBlankProject(page)
    const grid = page.getByRole('application', { name: /Note grid/ })
    await grid.click({ position: { x: 72, y: 96 } })
    await expect(page.locator('.pr-note')).toHaveCount(1)

    // Saving while signed in must reach the remote Projects API.
    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => r.url().includes('/api/projects') && r.method() === 'POST',
      ),
      page.getByRole('button', { name: 'Save' }).click(),
    ])

    expect(request).toBeTruthy()
    expect(projectCreated).toBe(true)
  })
})
