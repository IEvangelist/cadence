import { expect, test, type Page, type Route } from '@playwright/test'
import { chooseExport, createBlankProject } from './projectActions'
import { openStudioDestination } from './studioActions'
import { mockAntiforgery } from './mockAntiforgery'

interface MockProjectState {
  saved?: Record<string, unknown>
}

async function mockAuthenticatedApi(
  route: Route,
  state: MockProjectState,
  saveDelayMs = 0,
  failSave = false,
) {
  if (await mockAntiforgery(route)) return
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

async function startBlankWhenNeeded(page: Page): Promise<void> {
  const blank = page.getByRole('button', { name: /Blank project/ })
  if (await blank.isVisible().catch(() => false)) await blank.click()
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

    await openStudioDestination(page, 'Pricing')
    await expect(page).toHaveURL(/\/pricing\?collab=room&role=viewer&share=token#project=invalid$/)
    await expect(page).toHaveTitle('Pricing | Cadence')
    await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeFocused()
    await expect(main).not.toBeFocused()

    await page.goBack()
    await expect(page).toHaveURL(/\/\?collab=room&role=viewer&share=token#project=invalid$/)
    await expect(page).toHaveTitle('Cadence')

    await page.goForward()
    await expect(page).toHaveTitle('Pricing | Cadence')
  })

  test('not-found recovery preserves collaboration and share suffixes', async ({ page }) => {
    await page.goto('/missing?collab=room#project=snapshot')
    await page.getByRole('button', { name: 'Return to Studio' }).click()
    await expect(page).toHaveURL(/\/\?collab=room#project=snapshot$/)
  })

  test('consumes a shared project hash with router replace and preserves search', async ({
    page,
  }) => {
    await page.goto('/')
    await createBlankProject(page)
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
    await chooseExport(page, 'Share snapshot')
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
    await startBlankWhenNeeded(page)
    await page.getByLabel('Project name').fill('Saved before route exit')
    await openStudioDestination(page, 'Pricing')

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Saving changes…')).toBeVisible()
    await expect(page).toHaveURL(/\/pricing$/, { timeout: 5_000 })

    await page.getByRole('button', { name: 'Back to composer' }).click()
    await expect(page.getByLabel('Project name')).toHaveValue('Saved before route exit')
  })

  test('keeps Studio mounted after a failed save until Retry succeeds', async ({ page }) => {
    let saveAttempts = 0
    let failSave = false
    const state: MockProjectState = {}
    await page.route('**/api/**', async (route) => {
      const request = route.request()
      if (new URL(request.url()).pathname === '/api/projects' && request.method() === 'POST') {
        saveAttempts += 1
        if (failSave) return route.fulfill({ status: 503, body: 'offline' })
      }
      return mockAuthenticatedApi(route, state)
    })
    await page.goto('/')
    await startBlankWhenNeeded(page)
    await expect(page.locator('.toolbar-save-state')).toContainText(/All changes saved|Saved/)
    failSave = true
    await page.getByLabel('Project name').fill('Retry this save')
    await openStudioDestination(page, 'Pricing')

    await expect(page).toHaveURL(/\/$/)
    const routeRetry = page.locator('[data-interaction="studio.autosave.retry"]')
    await expect(routeRetry).toBeVisible()
    failSave = false
    await routeRetry.click()
    await expect(page).toHaveURL(/\/pricing$/)
    expect(saveAttempts).toBeGreaterThanOrEqual(2)
  })

  test('awaits autosave before browser back leaves Studio', async ({ page }) => {
    const state: MockProjectState = {}
    await page.route('**/api/**', (route) => mockAuthenticatedApi(route, state, 500))
    await page.goto('/pricing')
    await page.getByRole('button', { name: 'Back to composer' }).click()
    await startBlankWhenNeeded(page)
    await page.getByLabel('Project name').fill('Saved before browser back')

    const back = page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Saving changes…')).toBeVisible()
    await back
    await expect(page).toHaveURL(/\/pricing$/)
  })

  test('only the latest destination proceeds during one slow save', async ({ page }) => {
    const state: MockProjectState = {}
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))
    await page.route('**/api/**', (route) => mockAuthenticatedApi(route, state, 600))
    await page.goto('/')
    await startBlankWhenNeeded(page)
    await page.getByLabel('Project name').fill('Latest destination')

    await openStudioDestination(page, 'Pricing')
    await openStudioDestination(page, 'Stems')

    await expect(page).toHaveURL(/\/stems$/, { timeout: 5_000 })
    expect(pageErrors).toEqual([])
  })

  test('registers unload confirmation only while Studio has unsaved work', async ({
    page,
  }) => {
    const dispatchBeforeUnload = () =>
      page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      })

    await page.goto('/')
    await expect.poll(dispatchBeforeUnload).toBe(false)

    await page.getByLabel('Project name').fill('Dirty before unload')
    await expect.poll(dispatchBeforeUnload).toBe(true)

    await expect.poll(dispatchBeforeUnload, { timeout: 5_000 }).toBe(false)
  })
})
