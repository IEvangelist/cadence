import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import {
  interactionManifest,
  type InteractionManifestEntry,
} from '../src/test/interactionManifest'
import {
  defaultProjectDetailDto,
  defaultProjectSummaryDto,
} from './projectFixtures'
import {
  openAiInspectorMode,
  openInspectorPanel,
  openMixWorkspace,
  openStudioDestination,
} from './studioActions'

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
  if (path === '/api/projects' && method === 'GET') return json([defaultProjectSummaryDto])
  if (path === `/api/projects/${defaultProjectSummaryDto.id}` && method === 'GET') {
    return json(defaultProjectDetailDto)
  }
  if (path === '/api/projects' && method === 'POST') {
    const payload = request.postDataJSON()
    return json(
      {
        ...(payload as object),
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:01:00Z',
      },
      201,
    )
  }
  if (/^\/api\/projects\/[^/]+$/.test(path) && method === 'PUT') {
    const payload = request.postDataJSON()
    return json({
      ...(payload as object),
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:01:00Z',
    })
  }
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
    elements.map((element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        id: element.getAttribute('data-interaction'),
        visible:
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0,
      }
    }),
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
    const count = snapshot.filter((item) => item.id === id && item.visible).length
    if (count === 0) continue
    visibleCounts.set(id, count)
    if (observed.has(id)) continue

    const locator = page.locator(`[data-interaction="${id}"]:visible`).first()
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

