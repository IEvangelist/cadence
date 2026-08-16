import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'

test.skip(
  process.env.CADENCE_MOBILE_HARNESS !== '1',
  'Runs through a temporary worktree-only Playwright config until upstream integration.',
)

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
})

interface Point {
  x: number
  y: number
}

async function pointInside(
  locator: Locator,
  offset: Point = { x: 0.5, y: 0.5 },
): Promise<Point> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Touch target has no bounding box')
  return {
    x: box.x + box.width * offset.x,
    y: box.y + box.height * offset.y,
  }
}

async function touchGesture(
  page: Page,
  points: readonly Point[],
  touchId = 1,
  cancel = false,
  afterStart?: () => Promise<void>,
) {
  if (points.length === 0) throw new Error('A touch gesture needs at least one point')
  const session = await page.context().newCDPSession(page)
  const touchPoint = (point: Point) => ({
    ...point,
    id: touchId,
    radiusX: 1,
    radiusY: 1,
    force: 1,
  })

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touchPoint(points[0])],
  })
  await afterStart?.()
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

async function openHarness(page: Page) {
  await page.goto('/mobile-harness.html')
  await expect(page.getByRole('application', { name: 'Mobile note grid' })).toBeVisible()
}

test.describe('mobile touch contract', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page)
  })

  test('empty Pan/Select drag pans without creating a note', async ({ page }) => {
    const grid = page.getByTestId('note-grid')
    const start = await pointInside(grid, { x: 0.35, y: 0.7 })
    await touchGesture(page, [start, { x: start.x - 80, y: start.y }])

    await expect(page.locator('[data-note-id]')).toHaveCount(1)
    await expect
      .poll(() => page.getByTestId('piano-scroll').evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0)
  })

  test('empty Pan/Select tap never creates a note', async ({ page }) => {
    const grid = page.getByTestId('note-grid')
    await touchGesture(page, [await pointInside(grid, { x: 0.35, y: 0.7 })])

    await expect(page.locator('[data-note-id]')).toHaveCount(1)
  })

  test('Draw tap adds exactly one note and Draw drag does not add', async ({ page }) => {
    await page.getByRole('button', { name: 'Draw', exact: true }).click()
    const grid = page.getByTestId('note-grid')

    const tap = await pointInside(grid, { x: 0.35, y: 0.7 })
    await touchGesture(page, [tap])
    await expect(page.locator('[data-note-id]')).toHaveCount(2)

    const drag = await pointInside(grid, { x: 0.4, y: 0.75 })
    await touchGesture(page, [drag, { x: drag.x - 60, y: drag.y }], 2)
    await expect(page.locator('[data-note-id]')).toHaveCount(2)
  })

  test('note tap selects, drag moves, and cancel restores valid state', async ({ page }) => {
    const note = page.locator('[data-note-id="note-1"]')
    await touchGesture(page, [await pointInside(note)], 4)
    await expect(note).toHaveAttribute('aria-pressed', 'true')

    const originalStart = await note.getAttribute('data-start')
    const dragStart = await pointInside(note)
    const grid = page.getByTestId('note-grid')
    await touchGesture(
      page,
      [dragStart, { x: dragStart.x + 48, y: dragStart.y }],
      5,
      false,
      async () => {
        const harness = page.locator('.mobile-harness')
        await expect(harness).toHaveAttribute('data-captured-pointer', /\d+/)
        const pointerId = Number(await harness.getAttribute('data-captured-pointer'))
        expect(
          await note.evaluate((element, id) => element.hasPointerCapture(id), pointerId),
        ).toBe(true)

        await grid.dispatchEvent('pointerdown', {
          bubbles: true,
          pointerId: pointerId + 100,
          pointerType: 'touch',
          clientX: dragStart.x + 80,
          clientY: dragStart.y + 80,
          isPrimary: false,
        })
        await expect(harness).toHaveAttribute(
          'data-captured-pointer',
          String(pointerId),
        )
      },
    )
    expect(originalStart).toBe('2')
    await expect(note).toHaveAttribute('data-start', '3')
    await expect(note).toHaveAttribute('data-pitch', '60')

    const movedStart = await note.getAttribute('data-start')
    const cancelStart = await pointInside(note)
    await touchGesture(
      page,
      [cancelStart, { x: cancelStart.x + 48, y: cancelStart.y }],
      6,
      true,
    )
    await expect(note).toHaveAttribute('data-start', movedStart ?? '')
    await expect(page.locator('.mobile-harness')).not.toHaveAttribute(
      'data-captured-pointer',
    )
  })

  test('selected-note sheet edits precise values and deletes', async ({ page }) => {
    const note = page.locator('[data-note-id="note-1"]')
    await touchGesture(page, [await pointInside(note)], 7)
    await page.getByRole('button', { name: 'Edit selected note' }).click()
    const editorControls = page.getByTestId('selected-note-sheet').locator('button, input')
    const controlHeights = await editorControls.evaluateAll((controls) =>
      controls.map((control) => control.getBoundingClientRect().height),
    )
    expect(controlHeights.every((height) => height >= 44)).toBe(true)

    await page.getByRole('button', { name: 'Increase Pitch' }).click()
    await page.getByRole('button', { name: 'Increase Start' }).click()
    await page.getByRole('button', { name: 'Increase Duration' }).click()
    await page.getByRole('button', { name: 'Decrease Velocity' }).click()
    await page.getByRole('button', { name: 'Close Selected note' }).click()

    await expect(note).toHaveAttribute('data-pitch', '61')
    await expect(note).toHaveAttribute('data-start', '2.25')
    await expect(note).toHaveAttribute('data-duration', '1.25')
    await expect(note).not.toHaveAttribute('data-velocity', '0.8')

    await page.getByRole('button', { name: 'Edit selected note' }).click()
    await page.getByRole('button', { name: 'Delete note' }).click()
    await expect(page.locator('[data-note-id]')).toHaveCount(0)
  })

  test('transport stays usable while Notes is active', async ({ page }) => {
    await page.getByRole('button', { name: 'Play' }).click()
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
    await page.getByRole('button', { name: 'Loop' }).click()
    await expect(page.getByRole('button', { name: 'Loop' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('attached keyboard add, nudge, resize, and delete still work', async ({ page }) => {
    const grid = page.getByRole('application', { name: 'Mobile note grid' })
    await grid.focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-note-id]')).toHaveCount(2)

    const note = page.locator('[data-note-id="note-1"]')
    await touchGesture(page, [await pointInside(note)], 8)
    await grid.focus()
    await page.keyboard.press('ArrowRight')
    await expect(note).toHaveAttribute('data-start', '2.25')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(note).toHaveAttribute('data-duration', '1.25')
    await page.keyboard.press('Delete')
    await expect(page.locator('[data-note-id="note-1"]')).toHaveCount(0)
    await page.keyboard.press('Enter')
    const ids = await page.locator('[data-note-id]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-note-id')),
    )
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('task sheets cover phone core and Basic AI review', async ({ page }) => {
    await page.getByRole('button', { name: /^Project:/ }).click()
    for (const action of ['Create', 'Open', 'Import', 'Save', 'Share', 'Export']) {
      await expect(page.getByRole('button', { name: action, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Close Project' }).click()

    await page.getByRole('button', { name: /^Tracks:/ }).click()
    await expect(page.getByRole('combobox', { name: 'Instrument' })).toBeVisible()
    await page.getByRole('button', { name: 'Close Tracks' }).click()

    await page.getByRole('button', { name: /^Tools:/ }).click()
    await page.getByRole('button', { name: 'Generate AI idea' }).click()
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible()
  })

  test('is axe-clean with no viewport-wide horizontal overflow', async ({ page }) => {
    const viewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      touchPoints: navigator.maxTouchPoints,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    expect(viewport).toMatchObject({ width: 390, height: 844 })
    expect(viewport.touchPoints).toBeGreaterThan(0)
    expect(viewport.overflow).toBeLessThanOrEqual(1)

    const scroll = page.getByTestId('piano-scroll')
    const dimensions = await scroll.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})
