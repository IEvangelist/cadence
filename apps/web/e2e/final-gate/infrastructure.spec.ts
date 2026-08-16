import { expect, test } from './audit-test'
import {
  collectRenderedInteractionIds,
  buildInteractionCoverageReport,
  writeInteractionCoverageReport,
} from './interaction-report'
import { installFinalGateFixture } from './fixtures'
import {
  activateFocused,
  expectVisibleFocusIndicator,
  tabTo,
} from './keyboard'
import { waitForStableCapture } from './visual'

test.describe('final-gate infrastructure', () => {
  test('loads deterministic production data and emits an interaction report', async ({
    page,
  }, testInfo) => {
    await installFinalGateFixture(page)
    await page.goto('/')
    await waitForStableCapture(page)

    const recentProject = page.getByRole('button', {
      name: /Final Gate Fixture/,
    })
    if ((await recentProject.count()) > 0) {
      await recentProject.click()
    } else {
      await page.getByLabel('Open project').selectOption('final-gate-project')
    }
    await expect(page.getByLabel('Project name')).toHaveValue(
      'Final Gate Fixture',
    )
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    const observed = await collectRenderedInteractionIds(page)
    const report = buildInteractionCoverageReport(
      observed.registered,
      observed.unknown,
      observed.untagged,
    )
    expect(report.coveredInteractionCount).toBeGreaterThan(0)
    expect(report.untaggedRenderedControls).toEqual([])
    expect(report.unknownRenderedIds).toEqual([])
    await writeInteractionCoverageReport(report, testInfo)
  })

  test('drives the skip-link journey without pointer input', async ({ page }) => {
    await installFinalGateFixture(page)
    await page.goto('/')
    await waitForStableCapture(page)

    const skipLink = page.getByRole('link', { name: 'Skip to editor' })
    await tabTo(page, skipLink, { maxTabs: 2 })
    await expectVisibleFocusIndicator(skipLink)
    await activateFocused(page)
    await expect(page.locator('#composer-main')).toBeFocused()
  })
})
