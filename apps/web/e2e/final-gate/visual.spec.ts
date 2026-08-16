import { expect, test } from './audit-test'
import {
  buildDeterministicProject,
  installFinalGateFixture,
  openDeterministicProject,
  type FinalGateAccount,
  type FinalGateTheme,
} from './fixtures'
import { expectStableScreenshot, waitForStableCapture } from './visual'

type VisualViewport = '390x844' | '768x1024' | '1440x900'

interface VisualScenario {
  account: FinalGateAccount
  id: string
  route: string
  viewport: VisualViewport
}

const visualScenarios: readonly VisualScenario[] = [
  { id: 'start-empty', route: '/', account: 'anonymous', viewport: '1440x900' },
  { id: 'start-recent', route: '/', account: 'anonymous', viewport: '1440x900' },
  { id: 'studio-write-default', route: '/', account: 'pro', viewport: '1440x900' },
  { id: 'studio-write-tablet', route: '/', account: 'pro', viewport: '768x1024' },
  { id: 'studio-write-note-detail', route: '/', account: 'pro', viewport: '1440x900' },
  { id: 'studio-mix', route: '/', account: 'pro', viewport: '1440x900' },
  { id: 'ai-basic-suggestion', route: '/', account: 'free', viewport: '1440x900' },
  { id: 'ai-advanced-locked', route: '/', account: 'free', viewport: '1440x900' },
  { id: 'mobile-project', route: '/', account: 'pro', viewport: '390x844' },
  { id: 'mobile-tracks', route: '/', account: 'pro', viewport: '390x844' },
  { id: 'mobile-notes', route: '/', account: 'pro', viewport: '390x844' },
  { id: 'mobile-tools', route: '/', account: 'pro', viewport: '390x844' },
  { id: 'auth-dialog', route: '/', account: 'anonymous', viewport: '390x844' },
  { id: 'profile', route: '/profile', account: 'pro', viewport: '768x1024' },
  { id: 'pricing-free', route: '/pricing', account: 'free', viewport: '768x1024' },
  { id: 'pricing-pro', route: '/pricing', account: 'pro', viewport: '768x1024' },
  { id: 'stems-free', route: '/stems', account: 'free', viewport: '768x1024' },
  { id: 'stems-pro-complete', route: '/stems', account: 'pro', viewport: '768x1024' },
  { id: 'licenses', route: '/licenses', account: 'anonymous', viewport: '768x1024' },
]

async function prepareVisualScenario(
  page: Parameters<typeof installFinalGateFixture>[0],
  scenario: VisualScenario,
  theme: FinalGateTheme,
): Promise<void> {
  const project =
    scenario.id === 'start-empty' || scenario.id === 'auth-dialog'
      ? null
      : buildDeterministicProject()
  await installFinalGateFixture(page, {
    account: scenario.account,
    openLast: scenario.id !== 'start-recent',
    project,
    theme,
  })
  await page.goto(scenario.route)

  if (scenario.id === 'start-empty' || scenario.id === 'start-recent') {
    await expect(page.getByRole('heading', { name: 'Start a project' })).toBeVisible()
  } else if (scenario.id.startsWith('studio-write') || scenario.id === 'studio-mix') {
    await openDeterministicProject(page)
    if (scenario.id === 'studio-write-note-detail') {
      await page.locator('[data-interaction="studio.piano-roll.note"]').first().click()
    }
    if (scenario.id === 'studio-mix') {
      await page.locator('[data-interaction="studio.view.mix"]').click()
      await expect(page.getByRole('region', { name: 'Mix workspace' })).toBeVisible()
    }
  } else if (scenario.id === 'ai-basic-suggestion') {
    await openDeterministicProject(page)
    await page.getByRole('button', { name: 'Inspector', exact: true }).click()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    const assistant = page.getByRole('region', { name: 'AI Assistant' })
    await assistant.getByRole('radio', { name: /Generate melody/ }).check()
    await assistant.getByRole('button', { name: 'Generate' }).click()
    await expect(assistant.getByRole('button', { name: 'Accept' })).toBeVisible()
  } else if (scenario.id === 'ai-advanced-locked') {
    await openDeterministicProject(page)
    await page.getByRole('button', { name: 'Inspector', exact: true }).click()
    await page.getByRole('tab', { name: 'AI', exact: true }).click()
    await page.getByRole('tab', { name: 'Advanced' }).click()
    await page.getByRole('radio', { name: /Style transfer/ }).check()
    await expect(page.getByRole('link', { name: 'View plans' })).toBeVisible()
  } else if (scenario.id.startsWith('mobile-')) {
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
  } else if (scenario.id === 'auth-dialog') {
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('dialog', { name: 'Sign in to Cadence' })).toBeVisible()
  } else if (scenario.id === 'profile') {
    await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible()
  } else if (scenario.id.startsWith('pricing-')) {
    await expect(page.getByRole('heading', { name: 'Plans & pricing' })).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: scenario.id === 'pricing-pro' ? 'Manage billing' : 'Upgrade to Pro',
      }),
    ).toBeVisible()
  } else if (scenario.id === 'stems-free') {
    await expect(page.getByRole('heading', { name: /Pro feature/ })).toBeVisible()
  } else if (scenario.id === 'stems-pro-complete') {
    await expect(page.getByLabel('bass stem preview')).toBeVisible()
  } else if (scenario.id === 'licenses') {
    await expect(
      page.getByRole('heading', {
        name: /Acknowledgements & third-party licenses/,
      }),
    ).toBeVisible()
  }

  await waitForStableCapture(page)
}

test.describe('authoritative UX snapshots', () => {
  for (const scenario of visualScenarios) {
    test(`${scenario.id} matches its Linux Chromium baseline`, async ({
      page,
    }, testInfo) => {
      const metadata = testInfo.project.metadata as {
        cadenceTheme?: FinalGateTheme
        cadenceViewport?: VisualViewport
      }
      test.skip(metadata.cadenceViewport !== scenario.viewport)
      const theme = metadata.cadenceTheme
      if (!theme) throw new Error('Visual project is missing cadenceTheme metadata.')

      await prepareVisualScenario(page, scenario, theme)
      await expectStableScreenshot(page, `${scenario.id}.png`)
    })
  }
})
