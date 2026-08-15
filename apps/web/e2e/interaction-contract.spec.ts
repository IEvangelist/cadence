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
  if (/^\/api\/projects\/[^/]+\/shares$/.test(path) && method === 'GET') return json([])
  if (path === '/api/stems/jobs' && method === 'GET') {
    return json(authenticated ? [completedJob] : [])
  }
  if (path === '/api/stems/jobs/job-1' && method === 'GET') return json(completedJob)
  return json({}, method === 'GET' ? 200 : 204)
}

interface RenderedSemantics {
  role: string
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

    return {
      role: element.getAttribute('aria-hidden') === 'true' ? 'none' : role,
    }
  })
}

function expectedAccessibleName({
  expectedName,
}: InteractionManifestEntry): string | RegExp {
  if (expectedName.startsWith('/') && expectedName.endsWith('/')) {
    return new RegExp(expectedName.slice(1, -1), 'i')
  }
  return expectedName
}

async function assertInteractionContract(page: Page, state: string): Promise<void> {
  const rendered = page.locator(interactiveSelector)
  const failures: string[] = []
  const visibleCounts = new Map<string, number>()

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
    visibleCounts.set(id, (visibleCounts.get(id) ?? 0) + 1)
    const semantics = await renderedSemantics(locator)
    if (semantics.role !== entry.expectedRole) {
      failures.push(
        `${state}: ${id} role ${semantics.role} does not match ${entry.expectedRole}`,
      )
    }
    try {
      if (entry.accessibilityExemption) {
        await expect(locator).toHaveAccessibleName('', { timeout: 0 })
      } else {
        await expect(locator).toHaveAccessibleName(expectedAccessibleName(entry), {
          timeout: 0,
        })
      }
    } catch {
      failures.push(
        entry.accessibilityExemption
          ? `${state}: ${id} exemption is stale because it now has an accessible name`
          : `${state}: ${id} accessible name does not match ${entry.expectedName}`,
      )
    }
  }

  for (const [id, count] of visibleCounts) {
    const entry = manifestById.get(id)
    if (!entry) continue
    if (entry.multiplicity === 'one' && count !== 1) {
      failures.push(`${state}: ${id} expected one visible instance, found ${count}`)
    }
    for (const alternativeId of entry.accessibilityExemption?.alternativeInteractionIds ?? []) {
      if ((visibleCounts.get(alternativeId) ?? 0) === 0) {
        failures.push(`${state}: ${id} alternative ${alternativeId} is not visible`)
      }
    }
  }

  expect(failures).toEqual([])
}

async function openPanel(page: Page, name: string): Promise<Locator> {
  const toggle = page.getByRole('button', { name, exact: true })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  const panel = page.getByRole('region', { name, exact: true })
  await expect(panel).toBeVisible()
  return panel
}

test.describe('production interaction contract', () => {
  test.describe.configure({ timeout: 90_000 })

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

  test('covers authenticated studio conditional states, profile, pricing, and stems', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __CADENCE_AI_MOCK__: boolean }).__CADENCE_AI_MOCK__ = true
    })
    await page.route('**/api/**', (route) => mockApi(route, true))
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible()

    const skipLink = page.getByRole('link', { name: 'Skip to editor' })
    await skipLink.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#composer-main')).toBeFocused()
    await assertInteractionContract(page, 'authenticated studio')

    const shareToggle = page.locator('[data-interaction="studio.share.toggle"]')
    await shareToggle.click()
    await expect(page.getByRole('group', { name: 'Share links' })).toBeVisible()
    await assertInteractionContract(page, 'authenticated share panel')
    await shareToggle.click()

    await openPanel(page, 'Quick Starts')
    await assertInteractionContract(page, 'quick starts open')

    const aiStudio = await openPanel(page, 'AI Studio')
    await expect(aiStudio.getByText('Pro · on-device')).toBeVisible()
    await assertInteractionContract(page, 'AI Studio text to motif')
    await aiStudio.getByRole('radio', { name: /Style transfer/ }).check()
    await assertInteractionContract(page, 'AI Studio style transfer')
    await aiStudio.getByRole('radio', { name: /Groove & humanize/ }).check()
    await assertInteractionContract(page, 'AI Studio groove')
    await aiStudio.getByRole('radio', { name: /Auto-master/ }).check()
    await assertInteractionContract(page, 'AI Studio auto-master')

    await openPanel(page, 'Mixer')
    await assertInteractionContract(page, 'mixer open')

    const extensions = await openPanel(page, 'Extensions')
    await extensions.getByRole('checkbox', { name: /Hello Cadence \(example\)/ }).check()
    await expect(page.getByRole('region', { name: 'Example plugin' })).toBeVisible()
    await assertInteractionContract(page, 'extensions enabled')

    await page.getByRole('button', { name: 'New' }).click()
    await expect(page.getByText('Your canvas is empty.')).toBeVisible()
    await assertInteractionContract(page, 'empty project')

    const assistant = await openPanel(page, 'AI Assistant')
    await assistant.getByRole('radio', { name: /Generate melody/ }).check()
    await assistant.getByRole('button', { name: 'Generate' }).click()
    await expect(assistant.getByRole('button', { name: 'Accept' })).toBeVisible()
    await assertInteractionContract(page, 'assistant suggestion')

    await page.getByRole('button', { name: 'Pricing' }).click()
    await expect(page.getByRole('button', { name: 'Manage billing' })).toBeVisible()
    await assertInteractionContract(page, 'pricing pro tier')

    await page.getByRole('button', { name: 'Profile' }).click()
    await assertInteractionContract(page, 'profile')

    await page.getByRole('button', { name: 'Stems' }).click()
    await expect(page.getByLabel('bass stem preview')).toBeVisible()
    await assertInteractionContract(page, 'stems pro results')
  })
})

test.describe('first-run interaction contract', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('covers the visible onboarding dialog', async ({ page }) => {
    await page.route('**/api/**', (route) => mockApi(route, false))
    await page.goto('/')
    await expect(page.getByRole('dialog')).toBeVisible()
    await assertInteractionContract(page, 'first-run onboarding')
  })
})
