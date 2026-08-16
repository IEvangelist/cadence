import { expect, test, type Page } from '@playwright/test'
import { returningProjectStorage } from './projectFixtures'

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
    expect(scopes.indexOf('editor')).toBeLessThan(20)
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
    ).toBeLessThanOrEqual(transportWidths.client)

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

  test('keeps the informational footer off Studio and available on routed pages', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('footer')).toHaveCount(0)

    await page.goto('/licenses')
    await expect(page.locator('footer')).toBeVisible()
  })
})
