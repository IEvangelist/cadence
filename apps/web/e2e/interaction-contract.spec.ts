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
const existingShares = [
  { token: 'editor-token', role: 'editor', createdAt: '2025-01-01T00:00:00Z' },
  { token: 'viewer-token', role: 'viewer', createdAt: '2025-01-01T00:00:00Z' },
]
const manifestById = new Map(interactionManifest.map((entry) => [entry.id, entry]))

async function mockApi(
  route: Route,
  authenticated: boolean,
  pro = authenticated,
): Promise<void> {
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
        ? { ...proEntitlements, tier: pro ? 'Pro' : 'Free', stemSeparation: pro }
        : { ...proEntitlements, tier: 'Free', stemSeparation: false },
    )
  }
  if (path === '/api/projects' && method === 'GET') return json([])
  if (path === '/api/projects' && method === 'POST') {
    const project = request.postDataJSON() as {
      id: string
      name: string
      schemaVersion: number
      data: string
    }
    return json({
      ...project,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }, 201)
  }
  if (/^\/api\/projects\/[^/]+\/shares$/.test(path) && method === 'GET') {
    return json(authenticated ? existingShares : [])
  }
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

async function assertInteractionContract(
  page: Page,
  state: string,
  observed: Set<string>,
): Promise<void> {
  const rendered = page.locator(interactiveSelector)
  const failures: string[] = []
  const visibleCounts = new Map<string, number>()
  const snapshot = await rendered.evaluateAll((elements) =>
    elements.map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.getAttribute('data-interaction'),
    })),
  )

  for (const { tag, id } of snapshot) {
    if (!id) {
      failures.push(`${state}: <${tag}> is missing data-interaction`)
      continue
    }
    if (!manifestById.has(id)) {
      failures.push(`${state}: ${id} is not registered`)
    }
  }

  const ids = [...new Set(snapshot.flatMap(({ id }) => (id ? [id] : [])))]
  for (const id of ids) {
    const entry = manifestById.get(id)
    if (!entry) continue
    const visible = page.locator(`[data-interaction="${id}"]:visible`)
    const count = await visible.count()
    if (count === 0) continue
    visibleCounts.set(id, count)

    for (let index = 0; index < count; index += 1) {
      const locator = visible.nth(index)
      const semantics = await renderedSemantics(locator)
      if (semantics.role !== entry.expectedRole) {
        failures.push(
          `${state}: ${id} role ${semantics.role} does not match ${entry.expectedRole}`,
        )
      }
      try {
        if (entry.accessibilityExemption) {
          await expect(locator).toHaveAccessibleName('', { timeout: 500 })
        } else {
          await expect(locator).toHaveAccessibleName(expectedAccessibleName(entry), {
            timeout: 500,
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
  }

  for (const [id, count] of visibleCounts) {
    observed.add(id)
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
  test.describe.configure({ timeout: 300_000 })

  test('observes every registered interaction across current production states', async ({
    page,
    browser,
    baseURL,
  }) => {
    const observed = new Set<string>()
    await page.route('**/api/**', (route) => mockApi(route, false))
    await page.goto('/')

    await assertInteractionContract(page, 'studio', observed)

    await page.getByRole('button', { name: 'Choose theme' }).click()
    await assertInteractionContract(page, 'theme menu', observed)
    await page.getByRole('menuitemradio', { name: 'System theme' }).click()

    await page.getByRole('button', { name: 'Sign in' }).click()
    await assertInteractionContract(page, 'auth sign-in', observed)
    await page.getByRole('button', { name: /Create an account/ }).click()
    await assertInteractionContract(page, 'auth registration', observed)
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await page.getByRole('button', { name: 'Pricing' }).click()
    await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
    await assertInteractionContract(page, 'pricing', observed)

    await page.getByRole('button', { name: 'Stems' }).click()
    await expect(page.getByRole('heading', { name: 'Stem separation' })).toBeVisible()
    await assertInteractionContract(page, 'stems free tier', observed)

    await page.getByRole('button', { name: 'Third-party licenses' }).click()
    await expect(
      page.getByRole('heading', { name: /Acknowledgements & third-party licenses/i }),
    ).toBeVisible()
    await assertInteractionContract(page, 'licenses', observed)

    await page.goto('/missing')
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await assertInteractionContract(page, 'not found', observed)
    await page.getByRole('button', { name: 'Return to Studio' }).click()

    const origin = baseURL ?? 'http://127.0.0.1:4173'
    const returningStorage = {
      cookies: [],
      origins: [
        {
          origin,
          localStorage: [{ name: 'cadence.v1.onboarding.seen', value: '1' }],
        },
      ],
    }
    const freeUserContext = await browser.newContext({
      baseURL: origin,
      storageState: returningStorage,
    })
    const freeUserPage = await freeUserContext.newPage()
    await freeUserPage.route('**/api/**', (route) => mockApi(route, true, false))
    await freeUserPage.goto('/')
    await expect(freeUserPage.getByRole('button', { name: 'Profile' })).toBeVisible()
    await freeUserPage.getByRole('button', { name: 'Stems' }).click()
    await expect(freeUserPage.getByRole('button', { name: 'See Pro plans' })).toBeVisible()
    await assertInteractionContract(freeUserPage, 'authenticated free stems', observed)
    await freeUserContext.close()

    const authenticatedContext = await browser.newContext({
      baseURL: origin,
      storageState: returningStorage,
    })
    const authenticatedPage = await authenticatedContext.newPage()
    await authenticatedPage.addInitScript(() => {
      ;(window as unknown as { __CADENCE_AI_MOCK__: boolean }).__CADENCE_AI_MOCK__ = true
    })
    await authenticatedPage.route('**/api/**', (route) => mockApi(route, true))
    await authenticatedPage.goto('/')
    await expect(authenticatedPage.getByRole('button', { name: 'Profile' })).toBeVisible()

    const skipLink = authenticatedPage.getByRole('link', { name: 'Skip to editor' })
    await skipLink.focus()
    await authenticatedPage.keyboard.press('Enter')
    await expect(authenticatedPage.locator('#composer-main')).toBeFocused()
    await assertInteractionContract(authenticatedPage, 'authenticated studio', observed)

    const note = authenticatedPage.locator('[data-interaction="studio.piano-roll.note"]').first()
    await note.click()
    await expect(
      authenticatedPage.locator('[data-interaction="studio.piano-roll.velocity.selected"]'),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'selected piano note', observed)

    const shareToggle = authenticatedPage.locator('[data-interaction="studio.share.toggle"]')
    await shareToggle.click()
    await expect(authenticatedPage.getByRole('group', { name: 'Share links' })).toBeVisible()
    await expect(authenticatedPage.getByRole('button', { name: 'Copy link' })).toHaveCount(2)
    await expect(authenticatedPage.getByRole('button', { name: 'Revoke' })).toHaveCount(2)
    await assertInteractionContract(authenticatedPage, 'authenticated share panel', observed)
    await shareToggle.click()

    await openPanel(authenticatedPage, 'Quick Starts')
    await assertInteractionContract(authenticatedPage, 'quick starts open', observed)

    const aiStudio = await openPanel(authenticatedPage, 'AI Studio')
    await expect(aiStudio.getByText('Pro · on-device')).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'AI Studio text to motif', observed)
    await aiStudio.getByRole('radio', { name: /Style transfer/ }).check()
    await assertInteractionContract(authenticatedPage, 'AI Studio style transfer', observed)
    await aiStudio.getByRole('radio', { name: /Groove & humanize/ }).check()
    await assertInteractionContract(authenticatedPage, 'AI Studio groove', observed)
    await aiStudio.getByRole('radio', { name: /Auto-master/ }).check()
    await assertInteractionContract(authenticatedPage, 'AI Studio auto-master', observed)

    const mixer = await openPanel(authenticatedPage, 'Mixer')
    const firstStrip = mixer.locator('fieldset').first()
    await firstStrip.getByRole('button', { name: 'Add', exact: true }).click()
    const volumeAutomation = firstStrip.getByRole('group', { name: 'Volume automation' })
    await volumeAutomation.getByRole('button', { name: 'Add point' }).click()
    await expect(volumeAutomation.getByRole('button', { name: /Remove Volume point/ })).toBeVisible()
    await expect(
      volumeAutomation.getByRole('button', { name: 'Clear Volume automation' }),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'mixer with insert and automation', observed)

    const extensions = await openPanel(authenticatedPage, 'Extensions')
    await extensions.getByRole('checkbox', { name: /Hello Cadence \(example\)/ }).check()
    await expect(authenticatedPage.getByRole('region', { name: 'Example plugin' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'extensions enabled', observed)

    await authenticatedPage.getByRole('button', { name: 'New' }).click()
    await expect(authenticatedPage.getByText('Your canvas is empty.')).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'empty project', observed)

    const assistant = await openPanel(authenticatedPage, 'AI Assistant')
    await assistant.getByRole('radio', { name: /Generate melody/ }).check()
    await assistant.getByRole('button', { name: 'Generate' }).click()
    await expect(assistant.getByRole('button', { name: 'Accept' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'assistant suggestion', observed)

    await authenticatedPage.getByRole('button', { name: 'Pricing' }).click()
    await expect(authenticatedPage.getByRole('button', { name: 'Manage billing' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'pricing pro tier', observed)

    await authenticatedPage.getByRole('button', { name: 'Profile' }).click()
    await expect(authenticatedPage.getByRole('heading', { name: 'Your profile' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'profile', observed)

    await authenticatedPage.getByRole('button', { name: 'Stems' }).click()
    await expect(authenticatedPage.getByLabel('bass stem preview')).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'stems pro results', observed)
    await authenticatedContext.close()

    const failingSaveContext = await browser.newContext({
      baseURL: origin,
      storageState: returningStorage,
    })
    const failingSavePage = await failingSaveContext.newPage()
    await failingSavePage.route('**/api/**', (route) => {
      const request = route.request()
      if (
        new URL(request.url()).pathname === '/api/projects' &&
        request.method() === 'POST'
      ) {
        return route.fulfill({ status: 503, body: 'offline' })
      }
      return mockApi(route, true)
    })
    await failingSavePage.goto('/')
    await failingSavePage.getByLabel('Project name').fill('Unsaved route exit')
    await failingSavePage.getByRole('button', { name: 'Pricing' }).click()
    await expect(failingSavePage.getByRole('button', { name: 'Retry save' })).toBeVisible()
    await assertInteractionContract(failingSavePage, 'failed route autosave', observed)
    await failingSavePage.getByRole('button', { name: 'Discard changes' }).click()
    await expect(failingSavePage).toHaveURL(/\/pricing/)
    await failingSaveContext.close()

    const firstRunContext = await browser.newContext({
      baseURL: origin,
      storageState: { cookies: [], origins: [] },
    })
    const firstRunPage = await firstRunContext.newPage()
    await firstRunPage.route('**/api/**', (route) => mockApi(route, false))
    await firstRunPage.goto('/')
    await expect(firstRunPage.getByRole('dialog')).toBeVisible()
    await assertInteractionContract(firstRunPage, 'first-run onboarding step 1', observed)

    await firstRunPage.getByRole('button', { name: 'Next' }).click()
    await assertInteractionContract(firstRunPage, 'first-run onboarding step 2', observed)
    await firstRunPage.getByRole('button', { name: 'Back' }).click()
    await firstRunPage.getByRole('button', { name: 'Next' }).click()
    await firstRunPage.getByRole('button', { name: 'Next' }).click()
    await assertInteractionContract(firstRunPage, 'first-run onboarding final step', observed)
    await firstRunContext.close()

    const missing = interactionManifest
      .map(({ id }) => id)
      .filter((id) => !observed.has(id))
      .sort()
    expect(missing, 'manifest interactions not observed in a rendered production state').toEqual([])
  })
})
