import { expect, test, type Page } from '@playwright/test'
import {
  defaultProjectDetailDto,
  defaultProjectSummaryDto,
  returningProjectStorage,
} from './projectFixtures'

const studioViewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
]

async function documentHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight)
}

async function expectInsideViewport(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual((await page.viewportSize())!.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual((await page.viewportSize())!.height + 1)
}

async function expectIndependentScroll(page: Page, owner: string): Promise<void> {
  const surface = page.locator(`[data-studio-scroll="${owner}"]`)
  const result = await surface.evaluate((element, ownerName) => {
    const target = element as HTMLElement
    const root = document.documentElement
    const documentHeight = root.scrollHeight
    const rootScrollTop = root.scrollTop
    const probe = document.createElement('div')
    probe.dataset.testScrollProbe = ownerName
    probe.style.width = '1px'
    probe.style.height = `${target.clientHeight + 128}px`
    probe.style.pointerEvents = 'none'
    target.append(probe)
    target.scrollTop = 64

    return {
      clientHeight: target.clientHeight,
      scrollHeight: target.scrollHeight,
      scrollTop: target.scrollTop,
      documentHeight,
      documentHeightAfter: root.scrollHeight,
      rootScrollTop,
      rootScrollTopAfter: root.scrollTop,
    }
  }, owner)

  expect(result.scrollHeight).toBeGreaterThan(result.clientHeight)
  expect(result.scrollTop).toBeGreaterThan(0)
  expect(result.documentHeightAfter).toBe(result.documentHeight)
  expect(result.rootScrollTopAfter).toBe(result.rootScrollTop)
}

test.describe('professional Studio frame', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((entries) => {
      for (const entry of entries) localStorage.setItem(entry.name, entry.value)
    }, returningProjectStorage)
  })

  for (const viewport of studioViewports) {
    test(`${viewport.width}x${viewport.height} owns one viewport with internal scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      const frame = page.locator('[data-studio-workbench]')
      await expect(frame).toBeVisible()
      await expect(page.locator('footer')).toHaveCount(0)
      await expectInsideViewport(page, '.piano-roll')
      expect(await documentHeight(page)).toBeLessThanOrEqual(viewport.height + 1)

      for (const owner of ['rail', 'editor']) {
        const surface = page.locator(`[data-studio-scroll="${owner}"]`)
        await expect(surface).toBeVisible()
        await expect(surface).toHaveCSS('overflow-y', 'auto')
        await expectIndependentScroll(page, owner)
      }

      const heightBeforeInspector = await documentHeight(page)
      await page.locator('[data-interaction="studio.inspector.toggle"]').click()
      const inspector = page.locator('[data-studio-scroll="inspector"]')
      await expect(inspector).toBeVisible()
      await expect(inspector).toHaveCSS('overflow-y', 'auto')
      await expectInsideViewport(page, '[data-studio-scroll="inspector"]')
      await expectIndependentScroll(page, 'inspector')
      expect(await documentHeight(page)).toBe(heightBeforeInspector)
    })
  }

  test('keeps the tablet editor in place while the inspector overlays it', async ({ page }) => {
    const viewport = { width: 1024, height: 768 }
    await page.setViewportSize(viewport)
    await page.goto('/')

    const editor = page.locator('[data-studio-scroll="editor"]')
    await expect(editor).toBeVisible()
    const editorBefore = await editor.boundingBox()
    const heightBeforeInspector = await documentHeight(page)

    await page.locator('[data-interaction="studio.inspector.toggle"]').click()
    const inspector = page.locator('[data-studio-scroll="inspector"]')
    await expect(inspector).toBeVisible()
    await expect(editor).toBeVisible()

    const editorAfter = await editor.boundingBox()
    const inspectorBox = await inspector.boundingBox()
    expect(editorAfter).toEqual(editorBefore)
    expect(inspectorBox).not.toBeNull()
    expect(inspectorBox!.y).toBe(editorAfter!.y)
    expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(viewport.width + 1)
    expect(await documentHeight(page)).toBe(heightBeforeInspector)
  })

  test('keeps the piano roll reachable through mobile document scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await expect(page.locator('[data-studio-workbench]')).toBeVisible()

    const dimensions = await page.evaluate(() => ({
      innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      overflow: getComputedStyle(document.querySelector('.app--composer')!).overflow,
    }))
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.innerHeight)
    expect(dimensions.overflow).toBe('visible')
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1)

    await expect(page.getByRole('button', { name: 'Project', exact: true })).toBeInViewport()

    const roll = page.locator('.piano-roll')
    await roll.scrollIntoViewIfNeeded()
    await expect(roll).toBeInViewport()
  })

  test('keeps default chrome concise and ordered before the editor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.locator('[data-studio-workbench]')).toBeVisible()

    const scopes: string[] = []
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null
        if (!active) return 'none'
        if (active.matches('.skip-link')) return 'skip'
        if (active.closest('[data-studio-cluster="project"]')) return 'project'
        if (active.closest('[data-studio-cluster="transport"]')) return 'transport'
        if (active.closest('[data-studio-scroll="rail"]')) return 'rail'
        if (active.closest('[data-studio-scroll="editor"]')) return 'editor'
        if (active.matches('[data-interaction="studio.inspector.toggle"]')) return 'inspector-toggle'
        if (active.closest('[data-studio-cluster="utility"]')) return 'utility'
        return active.getAttribute('data-interaction') ?? active.tagName.toLowerCase()
      })
      scopes.push(focused)
      if (focused === 'editor') break
    }

    expect(scopes[0]).toBe('skip')
    expect(scopes.indexOf('project')).toBeGreaterThan(scopes.indexOf('skip'))
    expect(scopes.indexOf('transport')).toBeGreaterThan(scopes.indexOf('project'))
    expect(scopes.indexOf('rail')).toBeGreaterThan(scopes.indexOf('transport'))
    expect(scopes.indexOf('editor')).toBeGreaterThan(scopes.indexOf('rail'))
    expect(scopes.indexOf('editor')).toBeLessThan(24)
  })

  test('keeps Project controls above the transport hit target at 1440px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const projectCluster = page.locator('[data-studio-cluster="project"]')
    const transportCluster = page.locator('[data-studio-cluster="transport"]')
    const projectBox = await projectCluster.boundingBox()
    const transportBox = await transportCluster.boundingBox()
    expect(projectBox).not.toBeNull()
    expect(transportBox).not.toBeNull()
    expect(projectBox!.x + projectBox!.width).toBeLessThanOrEqual(transportBox!.x)

    const controls = projectCluster.locator(
      'button:visible, input:visible:not([type="file"]):not(.visually-hidden)',
    )
    for (let index = 0; index < await controls.count(); index += 1) {
      const control = controls.nth(index)
      const box = await control.boundingBox()
      const label = await control.getAttribute('aria-label') ?? await control.textContent()
      expect(box).not.toBeNull()
      expect(box!.x).toBeGreaterThanOrEqual(projectBox!.x)
      expect(
        box!.x + box!.width,
        `${label ?? 'Project control'} is clipped by the Project cluster`,
      ).toBeLessThanOrEqual(projectBox!.x + projectBox!.width)

      const hitIsControl = await control.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )
        return hit === element || element.contains(hit)
      })
      expect(hitIsControl, `${label ?? 'Project control'} is not hit-testable`).toBe(true)
    }
  })

  test('keeps transport and utility controls separated at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    const transport = page.locator('[data-studio-cluster="transport"]')
    const utilities = page.locator('.studio-frame__utilities')
    const transportBox = await transport.boundingBox()
    const utilityBox = await utilities.boundingBox()
    const transportWidths = await transport.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    expect(transportBox).not.toBeNull()
    expect(utilityBox).not.toBeNull()
    expect(transportBox!.x + transportBox!.width).toBeLessThanOrEqual(utilityBox!.x)
    expect(
      transportWidths.scroll,
      `transport scroll width ${transportWidths.scroll} exceeds ${transportWidths.client}`,
    ).toBeLessThanOrEqual(transportWidths.client + 1)

    for (const name of ['Mix', 'Tracks', 'Inspector', 'Help']) {
      const control = page.getByRole('button', { name, exact: true })
      const hitIsControl = await control.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        )
        return hit === element || element.contains(hit)
      })
      expect(hitIsControl, `${name} is not hit-testable at 1280px`).toBe(true)
    }
  })

  for (const width of [1199, 1200, 1280, 1365, 1366]) {
    test(`keeps authenticated utility controls hit-testable at ${width}px`, async ({ page }) => {
      await page.route('**/api/**', async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const json = (body: unknown, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
        if (path === '/api/auth/me') {
          return json({ id: 'studio-user', email: 'studio@example.com', displayName: 'Studio User' })
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
        if (path === '/api/projects' && request.method() === 'GET') {
          return json([defaultProjectSummaryDto])
        }
        if (path === `/api/projects/${defaultProjectSummaryDto.id}`) {
          return json(defaultProjectDetailDto)
        }
        if (path.endsWith('/shares')) return json([])
        return json({}, request.method() === 'GET' ? 200 : 204)
      })
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible()

      for (const name of ['Mix', 'Tracks', 'Inspector', 'Help', 'Profile']) {
        const control = page.getByRole('button', { name, exact: true })
        const hitIsControl = await control.evaluate((element) => {
          element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          const box = element.getBoundingClientRect()
          const hit = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          )
          return hit === element || element.contains(hit)
        })
        expect(hitIsControl, `${name} is not hit-testable for authenticated chrome`).toBe(true)
      }
    })
  }

  test('preserves Write editing state across repeated Mix switches', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Inspector' }).click()
    await page.getByRole('tab', { name: 'Track', exact: true }).click()
    const showAllTracks = page.locator('[data-interaction="studio.track.visibility-all"]')
    await showAllTracks.click()
    await expect(showAllTracks).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Inspector' }).click()

    const roll = page.locator('.pr-scroll')
    const editorViewport = page.locator('[data-studio-scroll="editor"]')
    const grid = page.getByRole('application', { name: /Note grid/ })
    const note = page.locator('.pr-note:not(.is-ghost)').first()
    await note.click()
    const velocity = page.locator('.pr-vel-bar').first()
    const velocityBefore = await velocity.getAttribute('aria-label')
    await velocity.focus()
    await page.keyboard.press('ArrowDown')
    const velocityAfter = await velocity.getAttribute('aria-label')
    expect(velocityAfter).not.toBe(velocityBefore)

    await grid.focus()
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowUp')
    const caret = page.locator('.pr-caret')
    await note.click()
    await expect(note).toHaveClass(/is-selected/)

    for (let step = 0; step < 3; step += 1) {
      await page.getByRole('button', { name: 'Zoom in horizontally (time)' }).click()
    }
    for (let step = 0; step < 8; step += 1) {
      await page.getByRole('button', { name: 'Zoom in vertically (pitch)' }).click()
    }
    const caretStyle = await caret.getAttribute('style')
    const zoom = await page.locator('.pr-zoom-readout').textContent()
    const horizontalExtent = await roll.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }))
    const verticalExtent = await editorViewport.evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
    }))
    expect(horizontalExtent.scroll).toBeGreaterThan(horizontalExtent.client + 20)
    expect(verticalExtent.scroll).toBeGreaterThan(verticalExtent.client + 20)
    await roll.evaluate((element) => {
      element.scrollLeft = 240
    })
    await editorViewport.evaluate((element) => {
      element.scrollTop = 500
    })
    const horizontalScroll = await roll.evaluate((element) => element.scrollLeft)
    const verticalScroll = await editorViewport.evaluate((element) => element.scrollTop)
    expect(horizontalScroll).toBeGreaterThan(20)
    expect(
      verticalScroll,
      'editor viewport did not establish substantive vertical scroll',
    ).toBeGreaterThan(20)

    const writeSurface = page.locator('[data-studio-surface="write"]')
    const mixSurface = page.locator('[data-studio-surface="mix"]')

    for (let pass = 0; pass < 2; pass += 1) {
      await page.getByRole('button', { name: 'Mix', exact: true }).click()
      const mixer = page.getByRole('region', { name: 'Mixer' })
      await expect(mixer).toBeVisible()
      await expect(writeSurface).toBeHidden()
      await expect(writeSurface).toHaveAttribute('inert', '')
      await expect(mixSurface).not.toHaveAttribute('inert')
      const mixControl = mixer.getByRole('slider').first()
      await mixControl.focus()
      await expect(mixControl).toBeFocused()
      await page.getByRole('button', { name: 'Mix', exact: true }).focus()
      await page.keyboard.press('Tab')
      expect(
        await page.evaluate(() =>
          Boolean(document.activeElement?.closest('[data-studio-surface="write"]')),
        ),
      ).toBe(false)
      await page.getByRole('button', { name: 'Write', exact: true }).click()
      await expect(writeSurface).toBeVisible()
      await expect(writeSurface).not.toHaveAttribute('inert')
      await expect(mixSurface).toHaveAttribute('inert', '')
    }

    await expect(page.locator('.pr-zoom-readout')).toHaveText(zoom ?? '')
    await expect(note).toHaveClass(/is-selected/)
    await expect(velocity).toHaveAttribute('aria-label', velocityAfter ?? '')
    await expect(caret).toHaveAttribute('style', caretStyle ?? '')
    await expect.poll(() => roll.evaluate((element) => element.scrollLeft)).toBe(horizontalScroll)
    await expect.poll(() => editorViewport.evaluate((element) => element.scrollTop)).toBe(
      verticalScroll,
    )
    await page.getByRole('button', { name: 'Inspector' }).click()
    await page.getByRole('tab', { name: 'Track', exact: true }).click()
    await expect(page.locator('[data-interaction="studio.track.visibility-all"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  test('keeps the informational footer off Studio and available on routed pages', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('footer')).toHaveCount(0)

    await page.goto('/licenses')
    await expect(page.locator('footer')).toBeVisible()
  })
})
