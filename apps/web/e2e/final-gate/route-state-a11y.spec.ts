import type { Page } from '@playwright/test'
import { expect, test } from './audit-test'
import {
  installFinalGateFixture,
  openDeterministicProject,
  type FinalGateTheme,
} from './fixtures'
import {
  assertAxeClean,
  finalGateAxeMatrix,
  type FinalGateScenario,
} from './scenarios'
import { waitForStableCapture } from './visual'

const executableScenarioIds = [
  'studio-write-default',
  'studio-write-note-detail',
  'auth-dialog',
  'profile',
  'pricing-free',
  'pricing-pro',
  'stems-free',
  'stems-pro-complete',
  'licenses',
] as const

const executableScenarios = executableScenarioIds.map((id) => {
  const scenario = finalGateAxeMatrix.find((candidate) => candidate.id === id)
  if (!scenario) throw new Error(`Missing final-gate scenario: ${id}`)
  return scenario
})

async function prepareScenario(
  page: Page,
  scenario: FinalGateScenario,
): Promise<void> {
  await page.goto(scenario.route)

  switch (scenario.id) {
    case 'studio-write-default':
      await openDeterministicProject(page)
      break
    case 'studio-write-note-detail':
      await openDeterministicProject(page)
      await page
        .locator('[data-interaction="studio.piano-roll.note"]')
        .first()
        .click()
      break
    case 'auth-dialog':
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(
        page.getByRole('dialog', { name: 'Sign in to Cadence' }),
      ).toBeVisible()
      break
  }

  await waitForStableCapture(page)
}

test.describe('final route and state accessibility matrix', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const theme of ['light', 'dark'] as const) {
    for (const scenario of executableScenarios) {
      test(`${scenario.id} is axe-clean in ${theme}`, async ({ page }) => {
        await installFinalGateFixture(page, {
          account: scenario.account,
          theme: theme satisfies FinalGateTheme,
        })
        await prepareScenario(page, scenario)
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          theme,
        )
        await assertAxeClean(page, scenario, theme)
      })
    }
  }
})
