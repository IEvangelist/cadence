import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'
import type {
  FinalGateAccount,
  FinalGateTheme,
} from './fixtures'

export type FinalGateViewport = 'phone' | 'tablet' | 'desktop'

export interface FinalGateScenario {
  id: string
  route: string
  account: FinalGateAccount
  state: string
  viewports: readonly FinalGateViewport[]
}

export const finalGateAxeMatrix: readonly FinalGateScenario[] = [
  {
    id: 'start-empty',
    route: '/',
    account: 'anonymous',
    state: 'Start Center without recent projects',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'studio-write-default',
    route: '/',
    account: 'pro',
    state: 'Write workspace with deterministic project',
    viewports: ['tablet', 'desktop'],
  },
  {
    id: 'studio-write-note-detail',
    route: '/',
    account: 'pro',
    state: 'Write workspace with selected note and detail lane',
    viewports: ['tablet', 'desktop'],
  },
  {
    id: 'studio-mix',
    route: '/',
    account: 'pro',
    state: 'Mix workspace',
    viewports: ['tablet', 'desktop'],
  },
  {
    id: 'ai-basic-suggestion',
    route: '/',
    account: 'free',
    state: 'Basic AI suggestion preview',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'ai-advanced-locked',
    route: '/',
    account: 'free',
    state: 'Advanced AI locked state',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'auth-dialog',
    route: '/',
    account: 'anonymous',
    state: 'Authentication dialog',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'profile',
    route: '/profile',
    account: 'pro',
    state: 'Authenticated profile',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'pricing-free',
    route: '/pricing',
    account: 'free',
    state: 'Free pricing',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'pricing-pro',
    route: '/pricing',
    account: 'pro',
    state: 'Pro pricing',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'stems-free',
    route: '/stems',
    account: 'free',
    state: 'Free stem-separation gate',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'stems-pro-complete',
    route: '/stems',
    account: 'pro',
    state: 'Completed Pro stem-separation job',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  {
    id: 'licenses',
    route: '/licenses',
    account: 'anonymous',
    state: 'Third-party licenses',
    viewports: ['phone', 'tablet', 'desktop'],
  },
  ...(['project', 'tracks', 'notes', 'tools'] as const).map(
    (task): FinalGateScenario => ({
      id: `mobile-${task}`,
      route: '/',
      account: 'pro',
      state: `Mobile ${task} task`,
      viewports: ['phone'],
    }),
  ),
]

export async function assertAxeClean(
  page: Page,
  scenario: FinalGateScenario,
  theme: FinalGateTheme,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(
    results.violations,
    `${scenario.id} (${theme}): ${scenario.state}`,
  ).toEqual([])
}