test.describe('production interaction contract', () => {
  test.describe.configure({ timeout: 600_000 })

  test('observes every registered interaction across current production states', async ({
    page,
    browser,
    baseURL,
  }) => {
    const observed = new Set<string>()
    await page.addInitScript(() => {
      const inputs = [
        { id: 'contract-a', name: 'Contract Keys', onmidimessage: null },
        { id: 'contract-b', name: 'Contract Pads', onmidimessage: null },
      ]
      const access = {
        inputs: new Map(inputs.map((input) => [input.id, input])),
        outputs: new Map(),
        onstatechange: null,
        sysexEnabled: false,
      }
      let resolveAccess: ((value: typeof access) => void) | undefined
      const pending = new Promise<typeof access>((resolve) => {
        resolveAccess = resolve
      })
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => pending,
      })
      ;(window as unknown as { __resolveContractMidi?: () => void }).__resolveContractMidi =
        () => resolveAccess?.(access)
    })
    await page.route('**/api/**', (route) => mockApi(route, false))
    await page.goto('/')

    await assertInteractionContract(page, 'studio', observed)
    expect(observed.has('studio.midi.device')).toBe(false)
    expect(observed.has('studio.midi.quantize')).toBe(false)

    const midiSettings = page.getByRole('button', { name: 'MIDI', exact: true })
    await expect(midiSettings).toBeVisible({ timeout: 10_000 })
    await midiSettings.click()
    const midiDevice = page.getByRole('combobox', { name: 'MIDI device' })
    await expect(midiDevice).toBeDisabled()
    await page.evaluate(() => {
      ;(window as unknown as { __resolveContractMidi?: () => void }).__resolveContractMidi?.()
    })
    await expect(midiDevice).toBeEnabled()
    await expect(midiDevice).toHaveValue('contract-a')
    await midiDevice.selectOption('contract-b')
    await expect(midiDevice).toHaveValue('contract-b')
    await page.getByRole('checkbox', { name: 'Quantize while recording' }).check()
    await expect(page.getByRole('checkbox', { name: 'Quantize while recording' })).toBeChecked()
    await assertInteractionContract(page, 'MIDI settings', observed)
    expect(observed.has('studio.midi.device')).toBe(true)
    expect(observed.has('studio.midi.quantize')).toBe(true)
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Choose theme' }).click()
    await assertInteractionContract(page, 'theme menu', observed)
    await page.getByRole('menuitemradio', { name: 'System theme' }).click()

    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('dialog', { name: 'Sign in to Cadence' })).toBeVisible()
    await assertInteractionContract(page, 'auth sign-in', observed)
    await page.getByRole('button', { name: /Create an account/ }).click()
    await assertInteractionContract(page, 'auth registration', observed)
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    await openStudioDestination(page, 'Pricing')
    await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
    await assertInteractionContract(page, 'pricing', observed)

    await page.getByRole('button', { name: 'Back to composer' }).click()
    await openStudioDestination(page, 'Stems')
    await expect(page.getByRole('heading', { name: 'Stem separation' })).toBeVisible()
    await assertInteractionContract(page, 'stems free tier', observed)

    await page.getByRole('button', { name: 'Back to composer' }).click()
    await openStudioDestination(page, 'Third-party licenses')
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
    await openStudioDestination(freeUserPage, 'Stems')
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

    const instrumentInspector = await openInspectorPanel(authenticatedPage, 'Track')
    await instrumentInspector
      .getByRole('button', { name: /Choose instrument for/ })
      .click()
    await expect(
      authenticatedPage.getByRole('region', { name: 'Instrument browser' }),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'instrument browser', observed)
    await authenticatedPage
      .locator('[data-interaction="studio.instrument-browser.close"]')
      .click()

    await authenticatedPage.getByRole('button', { name: 'Shortcuts' }).click()
    await expect(
      authenticatedPage.getByRole('dialog', { name: 'Keyboard shortcuts' }),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'shortcut help', observed)
    await authenticatedPage
      .locator('[data-interaction="studio.shortcuts.close"]')
      .click()

    const note = authenticatedPage.locator('[data-interaction="studio.piano-roll.note"]').first()
    await note.click()
    await expect(
      authenticatedPage.locator('[data-interaction="studio.piano-roll.velocity.selected"]'),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'selected piano note', observed)

    await authenticatedPage.getByRole('button', { name: 'Add track' }).click()
    await authenticatedPage.getByRole('button', { name: 'Select Synth' }).click()
    await authenticatedPage.getByRole('button', { name: 'Delete Synth' }).click()
    await expect(
      authenticatedPage.getByRole('alertdialog', { name: /Delete Synth/ }),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'track delete confirmation', observed)
    await expect(
      authenticatedPage.getByRole('alertdialog', { name: /Delete Synth/ }).locator(':focus'),
    ).toHaveCount(1)
    await authenticatedPage.keyboard.press('Escape')
    await expect(
      authenticatedPage.getByRole('alertdialog', { name: /Delete Synth/ }),
    ).toHaveCount(0)
    await expect(
      authenticatedPage.getByRole('button', { name: 'Delete Synth' }),
    ).toBeFocused()
    await authenticatedPage.getByRole('button', { name: 'Delete Synth' }).click()
    await authenticatedPage.getByRole('button', { name: 'Cancel' }).click()
    await authenticatedPage.getByRole('button', { name: 'Delete Synth' }).click()
    await authenticatedPage
      .getByRole('button', { name: 'Delete track', exact: true })
      .click()
    await expect(authenticatedPage.getByRole('heading', { name: 'Tracks' })).toBeFocused()

    const shareToggle = authenticatedPage.locator('[data-interaction="studio.share.toggle"]')
    await shareToggle.click()
    await expect(authenticatedPage.getByRole('group', { name: 'Share links' })).toBeVisible()
    await expect(authenticatedPage.getByRole('button', { name: 'Copy link' })).toHaveCount(2)
    await expect(authenticatedPage.getByRole('button', { name: 'Revoke' })).toHaveCount(2)
    await assertInteractionContract(authenticatedPage, 'authenticated share panel', observed)
    await shareToggle.click()

    await authenticatedPage.getByRole('button', { name: 'Project', exact: true }).click()
    await assertInteractionContract(authenticatedPage, 'project menu open', observed)
    await authenticatedPage.getByRole('menuitem', { name: 'New project' }).click()
    await expect(authenticatedPage.getByRole('dialog', { name: 'Project browser' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'project browser open', observed)
    await authenticatedPage
      .getByRole('button', { name: 'Close project browser' })
      .click()

    await authenticatedPage.getByRole('button', { name: 'Export & share' }).click()
    await assertInteractionContract(authenticatedPage, 'export and share menu open', observed)
    await authenticatedPage.keyboard.press('Escape')

    const trackInspector = await openInspectorPanel(authenticatedPage, 'Track')
    await expect(
      trackInspector.getByRole('region', { name: 'Track inspector' }),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'track inspector', observed)

    const aiStudioHost = await openAiInspectorMode(authenticatedPage, 'Advanced')
    const aiStudio = aiStudioHost.getByRole('region', { name: 'AI Studio' })
    await expect(aiStudio.getByText('Pro · on-device')).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'AI Studio text to motif', observed)
    await aiStudio.getByRole('radio', { name: /Style transfer/ }).check()
    await assertInteractionContract(authenticatedPage, 'AI Studio style transfer', observed)
    await aiStudio.getByRole('radio', { name: /Groove & humanize/ }).check()
    await assertInteractionContract(authenticatedPage, 'AI Studio groove', observed)
    await aiStudio.getByRole('radio', { name: /Auto-master/ }).check()
    await assertInteractionContract(authenticatedPage, 'AI Studio auto-master', observed)

    const mixer = await openMixWorkspace(authenticatedPage)
    const firstStrip = mixer.locator('fieldset').first()
    await firstStrip.getByRole('button', { name: 'Add', exact: true }).click()
    const volumeAutomation = firstStrip.getByRole('group', { name: 'Volume automation' })
    await volumeAutomation.getByRole('button', { name: 'Add point' }).click()
    await expect(volumeAutomation.getByRole('button', { name: /Remove Volume point/ })).toBeVisible()
    await expect(
      volumeAutomation.getByRole('button', { name: 'Clear Volume automation' }),
    ).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'mixer with insert and automation', observed)

    const extensionHost = await openInspectorPanel(authenticatedPage, 'Extensions')
    const extensions = extensionHost.getByRole('region', { name: 'Extensions' })
    await extensions.getByRole('checkbox', { name: /Hello Cadence \(example\)/ }).check()
    await expect(authenticatedPage.getByRole('region', { name: 'Example plugin' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'extensions enabled', observed)

    await authenticatedPage.getByRole('button', { name: 'Project', exact: true }).click()
    await authenticatedPage.getByRole('menuitem', { name: 'New project' }).click()
    await authenticatedPage.getByRole('button', { name: /Blank project/ }).click()
    const write = authenticatedPage.getByRole('button', { name: 'Write', exact: true })
    const writeHit = await write.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const utility = element.closest('.studio-frame__utilities')?.getBoundingClientRect()
      const transport = document
        .querySelector('[data-studio-cluster="transport"]')
        ?.getBoundingClientRect()
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      return {
        hit: hit === element || element.contains(hit),
        rect: { left: rect.left, right: rect.right },
        utility: utility ? { left: utility.left, right: utility.right } : null,
        transport: transport ? { left: transport.left, right: transport.right } : null,
      }
    })
    expect(writeHit.hit, JSON.stringify(writeHit)).toBe(true)
    await write.click()
    await expect(authenticatedPage.getByText('Your canvas is empty.')).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'empty project', observed)

    const assistantHost = await openAiInspectorMode(authenticatedPage, 'Basic')
    const assistant = assistantHost.getByRole('region', { name: 'AI Assistant' })
    await assistant.getByRole('radio', { name: /Generate melody/ }).check()
    await assistant.getByRole('button', { name: 'Generate' }).click()
    await expect(assistant.getByRole('button', { name: 'Accept' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'assistant suggestion', observed)

    await openStudioDestination(authenticatedPage, 'Pricing')
    await expect(authenticatedPage.getByRole('button', { name: 'Manage billing' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'pricing pro tier', observed)

    await authenticatedPage.getByRole('button', { name: 'Profile' }).click()
    await expect(authenticatedPage.getByRole('heading', { name: 'Your profile' })).toBeVisible()
    await expect(authenticatedPage.getByRole('textbox', { name: 'Display name' })).toBeVisible()
    await assertInteractionContract(authenticatedPage, 'profile', observed)

    await authenticatedPage.getByRole('button', { name: 'Back to composer' }).click()
    await openStudioDestination(authenticatedPage, 'Stems')
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
    await openStudioDestination(failingSavePage, 'Pricing')
    await expect(
      failingSavePage.locator('[data-interaction="studio.autosave.retry"]'),
    ).toBeVisible()
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
    await expect(firstRunPage.getByRole('heading', { name: 'Start a project' })).toBeVisible()
    await assertInteractionContract(firstRunPage, 'first-run Start Center', observed)
    await firstRunPage.getByRole('button', { name: /Blank project/ }).click()
    await expect(firstRunPage.getByRole('dialog')).toBeVisible()
    await assertInteractionContract(firstRunPage, 'first-run onboarding step 1', observed)

    await firstRunPage.getByRole('button', { name: 'Next' }).click()
    await assertInteractionContract(firstRunPage, 'first-run onboarding step 2', observed)
    await firstRunPage.getByRole('button', { name: 'Back' }).click()
    await firstRunPage.getByRole('button', { name: 'Next' }).click()
    await firstRunPage.getByRole('button', { name: 'Next' }).click()
    await assertInteractionContract(firstRunPage, 'first-run onboarding final step', observed)
    await firstRunContext.close()

    const restoreErrorContext = await browser.newContext({
      baseURL: origin,
      storageState: returningStorage,
    })
    const restoreErrorPage = await restoreErrorContext.newPage()
    await restoreErrorPage.route('**/api/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (path === '/api/projects' && request.method() === 'GET') {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }
      return mockApi(route, true)
    })
    await restoreErrorPage.goto('/')
    await expect(
      restoreErrorPage.getByRole('heading', {
        name: 'Your last project could not be restored',
      }),
    ).toBeVisible()
    await assertInteractionContract(restoreErrorPage, 'restore error', observed)
    await restoreErrorPage
      .getByRole('button', { name: 'Continue to Start Center' })
      .click()
    await expect(restoreErrorPage.getByRole('button', { name: 'Retry' })).toBeVisible()
    await assertInteractionContract(
      restoreErrorPage,
      'restore error continued to Start Center',
      observed,
    )
    await restoreErrorContext.close()

    const saveErrorContext = await browser.newContext({
      baseURL: origin,
      storageState: returningStorage,
    })
    const saveErrorPage = await saveErrorContext.newPage()
    await saveErrorPage.route('**/api/**', async (route) => {
      const method = route.request().method()
      const path = new URL(route.request().url()).pathname
      if (
        (path === '/api/projects' && method === 'POST') ||
        (/^\/api\/projects\/[^/]+$/.test(path) && method === 'PUT')
      ) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      }
      return mockApi(route, true)
    })
    await saveErrorPage.goto('/')
    await saveErrorPage.getByLabel('Project name').fill('Unsaved interaction state')
    await expect(saveErrorPage.getByRole('button', { name: 'Retry save' })).toBeVisible()
    await assertInteractionContract(saveErrorPage, 'save error', observed)
    await saveErrorPage.getByRole('button', { name: 'Project', exact: true }).click()
    await saveErrorPage.getByRole('menuitem', { name: 'New project' }).click()
    await saveErrorPage.getByRole('button', { name: /Blank project/ }).click()
    await expect(saveErrorPage.getByRole('alertdialog')).toBeVisible()
    await assertInteractionContract(saveErrorPage, 'replacement flush error', observed)
    await saveErrorContext.close()

    const missing = interactionManifest
      .map(({ id }) => id)
      .filter((id) => !observed.has(id))
      .sort()
    expect(missing, 'manifest interactions not observed in a rendered production state').toEqual([])
  })
})
