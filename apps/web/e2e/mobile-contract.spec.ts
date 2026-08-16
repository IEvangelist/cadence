import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Route } from '@playwright/test'
import { returningProjectStorage } from './projectFixtures'

interface Point {
  x: number
  y: number
}

async function touchGesture(
  page: Page,
  points: readonly Point[],
  cancel = false,
): Promise<void> {
  if (points.length === 0) throw new Error('Touch gesture needs a point')
  const session = await page.context().newCDPSession(page)
  const touchPoint = (point: Point) => ({
    ...point,
    id: 1,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  })
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touchPoint(points[0])],
  })
  for (const point of points.slice(1)) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touchPoint(point)],
    })
    await page.waitForTimeout(16)
  }
  await session.send('Input.dispatchTouchEvent', {
    type: cancel ? 'touchCancel' : 'touchEnd',
    touchPoints: [],
  })
  await session.detach()
}

async function center(locator: ReturnType<Page['locator']>): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Touch target is not rendered')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function openTask(page: Page, task: 'Project' | 'Tracks' | 'Tools') {
  await page.getByRole('button', { name: new RegExp(`^${task}:`) }).click()
  return page.getByTestId(`mobile-${task.toLowerCase()}-sheet`)
}

async function visibleEmptyGridPoint(page: Page): Promise<Point> {
  return page.locator('.pr-scroll').evaluate((scroll) => {
    const rect = scroll.getBoundingClientRect()
    for (let y = rect.bottom - 24; y >= rect.top + 24; y -= 16) {
      for (let x = rect.right - 24; x >= rect.left + 72; x -= 16) {
        const target = document.elementFromPoint(x, y)
        if (target instanceof HTMLElement && target.classList.contains('pr-grid')) {
          return { x, y }
        }
      }
    }
    throw new Error('No visible empty piano-roll grid point')
  })
}

async function mockAnonymousApi(route: Route): Promise<void> {
  const path = new URL(route.request().url()).pathname
  if (path === '/api/auth/me') {
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' })
    return
  }
  if (path === '/api/auth/providers') {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ providers: ['GitHub'] }),
    })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
}

