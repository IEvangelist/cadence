import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import {
  interactionManifest,
  type InteractionManifestEntry,
} from '../src/test/interactionManifest'

const interactiveSelector = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'audio[controls]',
  'video[controls]',
  '[role="application"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
  '[data-interaction]',
].join(', ')

const proUser = { id: 'u1', email: 'ada@example.com', displayName: 'Ada', tier: 'Pro' }
const proEntitlements = {
  tier: 'Pro',
  watermarkExports: false,
  maxProjects: -1,
  aiGenerationsPerDay: -1,
  advancedFormats: true,
  stemSeparation: true,
  collaborationSeats: 5,
}
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
  stems: [
    {
      label: 'bass',
      sizeBytes: 4096,
      url: '/api/stems/jobs/job-1/stems/bass',
    },
  ],
}
const manifestById = new Map(interactionManifest.map((entry) => [entry.id, entry]))

async function mockApi(route: Route, authenticated: boolean): Promise<void> {
  const request = route.request()
  const path = new URL(request.url()).pathname
  const method = request.method()
  const json = (body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

  if (path === '/api/auth/me') return authenticated ? json(proUser) : json({}, 401)
  if (path === '/api/auth/providers') return json({ providers: ['GitHub'] })
  if (path === '/api/entitlements') {
    return json(
      authenticated
        ? proEntitlements
        : { ...proEntitlements, tier: 'Free', stemSeparation: false },
    )
  }
  if (path === '/api/projects' && method === 'GET') return json([])
  if (path === '/api/stems/jobs' && method === 'GET') {
    return json(authenticated ? [completedJob] : [])
  }
  if (path === '/api/stems/jobs/job-1' && method === 'GET') return json(completedJob)
  return json({}, method === 'GET' ? 200 : 204)
}

interface RenderedSemantics {
  role: string
  name: string
  ariaHidden: boolean
}

async function renderedSemantics(locator: Locator): Promise<RenderedSemantics> {
  return locator.evaluate((element) => {
    const tag = element.tagName.toLowerCase()
    const explicitRole = element.getAttribute('role')
    let role = explicitRole ?? tag
    if (!explicitRole) {
      if (tag === 'button') role = 'button'
      if (tag === 'a') role = 'link'
      if (tag === 'select') role = 'combobox'
      if (tag === 'textarea') role = 'textbox'
      if (element instanceof HTMLInputElement) {
        role =
          {
            button: 'button',
            checkbox: 'checkbox',
            file: 'button',
            number: 'spinbutton',
            radio: 'radio',
            range: 'slider',
            reset: 'button',
            submit: 'button',
          }[element.type] ?? (element.type === 'password' ? 'input' : 'textbox')
      }
    }

    const labelledBy = element
      .getAttribute('aria-labelledby')
      ?.split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
    const labels =
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
        ? Array.from(element.labels ?? [])
            .map((label) => label.textContent ?? '')
            .join(' ')
        : ''
    const name =
      element.getAttribute('aria-label') ||
      labelledBy ||
      labels ||
      element.textContent ||
      element.getAttribute('title') ||
      ''

    return {
      role,
      name: name.replace(/\s+/g, ' ').trim(),
      ariaHidden: element.getAttribute('aria-hidden') === 'true',
    }
  })
}

function matchesExpectedName(
  actual: string,
  { expectedName }: InteractionManifestEntry,
): boolean {
  if (expectedName.startsWith('/') && expectedName.endsWith('/')) {
    return new RegExp(expectedName.slice(1, -1), 'i').test(actual)
  }
  return actual === expectedName
}

async function assertInteractionContract(page: Page, state: string): Promise<void> {
  const rendered = page.locator(interactiveSelector)
  const failures: string[] = []

  for (let index = 0; index < (await rendered.count()); index += 1) {
    const locator = rendered.nth(index)
    const tag = await locator.evaluate((element) => element.tagName.toLowerCase())
    const id = await locator.getAttribute('data-interaction')
    if (!id) {
      failures.push(`${state}: <${tag}> is missing data-interaction`)
      continue
    }
    const entry = manifestById.get(id)
    if (!entry) {
      failures.push(`${state}: ${id} is not registered`)
      continue
    }
    if (!(await locator.isVisible())) continue
    const semantics = await renderedSemantics(locator)
    if (semantics.ariaHidden) continue
    if (semantics.role !== entry.expectedRole) {
      failures.push(
        `${state}: ${id} role ${semantics.role} does not match ${entry.expectedRole}`,
      )
    }
    if (!semantics.name) {
      failures.push(`${state}: ${id} has no accessible name`)
    } else if (!matchesExpectedName(semantics.name, entry)) {
      failures.push(
        `${state}: ${id} name "${semantics.name}" does not match ${entry.expectedName}`,
      )
    }
  }

  expect(failures).toEqual([])
}

test.describe('production interaction contract', () => {
  test('covers studio, auth, pricing, stems, and licenses states', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, false))
    await page.goto('/')

    await assertInteractionContract(page, 'studio')

    await page.getByRole('button', { name: 'Sign in' }).click()
    await assertInteractionContract(page, 'auth sign-in')
    await page.getByRole('button', { name: /Create an account/ }).click()
    await assertInteractionContract(page, 'auth registration')
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.getByRole('button', { name: 'Pricing' }).click()
    await assertInteractionContract(page, 'pricing')

    await page.getByRole('button', { name: 'Stems' }).click()
    await assertInteractionContract(page, 'stems free tier')

    await page.getByRole('button', { name: 'Third-party licenses' }).click()
    await assertInteractionContract(page, 'licenses')
  })

  test('covers authenticated profile and native stem controls', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, true))
    await page.goto('/')

    await page.getByRole('button', { name: 'Profile' }).click()
    await assertInteractionContract(page, 'profile')

    await page.getByRole('button', { name: 'Stems' }).click()
    await expect(page.getByLabel('bass stem preview')).toBeVisible()
    await assertInteractionContract(page, 'stems pro results')
  })
})
