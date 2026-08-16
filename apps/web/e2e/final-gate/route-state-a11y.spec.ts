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
  type FinalGateViewport,
} from './scenarios'
import { waitForStableCapture } from './visual'

const executableScenarioIds = [
  'start-empty',
  'start-recent',
  'studio-write-default',
  'studio-write-note-detail',
  'studio-mix',
  'ai-basic-suggestion',
  'ai-advanced-locked',
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
  viewport: FinalGateViewport,
): Promise<void> {
  await page.goto(scenario.route)

  switch (scenario.id) {
    case 'start-empty':
    case 'start-recent':
      await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
      break
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
    case 'studio-mix':
      await openDeterministicProject(page)
      await page.locator('[data-interaction="studio.view.mix"]').click()
      await expect(page.getByRole('region', { name: 'Mix workspace' })).toBeVisible()
      break
    case 'ai-basic-suggestion': {
      if (viewport === 'phone') {
        await expect(page.locator('[data-mobile-studio]')).toBeVisible()
        await page.getByRole('button', { name: /^Tools:/ }).click()
      } else {
        await openDeterministicProject(page)
        await page.getByRole('button', { name: 'Inspector', exact: true }).click()
        await page.getByRole('tab', { name: 'AI', exact: true }).click()
      }
      const assistant = page.getByRole('region', { name: 'AI Assistant' })
      await assistant.getByRole('radio', { name: /Generate melody/ }).check()
      await assistant.getByRole('button', { name: 'Generate' }).click()
      await expect(assistant.getByRole('button', { name: 'Accept' })).toBeVisible()
      break
    }
    case 'ai-advanced-locked':
      if (viewport === 'phone') {
        await expect(page.locator('[data-mobile-studio]')).toBeVisible()
        await page.getByRole('button', { name: /^Tools:/ }).click()
      } else {
        await openDeterministicProject(page)
        await page.getByRole('button', { name: 'Inspector', exact: true }).click()
        await page.getByRole('tab', { name: 'AI', exact: true }).click()
      }
      await page.getByRole('tab', { name: 'Advanced' }).click()
      await page.getByRole('radio', { name: /Style transfer/ }).check()
      await expect(page.getByRole('link', { name: 'View plans' })).toBeVisible()
      break
    case 'auth-dialog':
      if (viewport === 'phone') {
        await expect(page.locator('[data-mobile-studio]')).toBeVisible()
        await page.getByRole('button', { name: /^Tools:/ }).click()
      }
      await page.locator('[data-interaction="auth.panel.toggle"]').click()
      await expect(
        page.getByRole('dialog', { name: 'Sign in to Cadence' }),
      ).toBeVisible()
      break
  }

  await waitForStableCapture(page)
}

const viewportSizes: Record<FinalGateViewport, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
}

test.describe('final route and state accessibility matrix', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const scenario of executableScenarios) {
      for (const viewport of scenario.viewports) {
        test(`${scenario.id} is axe-clean at ${viewport} in ${theme}`, async ({
          page,
        }) => {
          await page.setViewportSize(viewportSizes[viewport])
          await installFinalGateFixture(page, {
            account: scenario.account,
            openLast: scenario.id !== 'start-recent',
            project: scenario.id === 'start-empty' ? null : undefined,
            theme: theme satisfies FinalGateTheme,
          })
          await prepareScenario(page, scenario, viewport)
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            theme,
          )
          await assertAxeClean(page, scenario, theme)
        })
      }
    }
  }
})

const mobileScenarios = finalGateAxeMatrix.filter(({ id }) =>
  id.startsWith('mobile-'),
)

test.describe('final mobile task accessibility matrix', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const scenario of mobileScenarios) {
      test(`${scenario.id} is axe-clean in ${theme}`, async ({ page }) => {
        await installFinalGateFixture(page, {
          account: scenario.account,
          theme,
        })
        await page.goto(scenario.route)
        await expect(page.locator('[data-mobile-studio]')).toBeVisible()

        const task = scenario.id.replace('mobile-', '')
        await page
          .getByRole('button', {
            name: new RegExp(`^${task[0].toUpperCase()}${task.slice(1)}:`),
          })
          .click()

        if (task === 'notes') {
          await expect(page.locator('.mobile-note-header')).toBeVisible()
        } else {
          await expect(
            page.getByRole('button', {
              name: `Close ${task[0].toUpperCase()}${task.slice(1)}`,
            }),
          ).toBeVisible()
        }

        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        await assertAxeClean(page, scenario, theme)
      })
    }
  }
})
