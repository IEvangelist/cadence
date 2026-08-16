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

const desktopViewports = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
] as const

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
})
