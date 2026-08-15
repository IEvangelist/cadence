import { expect, test, type Page, type Route } from '@playwright/test'

interface MockProjectState {
  saved?: Record<string, unknown>
}

async function mockAuthenticatedApi(
  route: Route,
  state: MockProjectState,
  saveDelayMs = 0,
  failSave = false,
) {
  const request = route.request()
  const path = new URL(request.url()).pathname
  const method = request.method()
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') {
    return json({ id: 'route-user', email: 'route@example.com', displayName: 'Route User', tier: 'Pro' })
  }
  if (path === '/api/auth/providers') return json({ providers: [] })
  if (path === '/api/entitlements') {
    return json({
      tier: 'Pro',
      watermarkExports: false,
      maxProjects: -1,
      aiGenerationsPerDay: -1,
      advancedFormats: true,
      stemSeparation: true,
      collaborationSeats: 5,
    })
  }
  if (path === '/api/projects' && method === 'GET') {
    return json(
      state.saved
        ? [
            {
              ...state.saved,
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-01T00:00:00Z',
            },
          ]
        : [],
    )
  }
  if (/^\/api\/projects\/[^/]+$/.test(path) && method === 'GET') {
    return state.saved
      ? json({
          ...state.saved,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        })
      : json({}, 404)
  }
  if (path === '/api/projects' && method === 'POST') {
    if (saveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, saveDelayMs))
    if (failSave) return route.fulfill({ status: 503, body: 'offline' })
    const project = request.postDataJSON() as Record<string, unknown>
    state.saved = project
    return json({
      ...project,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }, 201)
  }
  return json({}, method === 'GET' ? 200 : 204)
}

async function expectRoute(page: Page, path: string, title: string) {
  await page.goto(path)
  await expect(page).toHaveTitle(title)
  await expect(page.getByRole('main')).toBeVisible()
  await page.reload()
  await expect(page).toHaveTitle(title)
}

test.describe('browser-history routes', () => {
  test('direct-loads and reloads every product route', async ({ page }) => {
    await expectRoute(page, '/', 'Cadence')
    await expectRoute(page, '/stems', 'Stems | Cadence')
    await expectRoute(page, '/pricing', 'Pricing | Cadence')
    await expectRoute(page, '/profile', 'Profile | Cadence')
    await expectRoute(page, '/licenses', 'Licenses | Cadence')
  })

  test('preserves query and hash across route history and focuses only pathname changes', async ({
    page,
  }) => {
    await page.goto('/?collab=room&role=viewer&share=token#project=invalid')
    const main = page.getByRole('main')
    await expect(main).not.toBeFocused()

    await page.getByRole('button', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/pricing\?collab=room&role=viewer&share=token#project=invalid$/)
    await expect(page).toHaveTitle('Pricing | Cadence')
    await expect(main).toBeFocused()

    await page.goBack()
    await expect(page).toHaveURL(/\/\?collab=room&role=viewer&share=token#project=invalid$/)
    await expect(page).toHaveTitle('Cadence')

    await page.goForward()
    await expect(page).toHaveTitle('Pricing | Cadence')
  })

  test('consumes a shared project hash with router replace and preserves search', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'New' }).click()
    await page.getByLabel('Project name').fill('Shared through router')
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            ;(window as unknown as { __sharedUrl?: string }).__sharedUrl = text
          },
        },
      })
    })
    await page.locator('[data-interaction="studio.project.share"]').click()
    await page.waitForFunction(
      () => Boolean((window as unknown as { __sharedUrl?: string }).__sharedUrl),
    )
    const sharedUrl = await page.evaluate(
      () => (window as unknown as { __sharedUrl?: string }).__sharedUrl,
    )
    const fragment = new URL(sharedUrl as string).hash

    await page.goto('/pricing')
    await page.goto(`/?source=test${fragment}`)
    await expect(page.getByLabel('Project name')).toHaveValue('Shared through router')
    await expect(page).toHaveURL(/\?source=test$/)

    await page.goBack()
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('holds a route exit until a slow remote autosave completes', async ({ page }) => {
    const state: MockProjectState = {}
    await page.route('**/api/**', (route) => mockAuthenticatedApi(route, state, 600))
    await page.goto('/')
    await page.getByLabel('Project name').fill('Saved before route exit')
    await page.getByRole('button', { name: 'Pricing' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Saving changes…')).toBeVisible()
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 5_000 })

    await page.getByRole('button', { name: 'Back to composer' }).click()
    await expect(page.getByLabel('Project name')).toHaveValue('Saved before route exit')
  })

  test('keeps Studio mounted after a failed save until Retry succeeds', async ({ page }) => {
    let saveAttempts = 0
    const state: MockProjectState = {}
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      if (new URL(request.url()).pathname === '/api/projects' && request.method() === 'POST') {
        saveAttempts += 1
        if (saveAttempts === 1) return route.fulfill({ status: 503, body: 'offline' })
      }
      return mockAuthenticatedApi(route, state)
    })
    await page.goto('/')
    await page.getByLabel('Project name').fill('Retry this save')
    await page.getByRole('button', { name: 'Pricing' }).click()

    await expect(page).toHaveURL(/\/$/)
    await page.getByRole('button', { name: 'Retry save' }).click()
    await expect(page).toHaveURL(/\/pricing$/)
    expect(saveAttempts).toBe(2)
  })

  test('awaits autosave before browser back leaves Studio', async ({ page }) => {
    const state: MockProjectState = {}
    await page.route('**/api/**', (route) => mockAuthenticatedApi(route, state, 500))
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Back to composer' }).click()
    await page.getByLabel('Project name').fill('Saved before browser back')

    const back = page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Saving changes…')).toBeVisible()
    await back
    await expect(page).toHaveURL(/\/pricing$/)
  })
})
