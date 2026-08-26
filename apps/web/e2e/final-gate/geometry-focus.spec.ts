import { expect, test } from './audit-test'
import {
  buildDeterministicProject,
  installFinalGateFixture,
  openDeterministicProject,
} from './fixtures'
import { tabTo } from './keyboard'
import {
  assertDesktopViewportGeometry,
  collectGeometryReport,
} from './metrics'

interface AssistantParameterGeometry {
  bottom: number
  declaredGap: number
  expectedGap: number
  gap: number
  height: number
  top: number
  rows: Array<{
    bottom: number
    contentHeight: number
    height: number
    left: number
    name: string
    right: number
    top: number
    visible: boolean
    width: number
  }>
}

const mobileSafeArea = {
  top: 23,
  right: 17,
  bottom: 29,
  left: 19,
} as const

const expectedAssistantParameterGap = 8
const geometryTolerance = 1

const desktopViewports = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const

async function measureAssistantParameters(
  page: Parameters<typeof collectGeometryReport>[0],
): Promise<AssistantParameterGeometry> {
  return page
    .getByRole('region', { name: 'AI Assistant' })
    .locator('.assistant-params')
    .evaluate((params) => {
      const bounds = params.getBoundingClientRect()
      const rows = [...params.querySelectorAll<HTMLElement>(':scope > .field')].map(
        (row) => {
          const rowBounds = row.getBoundingClientRect()
          const contentHeight = Math.max(
            ...[...row.children].map(
              (child) => child.getBoundingClientRect().height,
            ),
          )
          return {
            bottom: rowBounds.bottom,
            contentHeight,
            height: rowBounds.height,
            left: rowBounds.left,
            name: row.textContent?.trim() ?? '',
            right: rowBounds.right,
            top: rowBounds.top,
            visible:
              getComputedStyle(row).visibility === 'visible' &&
              getComputedStyle(row).display !== 'none',
            width: rowBounds.width,
          }
        },
      )
      const styles = getComputedStyle(params)
      const spacingProbe = document.createElement('div')
      spacingProbe.style.cssText =
        'position:absolute;visibility:hidden;width:var(--space-2)'
      document.body.append(spacingProbe)
      const expectedGap = spacingProbe.getBoundingClientRect().width
      spacingProbe.remove()
      return {
        bottom: bounds.bottom,
        declaredGap: Number.parseFloat(styles.rowGap || styles.gap),
        expectedGap,
        gap: rows[1].top - rows[0].bottom,
        height: bounds.height,
        top: bounds.top,
        rows: rows.map(({ bottom, contentHeight, height, left, name, right, top, visible, width }) => ({
          bottom,
          contentHeight,
          height,
          left,
          name,
          right,
          top,
          visible,
          width,
        })),
      }
    })
}

function assertCompactAssistantParameters(
  geometry: AssistantParameterGeometry,
  state: string,
): void {
  expect(geometry.rows, `${state}: Temperature and Length rows`).toHaveLength(2)
  expect(geometry.declaredGap, `${state}: declared parameter gap`).toBeGreaterThanOrEqual(0)
  expect(geometry.expectedGap, `${state}: --space-2 pixel value`).toBe(
    expectedAssistantParameterGap,
  )
  expect(
    geometry.declaredGap,
    `${state}: declared parameter gap must stay compact`,
  ).toBeLessThanOrEqual(geometry.expectedGap + geometryTolerance)
  expect(
    Math.abs(geometry.declaredGap - geometry.expectedGap),
    `${state}: declared parameter gap must match --space-2`,
  ).toBeLessThanOrEqual(geometryTolerance)
  expect(geometry.gap, `${state}: rendered parameter gap cannot overlap`).toBeGreaterThanOrEqual(
    0,
  )
  expect(
    Math.abs(geometry.gap - geometry.declaredGap),
    `${state}: rendered parameter gap must match the declared CSS gap`,
  ).toBeLessThanOrEqual(
    geometryTolerance,
  )
  for (const row of geometry.rows) {
    expect(row.visible, `${state}: ${row.name} row must be rendered`).toBe(true)
    expect(row.width, `${state}: ${row.name} row width`).toBeGreaterThan(0)
    expect(row.height, `${state}: ${row.name} row height`).toBeGreaterThan(0)
    expect(row.bottom, `${state}: ${row.name} row bounds`).toBeGreaterThan(row.top)
    expect(row.top, `${state}: ${row.name} row starts inside parameters`).toBeGreaterThanOrEqual(
      geometry.top - 1,
    )
    expect(row.bottom, `${state}: ${row.name} row ends inside parameters`).toBeLessThanOrEqual(
      geometry.bottom + 1,
    )
    expect(
      row.height - row.contentHeight,
      `${state}: ${row.name} row has pathological empty height`,
    ).toBeLessThanOrEqual(8)
    expect(row.height, `${state}: ${row.name} row is not compact`).toBeLessThanOrEqual(48)
  }
  expect(
    geometry.height,
    `${state}: parameter group contains unexplained vertical space`,
  ).toBeLessThanOrEqual(
    geometry.rows.reduce((height, row) => height + row.height, 0) +
      geometry.declaredGap +
      geometryTolerance,
  )
}

