import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Route } from '@playwright/test'
import { openStudioDestination } from './studioActions'

// Standalone stems UI e2e against the production build. There is no backend in
// e2e, so every `/api/**` call is mocked with `page.route`. We prove:
//   1. a signed-in free user is gated with an accessible upgrade CTA, and
//   2. a Pro user can upload a mix and receive downloadable, labeled stems,
// with both surfaces axe-clean.
const proUser = { id: 'u1', email: 'ada@example.com', displayName: 'Ada', tier: 'Pro' }
const freeUser = { ...proUser, tier: 'Free' }

const entitlements = (stemSeparation: boolean) => ({
  tier: stemSeparation ? 'Pro' : 'Free',
  watermarkExports: !stemSeparation,
  maxProjects: stemSeparation ? -1 : 10,
  aiGenerationsPerDay: stemSeparation ? -1 : 50,
  advancedFormats: stemSeparation,
  stemSeparation,
  collaborationSeats: stemSeparation ? 5 : 1,
})

const STEM_LABELS = ['bass', 'drums', 'vocals', 'guitar', 'keys', 'synth', 'other']

const completedJob = {
  id: 'job-1',
  status: 'Completed',
  originalFileName: 'mix.wav',
  contentType: 'audio/wav',
  sizeBytes: 2048,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:01:00Z',
  completedAt: '2025-01-01T00:01:00Z',
  errorMessage: null,
  stems: STEM_LABELS.map((label, index) => ({
    label,
    sizeBytes: 4096 * (index + 1),
    url: `/api/stems/jobs/job-1/stems/${label}`,
  })),
}

async function mockApi(route: Route, pro: boolean): Promise<void> {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') return json(pro ? proUser : freeUser)
  if (path === '/api/auth/providers') return json({ providers: [] })
  if (path === '/api/entitlements') return json(entitlements(pro))
  if (path === '/api/projects' && method === 'GET') return json([])
  if (path === '/api/stems/jobs' && method === 'GET') return json([])
  if (path === '/api/stems/jobs' && method === 'POST') return json(completedJob, 202)
  return json({}, method === 'GET' ? 200 : 204)
}

test.describe('stems', () => {
  test('gates free users with an accessible upgrade CTA', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, false))
    await page.goto('/')

    await openStudioDestination(page, 'Stems')

    await expect(
      page.getByRole('heading', { name: 'Stem separation', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: /Pro feature/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'See Pro plans' })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })

  test('lets a Pro user separate a mix into downloadable stems', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, true))
    await page.goto('/')

    await openStudioDestination(page, 'Stems')
    await expect(page.getByLabel('Choose a mix to separate')).toBeVisible()

    await page.getByLabel('Choose a mix to separate').setInputFiles({
      name: 'mix.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]),
    })
    await page.getByRole('button', { name: 'Separate stems' }).click()

    await expect(page.getByRole('heading', { name: 'mix.wav' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Download bass/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Download vocals/ })).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})