test.describe('production mobile Studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((entries) => {
      for (const entry of entries) localStorage.setItem(entry.name, entry.value)
      localStorage.setItem('cadence.v1.onboarding.seen', '1')
      ;(window as unknown as { __CADENCE_AI_MOCK__: boolean }).__CADENCE_AI_MOCK__ = true
    }, returningProjectStorage)
    await page.route('**/api/**', mockAnonymousApi)
    await page.goto('/')
    await expect(page.locator('[data-mobile-studio]')).toBeVisible()
  })

  test('navigates real Project, Tracks, Notes, Tools, Mix, and Help surfaces', async ({
    page,
  }) => {
    const project = await openTask(page, 'Project')
    await expect(project.getByRole('group', { name: 'Project toolbar' })).toBeVisible()
    await project.getByRole('button', { name: 'Save' }).click()
    await project.getByRole('button', { name: 'Project', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'New project' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open project' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Import file' })).toBeVisible()
    await page.keyboard.press('Escape')
    await project.getByRole('button', { name: 'Export & share' }).click()
    await expect(page.getByRole('menuitem', { name: 'Share snapshot' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Export MIDI' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Close Project' }).click()

    const tracks = await openTask(page, 'Tracks')
    await expect(tracks.getByRole('region', { name: 'Tracks' })).toBeVisible()
    await tracks.getByRole('button', { name: /Choose instrument for Synth/ }).click()
    const browser = page.getByRole('region', { name: 'Instrument browser' })
    await expect(browser).toBeVisible()
    const fm = browser.getByRole('option', { name: /FM Synth/ })
    await fm.click()
    await expect(
      tracks.getByRole('region', { name: 'Track inspector' }).getByText('FM Synth'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close Tracks' }).click()

    const tools = await openTask(page, 'Tools')
    await expect(tools.getByRole('region', { name: 'AI tools' })).toBeVisible()
    await tools.getByRole('button', { name: 'Mix', exact: true }).click()
    await page.getByRole('button', { name: 'Close Tools' }).click()
    await expect(page.getByRole('region', { name: 'Mix workspace' })).toBeVisible()
    await openTask(page, 'Tools')
    await page.getByRole('button', { name: 'Write', exact: true }).click()
    await page.getByRole('button', { name: 'Close Tools' }).click()
    await expect(page.getByRole('application', { name: /Note grid/ })).toBeVisible()

    await page.getByRole('button', { name: /Help and keyboard shortcuts/ }).click()
    await expect(page.getByTestId('mobile-help-sheet')).toBeVisible()
    await expect(page.getByText('Shift + Left/Right')).toBeVisible()
  })

  test('uses touch-safe note modes, precise edits, transport, and attached keyboard', async ({
    page,
  }) => {
    await openTask(page, 'Project')
    await page.getByRole('button', { name: 'Close Project' }).click()
    await page.getByRole('button', { name: /^Notes:/ }).click()
    const controlsBox = await page.locator('.mobile-note-header').boundingBox()
    const pianoBox = await page.locator('.piano-roll').boundingBox()
    expect(controlsBox).not.toBeNull()
    expect(pianoBox).not.toBeNull()
    expect(controlsBox!.height).toBeGreaterThan(0)
    expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(
      pianoBox!.y + 1,
    )
    const notesBefore = await page.locator('.pr-note:not(.is-preview)').count()
    const empty = await visibleEmptyGridPoint(page)

    await page.touchscreen.tap(empty.x, empty.y)
    await expect(page.locator('.pr-note:not(.is-preview)')).toHaveCount(notesBefore)
    await touchGesture(page, [empty, { x: empty.x - 70, y: empty.y }])
    await expect(page.locator('.pr-note:not(.is-preview)')).toHaveCount(notesBefore)

    await page.getByRole('button', { name: 'Draw', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await page.touchscreen.tap(empty.x, empty.y)
    await expect(page.locator('.pr-note:not(.is-preview)')).toHaveCount(notesBefore + 1)
    const drawDrag = { x: empty.x, y: empty.y - 32 }
    await touchGesture(page, [drawDrag, { x: drawDrag.x - 70, y: drawDrag.y }])
    await expect(page.locator('.pr-note:not(.is-preview)')).toHaveCount(notesBefore + 1)

    await page.getByRole('button', { name: 'Pan/Select' }).click()
    const note = page.locator('.pr-note:not(.is-preview)').first()
    await note.scrollIntoViewIfNeeded()
    const hitTarget = await note.evaluate((element) => {
      const style = getComputedStyle(element, '::before')
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      }
    })
    expect(hitTarget.width).toBeGreaterThanOrEqual(44)
    expect(hitTarget.height).toBeGreaterThanOrEqual(44)
    const selectPoint = await center(note)
    await page.touchscreen.tap(selectPoint.x, selectPoint.y)
    await expect(note).toHaveAttribute('aria-pressed', 'true')
    const editSelected = page.getByRole('button', { name: 'Edit selected note' })
    const editHit = await editSelected.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        return {
          matches: hit === element || element.contains(hit),
          hit: hit instanceof HTMLElement
            ? `${hit.tagName}.${hit.className}`
            : String(hit),
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        }
      })
    expect(editHit.matches, JSON.stringify(editHit)).toBe(true)
    const noteStart = await center(note)
    await touchGesture(page, [noteStart, { x: noteStart.x + 48, y: noteStart.y }])
    await expect(note).toHaveAttribute('aria-pressed', 'true')
    const cancelStart = await center(note)
    await touchGesture(
      page,
      [cancelStart, { x: cancelStart.x + 48, y: cancelStart.y }],
      true,
    )
    await expect(note).toBeVisible()
    expect(
      await note.evaluate((element) =>
        Number.isFinite(Number.parseFloat((element as HTMLElement).style.left)),
      ),
    ).toBe(true)

    await editSelected.click()
    const editor = page.getByTestId('selected-note-sheet')
    const controls = editor.locator('button, input')
    expect(
      (await controls.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().height),
      )).every((height) => height >= 44),
    ).toBe(true)
    await editor.getByRole('button', { name: 'Increase Pitch' }).click()
    await editor.getByRole('button', { name: 'Increase Start' }).click()
    await editor.getByRole('button', { name: 'Increase Duration' }).click()
    await editor.getByRole('button', { name: 'Decrease Velocity' }).click()
    await page.getByRole('button', { name: 'Close Selected note' }).click()

    await page.getByRole('button', { name: 'Play' }).click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.getByRole('button', { name: 'Loop' }).click()
    await page.getByRole('spinbutton', { name: 'Tempo' }).fill('126')
    await page.getByRole('combobox', { name: 'Snap' }).selectOption('0.5')

    const grid = page.getByRole('application', { name: /Note grid/ })
    await grid.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.pr-note:not(.is-preview)')).toHaveCount(notesBefore + 2)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Delete')
    await expect(page.locator('.pr-note:not(.is-preview)')).toHaveCount(notesBefore + 1)
  })

  test('reviews Basic AI and stays axe-clean without root overflow', async ({ page }) => {
    const tools = await openTask(page, 'Tools')
    const assistant = tools.getByRole('region', { name: 'AI Assistant' })
    await assistant.getByRole('radio', { name: /Generate melody/ }).check()
    await assistant.getByRole('button', { name: 'Generate' }).click()
    await expect(assistant.getByRole('button', { name: 'Discard' })).toBeVisible()
    await assistant.getByRole('button', { name: 'Discard' }).click()
    await assistant.getByRole('button', { name: 'Generate' }).click()
    await assistant.getByRole('button', { name: 'Accept' }).click()

    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      touchPoints: navigator.maxTouchPoints,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    expect(dimensions).toMatchObject({ width: 390, height: 844 })
    expect(dimensions.touchPoints).toBeGreaterThan(0)
    expect(dimensions.overflow).toBeLessThanOrEqual(1)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})

test.describe('production mobile auth and profile', () => {
  test('opens sign-in and renders the authenticated Profile route at 390px', async ({
    page,
  }) => {
    const user = {
      id: 'u1',
      email: 'ada@example.com',
      displayName: 'Ada',
      tier: 'Pro',
    }
    const profile = {
      ...user,
      bio: 'Composer',
      avatarUrl: null,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    }
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(user),
        })
        return
      }
      if (path === '/api/profile') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(profile),
        })
        return
      }
      if (path === '/api/auth/providers') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{"providers":["GitHub"]}',
        })
        return
      }
      if (path === '/api/entitlements') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ tier: 'Pro', watermarkExports: false }),
        })
        return
      }
      if (path === '/api/projects') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible()
    await expect(page.getByLabel('Display name')).toHaveValue('Ada')
    await expect(page.getByLabel('Avatar URL')).toHaveAttribute('aria-describedby')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)
  })
})