test.describe('final Studio geometry and focus metrics', () => {
  for (const viewport of desktopViewports) {
    test(`${viewport.width}x${viewport.height} stays within 100dvh`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport)
      await installFinalGateFixture(page)
      await page.goto('/')
      await openDeterministicProject(page)
      await page.getByRole('button', { name: 'Inspector', exact: true }).click()

      const report = await collectGeometryReport(page, {
        workbench: '[data-studio-workbench]',
        rail: '[data-studio-scroll="rail"]',
        editor: '[data-studio-scroll="editor"]',
        inspector: '[data-studio-scroll="inspector"]',
        piano: '.piano-roll',
      })
      assertDesktopViewportGeometry(report, 'editor')

      for (const region of ['workbench', 'rail', 'editor', 'inspector', 'piano']) {
        expect(report.regions[region], `${region} geometry is missing`).not.toBeNull()
      }
      expect(report.regions.workbench?.height).toBeLessThanOrEqual(
        report.viewport.height + 1,
      )
      expect(report.regions.piano?.bottom).toBeLessThanOrEqual(
        report.viewport.height + 1,
      )

      await testInfo.attach(`studio-geometry-${viewport.width}x${viewport.height}`, {
        body: Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
        contentType: 'application/json',
      })
    })
  }

  test('editor enters the default focus order before twenty controls', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const defaultProject = buildDeterministicProject()
    defaultProject.tracks = defaultProject.tracks.slice(0, 1)
    await installFinalGateFixture(page, { project: defaultProject })
    await page.goto('/')
    await openDeterministicProject(page)

    const trace = await tabTo(
      page,
      page.locator('[data-studio-scroll="editor"]'),
      { maxTabs: 20 },
    )
    expect(trace[0]?.interactionId).toBe('app.skip-to-composer')
    expect(trace.length).toBeLessThanOrEqual(20)

    await testInfo.attach('studio-focus-order', {
      body: Buffer.from(`${JSON.stringify(trace, null, 2)}\n`),
      contentType: 'application/json',
    })
  })

  test('Assistant Temperature and Length stay compact in every action state', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await installFinalGateFixture(page)
    await page.goto('/')
    await openDeterministicProject(page)
    await page.getByRole('button', { name: 'Inspector', exact: true }).click()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()

    const assistant = page.getByRole('region', { name: 'AI Assistant' })
    const temperature = assistant.locator(
      '[data-interaction="studio.assistant.temperature"]',
    )
    const length = assistant.locator(
      '[data-interaction="studio.assistant.length"]',
    )
    const reports: Record<string, AssistantParameterGeometry> = {}

    for (const action of ['continue', 'generate', 'harmonize'] as const) {
      await assistant.locator(`input[name="assistant-action"][value="${action}"]`).check()
      if (action === 'harmonize') {
        await expect(temperature).toBeDisabled()
        await expect(length).toBeDisabled()
      } else {
        await expect(temperature).toBeEnabled()
        await expect(length).toBeEnabled()
      }
      reports[action] = await measureAssistantParameters(page)
      assertCompactAssistantParameters(reports[action], action)
    }

    await assistant.locator('input[name="assistant-action"][value="generate"]').check()
    const temperatureBefore = await temperature.inputValue()
    const lengthBefore = await length.inputValue()
    await temperature.focus()
    await page.keyboard.press('ArrowRight')
    await length.focus()
    await page.keyboard.press('ArrowRight')
    expect(await temperature.inputValue()).not.toBe(temperatureBefore)
    expect(await length.inputValue()).not.toBe(lengthBefore)
    await assistant.getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(
      assistant.getByRole('button', { name: 'Accept', exact: true }),
    ).toBeVisible()
    reports.suggestion = await measureAssistantParameters(page)
    assertCompactAssistantParameters(reports.suggestion, 'suggestion')

    const parameterGroup = assistant.locator('.assistant-params')
    await parameterGroup.evaluate((params) => {
      params.style.rowGap = '200px'
    })
    const oversized = await measureAssistantParameters(page)
    expect(oversized.declaredGap, 'mutation fixture must declare a huge gap').toBe(200)
    expect(oversized.gap, 'mutation fixture must render the huge gap').toBe(200)
    expect(() => assertCompactAssistantParameters(oversized, 'oversized mutation')).toThrow()
    await parameterGroup.evaluate((params) => {
      params.style.removeProperty('row-gap')
    })
    assertCompactAssistantParameters(
      await measureAssistantParameters(page),
      'restored oversized mutation',
    )

    const lengthRow = assistant.locator('.assistant-params > .field').nth(1)
    await lengthRow.evaluate((row) => {
      row.style.transform = 'translateY(-16px)'
    })
    const overlapping = await measureAssistantParameters(page)
    expect(overlapping.gap, 'mutation fixture must create a real overlap').toBeLessThan(0)
    expect(() => assertCompactAssistantParameters(overlapping, 'overlap mutation')).toThrow()
    await lengthRow.evaluate((row) => {
      row.style.removeProperty('transform')
    })
    assertCompactAssistantParameters(
      await measureAssistantParameters(page),
      'restored suggestion',
    )

    await testInfo.attach('assistant-parameter-geometry', {
      body: Buffer.from(`${JSON.stringify(reports, null, 2)}\n`),
      contentType: 'application/json',
    })
  })

  test('390x844 startup keeps guidance, creative surface, and tasks disjoint', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript((safeArea) => {
      const applySafeArea = () => {
        const root = document.documentElement
        if (!root) return false
        for (const [edge, inset] of Object.entries(safeArea)) {
          root.style.setProperty(`--mobile-safe-area-${edge}`, `${inset}px`)
        }
        return true
      }
      if (applySafeArea()) return
      const observer = new MutationObserver(() => {
        if (applySafeArea()) observer.disconnect()
      })
      observer.observe(document, { childList: true })
    }, mobileSafeArea)
    await installFinalGateFixture(page)
    await page.goto('/')

    const studio = page.locator('[data-mobile-studio]')
    const coach = page.getByRole('complementary', {
      name: 'Pan first, draw on purpose',
    })
    const creativeSurface = page.locator('.piano-roll')
    const taskNavigator = page.getByRole('navigation', {
      name: 'Composer tasks',
    })
    await expect(studio).toBeVisible()
    await expect(coach).toBeVisible()
    await expect(creativeSurface).toBeVisible()
    await expect(taskNavigator).toBeVisible()

    const startup = await page.evaluate((safeArea) => {
      const allowed = [
        '.mobile-studio__transport',
        '.mobile-studio__workspace',
        '.pr-scroll',
      ].join(',')
      const scrollable = [...document.querySelectorAll<HTMLElement>('body *')]
        .filter((element) => {
          const style = getComputedStyle(element)
          const scrollsX =
            ['auto', 'scroll'].includes(style.overflowX) &&
            element.scrollWidth > element.clientWidth + 1
          const scrollsY =
            ['auto', 'scroll'].includes(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1
          return scrollsX || scrollsY
        })
        .map((element) => ({
          className: element.className,
          intended: element.matches(allowed),
          tagName: element.tagName,
        }))
      const rootStyles = getComputedStyle(document.documentElement)
      const workspaceStyles = getComputedStyle(
        document.querySelector<HTMLElement>('.mobile-studio__workspace')!,
      )
      const navigatorStyles = getComputedStyle(
        document.querySelector<HTMLElement>('.mobile-task-nav')!,
      )

      return {
        bodyHeight: document.body.scrollHeight,
        bodyWidth: document.body.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        height: innerHeight,
        scrollY,
        scrollable,
        safeAreaVariables: Object.fromEntries(
          Object.keys(safeArea).map((edge) => [
            edge,
            Number.parseFloat(
              rootStyles.getPropertyValue(`--mobile-safe-area-${edge}`),
            ),
          ]),
        ),
        navigatorPadding: {
          bottom: Number.parseFloat(navigatorStyles.paddingBottom),
          left: Number.parseFloat(navigatorStyles.paddingLeft),
          right: Number.parseFloat(navigatorStyles.paddingRight),
        },
        workspacePadding: {
          left: Number.parseFloat(workspaceStyles.paddingLeft),
          right: Number.parseFloat(workspaceStyles.paddingRight),
        },
        width: innerWidth,
      }
    }, mobileSafeArea)
    expect(startup.scrollY).toBe(0)
    expect(startup.documentHeight).toBeLessThanOrEqual(startup.height + 1)
    expect(startup.bodyHeight).toBeLessThanOrEqual(startup.height + 1)
    expect(startup.documentWidth).toBeLessThanOrEqual(startup.width + 1)
    expect(startup.bodyWidth).toBeLessThanOrEqual(startup.width + 1)
    expect(
      startup.scrollable.filter(({ intended }) => !intended),
      'only declared Studio surfaces may scroll at startup',
    ).toEqual([])
    expect(startup.safeAreaVariables).toEqual(mobileSafeArea)
    expect(startup.workspacePadding.left).toBeGreaterThanOrEqual(mobileSafeArea.left)
    expect(startup.workspacePadding.right).toBeGreaterThanOrEqual(mobileSafeArea.right)
    expect(startup.navigatorPadding.left).toBeGreaterThanOrEqual(mobileSafeArea.left)
    expect(startup.navigatorPadding.right).toBeGreaterThanOrEqual(mobileSafeArea.right)
    expect(startup.navigatorPadding.bottom).toBeGreaterThanOrEqual(mobileSafeArea.bottom)

    const boxes = await Promise.all([
      coach.boundingBox(),
      creativeSurface.boundingBox(),
      taskNavigator.boundingBox(),
      taskNavigator.locator('.mobile-task-nav__button').first().boundingBox(),
      taskNavigator.locator('.mobile-task-nav__button').last().boundingBox(),
    ])
    const [coachBox, creativeBox, taskBox, firstTaskBox, lastTaskBox] = boxes
    expect(coachBox).not.toBeNull()
    expect(creativeBox).not.toBeNull()
    expect(taskBox).not.toBeNull()
    expect(firstTaskBox).not.toBeNull()
    expect(lastTaskBox).not.toBeNull()
    expect(coachBox!.y + coachBox!.height).toBeLessThanOrEqual(creativeBox!.y + 1)
    expect(coachBox!.y + coachBox!.height).toBeLessThanOrEqual(taskBox!.y + 1)
    expect(coachBox!.x).toBeGreaterThanOrEqual(mobileSafeArea.left)
    expect(coachBox!.x + coachBox!.width).toBeLessThanOrEqual(
      startup.width - mobileSafeArea.right,
    )
    expect(creativeBox!.x).toBeGreaterThanOrEqual(mobileSafeArea.left)
    expect(creativeBox!.x + creativeBox!.width).toBeLessThanOrEqual(
      startup.width - mobileSafeArea.right,
    )
    expect(firstTaskBox!.x).toBeGreaterThanOrEqual(mobileSafeArea.left)
    expect(lastTaskBox!.x + lastTaskBox!.width).toBeLessThanOrEqual(
      startup.width - mobileSafeArea.right,
    )
    expect(firstTaskBox!.y).toBeGreaterThanOrEqual(mobileSafeArea.top)
    expect(firstTaskBox!.y + firstTaskBox!.height).toBeLessThanOrEqual(
      startup.height - mobileSafeArea.bottom,
    )
    expect(lastTaskBox!.y + lastTaskBox!.height).toBeLessThanOrEqual(
      startup.height - mobileSafeArea.bottom,
    )
    expect(taskBox!.y + taskBox!.height).toBeLessThanOrEqual(startup.height + 1)

    await page
      .getByRole('button', { name: 'Dismiss Pan first, draw on purpose' })
      .click()
    await taskNavigator
      .locator('[data-interaction="mobile.task.open"]')
      .filter({ hasText: 'Project' })
      .click()
    await expect(page.getByTestId('mobile-project-sheet')).toBeVisible()
    expect(await page.evaluate(() => scrollY)).toBe(0)

    await testInfo.attach('mobile-startup-geometry', {
      body: Buffer.from(
        `${JSON.stringify({ boxes: { coachBox, creativeBox, taskBox }, startup }, null, 2)}\n`,
      ),
      contentType: 'application/json',
    })
  })
})
