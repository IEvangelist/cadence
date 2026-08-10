/**
 * First-run templates and guided-tour contracts for effort #42.
 *
 * Templates reuse the existing createEmptyProject/createDemoProject model
 * helpers. An onboarding step `action` is a Plugin SDK CommandContribution id.
 */
import type { Project } from '../model/project'

export interface ProjectTemplate {
  id: string
  name: string
  description: string
  category?: 'empty' | 'demo' | 'tutorial' | 'genre'
  create(): Project
}

export interface OnboardingStep {
  id: string
  title: string
  body: string
  anchor?: string
  action?: string
}

export interface OnboardingTour {
  id: string
  steps: readonly OnboardingStep[]
}

export interface FirstRunState {
  completed: boolean
  lastStepId?: string
  dismissedAt?: number
}
