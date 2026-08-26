import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Route } from '@playwright/test'
import { createBlankProject } from './projectActions'
import { E2E_CSRF_TOKEN, mockAntiforgery } from './mockAntiforgery'

// Auth + remote-persistence smoke against the production build. There is no
// backend in e2e, so every `/api/**` call is mocked with `page.route`. We prove:
//   1. the anonymous app renders and the sign-in panel is accessible (axe-clean),
//   2. a mocked local sign-in flips the app to the authenticated state, and
//   3. creating + saving a project while signed in POSTs it to the Projects API
//      (i.e. persistence has swapped from local storage to the remote store).
const me = { id: 'u1', email: 'ada@example.com', displayName: 'Ada', tier: 'Free' }
const profile = {
  id: 'u1',
  displayName: 'Ada',
  bio: 'Composer',
  avatarUrl: null,
  tier: 'Free',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
}

async function mockApi(
  route: Route,
  onCreateProject: () => void,
): Promise<void> {
  if (await mockAntiforgery(route)) return
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
    expect(request.headers()['x-csrf-token']).toBe(E2E_CSRF_TOKEN)
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
    await page
      .getByRole('dialog', { name: 'Sign in to Cadence' })
      .getByRole('button', { name: 'Sign in' })
      .click()

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

  test('guards a direct profile route without flashing Studio and closes to root', async ({
    page,
  }) => {
    let releaseSession!: () => void
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve
    })
    await page.route('**/api/auth/me', async (route) => {
      await sessionGate
      await route.fulfill({ status: 401, body: '{}' })
    })
    await page.route('**/api/auth/providers', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ providers: ['GitHub'] }),
      }),
    )

    await page.goto('/profile')
    await expect(page.locator('.route-page-skeleton')).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('#composer-main')).toHaveCount(0)

    releaseSession()
    await expect(page.getByRole('dialog', { name: 'Sign in to Cadence' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/$/)
  })

  test('returns local sign-in to the guarded profile route', async ({ page }) => {
    let authenticated = false
    await page.route('**/api/**', async (route) => {
      if (await mockAntiforgery(route)) return
      const request = route.request()
      const path = new URL(request.url()).pathname
      const method = request.method()
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })

      if (path === '/api/auth/me') return authenticated ? json(me) : json({}, 401)
      if (path === '/api/auth/providers') return json({ providers: ['GitHub'] })
      if (path === '/api/auth/login' && method === 'POST') {
        authenticated = true
        return json(me)
      }
      if (path === '/api/profile') return json(profile)
      return json({}, method === 'GET' ? 200 : 204)
    })

    await page.goto('/profile?collab=p1#project=x')
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Password').fill('correct horse battery')
    await page
      .getByRole('dialog', { name: 'Sign in to Cadence' })
      .getByRole('button', { name: 'Sign in' })
      .click()

    await expect(page).toHaveURL(/\/profile\?collab=p1#project=x$/)
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeFocused()
    await expect(page.getByLabel('Display name')).toHaveValue('Ada')
  })

  test('restores launcher focus when the sign-in Dialog closes', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, () => {}))
    await page.goto('/')
    const launcher = page.getByRole('button', { name: 'Sign in' })

    await launcher.click()
    await page.keyboard.press('Escape')

    await expect(launcher).toBeFocused()
  })

  test('stores a safe profile target before external provider navigation', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, () => {}))
    await page.goto('/profile?collab=p1#project=x')
    const provider = page.getByRole('link', { name: 'GitHub' })
    await provider.evaluate((link) => {
      link.addEventListener('click', (event) => event.preventDefault(), { once: true })
    })
    await provider.click()

    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem('cadence.v1.auth.return-target')),
      )
      .toBe('/profile?collab=p1#project=x')
  })

  test('consumes a success callback and preserves collaboration inputs', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(me),
        })
      }
      if (path === '/api/auth/providers') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ providers: [] }),
        })
      }
      if (path === '/api/profile') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(profile),
        })
      }
      return route.fulfill({ status: 204 })
    })
    await page.goto('/')
    await page.evaluate(() =>
      sessionStorage.setItem('cadence.v1.auth.return-target', '/profile'),
    )

    await page.goto('/?auth=success&collab=p1&role=editor&share=t#project=x')

    await expect(page).toHaveURL(
      /\/profile\?collab=p1&role=editor&share=t#project=x$/,
    )
    await expect(page.getByText('You’re signed in.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeFocused()
  })

  test('shows neutral link-required guidance and preserves anonymous callback inputs', async ({
    page,
  }) => {
    let authenticated = false
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      const method = request.method()
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      if (path === '/api/auth/me') return authenticated ? json(me) : json({}, 401)
      if (path === '/api/auth/providers') return json({ providers: [] })
      if (path === '/api/auth/login' && method === 'POST') {
        authenticated = true
        return json(me)
      }
      if (path === '/api/profile') return json(profile)
      return json({}, method === 'GET' ? 200 : 204)
    })
    await page.goto('/')
    const returnTarget = '/profile?collab=p1&role=editor&share=t#project=x'
    await page.evaluate((target) => {
      sessionStorage.setItem('cadence.v1.auth.return-target', target)
    }, returnTarget)

    await page.goto('/?auth=error&reason=link-required')

    await expect(page.getByRole('alert')).toContainText(
      'Sign in with your existing method first',
    )
    await expect(page).toHaveURL(/\/$/)
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem('cadence.v1.auth.return-target')),
      )
      .toBe(returnTarget)
    await expect(
      page.locator('[data-interaction="auth.panel.toggle"]'),
    ).toBeVisible()

    await page.locator('[data-interaction="auth.panel.toggle"]').click()
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Password').fill('correct horse battery')
    await page
      .getByRole('dialog', { name: 'Sign in to Cadence' })
      .getByRole('button', { name: 'Sign in' })
      .click()

    await expect(page).toHaveURL(
      /\/profile\?collab=p1&role=editor&share=t#project=x$/,
    )
    await expect(page.getByLabel('Display name')).toHaveValue('Ada')
    await expect(page.getByText(/Sign in with your existing method first/)).toHaveCount(0)
  })

  test('keeps registration and magic-link requests neutral', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === '/api/auth/me') return route.fulfill({ status: 401, body: '{}' })
      if (path === '/api/auth/providers') {
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ providers: [] }),
        })
      }
      if (
        (path === '/api/auth/register' || path === '/api/auth/magic-link') &&
        request.method() === 'POST'
      ) {
        return route.fulfill({ status: 202 })
      }
      return route.fulfill({ status: 204 })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('button', { name: /Create an account/ }).click()
    await page.getByLabel('Display name').fill('Ada')
    await page.getByLabel('Email').fill('ada@example.com')
    await page.getByLabel('Password').fill('correct horse battery')
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page.getByText(/Check your email/)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('dialog')).toBeVisible()

    await page.getByRole('button', { name: /Already have an account/ }).click()
    await page.getByLabel(/magic sign-in link/).fill('ada@example.com')
    await page.getByRole('button', { name: 'Email me a link' }).click()
    await expect(page.getByText(/sign-in link is on its way/)).toBeVisible()
    await expect(page).toHaveURL(/\/$/)
  })

  test('redirects profile sign-out to root and keeps Studio sign-out on root', async ({
    page,
  }) => {
    let authenticated = true
    let signOuts = 0
    let remoteProjectReads = 0
    let holdLogout = true
    let releaseLogout!: () => void
    const logoutGate = new Promise<void>((resolve) => {
      releaseLogout = resolve
    })
    await page.route('**/api/**', async (route) => {
      if (await mockAntiforgery(route)) return
      const request = route.request()
      const path = new URL(request.url()).pathname
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      if (path === '/api/auth/me') return authenticated ? json(me) : json({}, 401)
      if (path === '/api/auth/providers') return json({ providers: [] })
      if (path === '/api/profile') return json(profile)
      if (path === '/api/auth/logout') {
        if (holdLogout) await logoutGate
        authenticated = false
        signOuts += 1
        return route.fulfill({ status: 204 })
      }
      if (path === '/api/projects' && request.method() === 'GET') {
        remoteProjectReads += 1
        return json([
          {
            id: 'remote-only',
            name: 'Remote only',
            schemaVersion: 1,
            data: '{}',
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-01T00:00:00Z',
          },
        ])
      }
      return json({}, request.method() === 'GET' ? 200 : 204)
    })

    await page.goto('/profile')
    await expect(page.getByLabel('Display name')).toHaveValue('Ada')
    const readsBeforeSignOut = remoteProjectReads
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Signing out…' })).toBeDisabled()
    await expect(page).toHaveURL(/\/profile$/)
    releaseLogout()
    await expect(page).toHaveURL(/\/$/)
    await expect(
      page.locator('[data-interaction="auth.panel.toggle"]'),
    ).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(remoteProjectReads).toBe(readsBeforeSignOut)
    expect(
      await page.evaluate(() => JSON.stringify({ ...localStorage })),
    ).not.toContain('Remote only')

    authenticated = true
    holdLogout = false
    await page.reload()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(() => signOuts).toBe(2)
  })

  test('re-enters the guard on profile 401 and retries profile 500', async ({ page }) => {
    let authenticated = true
    let profileAttempts = 0
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      const json = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify(body),
        })
      if (path === '/api/auth/me') return authenticated ? json(me) : json({}, 401)
      if (path === '/api/auth/providers') return json({ providers: [] })
      if (path === '/api/profile') {
        profileAttempts += 1
        if (profileAttempts === 1) {
          authenticated = false
          return json({}, 401)
        }
        if (profileAttempts === 2) return json({}, 500)
        return json(profile)
      }
      return route.fulfill({ status: 204 })
    })

    await page.goto('/profile')
    await expect(page.getByRole('dialog', { name: 'Sign in to Cadence' })).toBeVisible()

    authenticated = true
    await page.reload()
    await expect(page.getByRole('alert')).toContainText('couldn’t load your profile')
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.getByLabel('Display name')).toHaveValue('Ada')
  })
})
