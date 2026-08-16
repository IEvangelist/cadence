import { expect, test, type Page, type Route } from '@playwright/test'
import {
  defaultProjectDetailDto,
  defaultProjectSummaryDto,
} from './projectFixtures'

const user = { id: 'u1', email: 'ada@example.com', displayName: 'Ada', tier: 'Pro' }
const entitlements = {
  tier: 'Pro',
  watermarkExports: false,
  maxProjects: -1,
  aiGenerationsPerDay: -1,
  advancedFormats: true,
  stemSeparation: true,
  collaborationSeats: 5,
}

const storageWithOnboardingDismissed = (baseURL?: string) => ({
  cookies: [],
  origins: [
    {
      origin: baseURL ?? 'http://127.0.0.1:4173',
      localStorage: [{ name: 'cadence.v1.onboarding.seen', value: '1' }],
    },
  ],
})

async function routeAuthenticatedProjects(
  route: Route,
  options: { delayList?: number; failList?: boolean; failSave?: () => boolean } = {},
) {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') return json(user)
  if (path === '/api/auth/providers') return json({ providers: [] })
  if (path === '/api/entitlements') return json(entitlements)
  if (path === '/api/projects' && method === 'GET') {
    if (options.delayList) await new Promise((resolve) => setTimeout(resolve, options.delayList))
    return options.failList ? json({}, 500) : json([defaultProjectSummaryDto])
  }
  if (path === `/api/projects/${defaultProjectSummaryDto.id}` && method === 'GET') {
    return json(defaultProjectDetailDto)
  }
  if (path === '/api/projects' && method === 'POST') {
    if (options.failSave?.()) return json({}, 500)
    const payload = request.postDataJSON() as {
      id: string
      name: string
      schemaVersion: number
      data: string
    }
    return json(
      {
        ...payload,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:01:00Z',
      },
      201,
    )
  }
  if (/^\/api\/projects\/[^/]+$/.test(path) && method === 'PUT') {
    if (options.failSave?.()) return json({}, 500)
    const payload = request.postDataJSON()
    return json({
      ...(payload as object),
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:01:00Z',
    })
  }
  return json({}, method === 'GET' ? 200 : 204)
}

async function openProjectMenu(page: Page) {
  await page.getByRole('button', { name: 'Project', exact: true }).click()
}

test.describe('Start Center and project lifecycle', () => {
  test('an empty store opens Start Center and Blank creates a durable fresh project', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: storageWithOnboardingDismissed(baseURL),
    })
    const page = await context.newPage()
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') return route.fulfill({ status: 401, body: '{}' })
      if (path === '/api/auth/providers') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"providers":[]}' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
    await page.getByRole('button', { name: /Blank project/ }).click()
    await expect(page.getByLabel('Project name')).toHaveValue('Untitled')
    await expect.poll(() =>
      page.evaluate(() => localStorage.getItem('cadence.v1.last')),
    ).toMatch(/^project_/)
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) => key.includes('project_bootstrap')),
      ),
    ).toBe(false)
    await context.close()
  })

  test('slow remote restore never saves the bootstrap project', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: storageWithOnboardingDismissed(baseURL),
    })
    const page = await context.newPage()
    let saveCalls = 0
    await page.route('**/api/**', async (route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        saveCalls += 1
      }
      await routeAuthenticatedProjects(route, { delayList: 700 })
    })

    await page.goto('/')
    await expect(page.getByText('Restoring your project...')).toBeVisible()
    await page.waitForTimeout(300)
    expect(saveCalls).toBe(0)
    await expect(page.getByLabel('Project name')).toHaveValue('E2E Returning Project')
    expect(saveCalls).toBe(0)
    await context.close()
  })

  test('restore Continue is session-only and reload retries the untouched remote project', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: storageWithOnboardingDismissed(baseURL),
    })
    const page = await context.newPage()
    let failList = true
    let destructiveCalls = 0
    await page.route('**/api/**', async (route) => {
      if (['POST', 'PUT', 'DELETE'].includes(route.request().method())) destructiveCalls += 1
      await routeAuthenticatedProjects(route, { failList })
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Your last project could not be restored' })).toBeVisible()
    await page.getByRole('button', { name: 'Continue to Start Center' }).click()
    await expect(page.getByRole('button', { name: /Blank project/ })).toBeVisible()
    expect(destructiveCalls).toBe(0)

    failList = false
    await page.reload()
    await expect(page.getByLabel('Project name')).toHaveValue('E2E Returning Project')
    expect(destructiveCalls).toBe(0)
    await context.close()
  })

  test('failed replacement flush supports Retry, Cancel, and explicit Discard', async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      baseURL,
      storageState: storageWithOnboardingDismissed(baseURL),
    })
    const page = await context.newPage()
    let failSave = true
    await page.route('**/api/**', (route) =>
      routeAuthenticatedProjects(route, { failSave: () => failSave }),
    )
    await page.goto('/')
    const name = page.getByLabel('Project name')
    await expect(name).toHaveValue('E2E Returning Project')
    await name.fill('Dirty project')

    await openProjectMenu(page)
    await page.getByRole('menuitem', { name: 'New project' }).click()
    await page.getByRole('button', { name: /Blank project/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await expect(name).toHaveValue('Dirty project')

    failSave = false
    await page.locator('[data-interaction="studio.project-replacement.retry"]').click()
    await expect(name).toHaveValue('Untitled')

    await name.fill('Keep this')
    failSave = true
    await openProjectMenu(page)
    await page.getByRole('menuitem', { name: 'New project' }).click()
    await page.getByRole('button', { name: /Demo pattern/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Keep editing' }).click()
    await expect(name).toHaveValue('Keep this')

    await page.getByRole('button', { name: /Demo pattern/ }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await page.getByRole('button', { name: 'Discard changes and continue' }).click()
    await expect(name).not.toHaveValue('Keep this')
    await context.close()
  })
})
