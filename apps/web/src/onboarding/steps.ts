export interface OnboardingStep {
  id: string
  title: string
  body: string
  anchor?: string
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Cadence',
    body: "Welcome to Cadence — let's take a 30-second tour.",
  },
  {
    id: 'project-toolbar',
    title: 'Project toolbar',
    body: 'Create, save, open, import, export, and share your song here.',
    anchor: '[aria-label="Project toolbar"]',
  },
  {
    id: 'transport-controls',
    title: 'Transport controls',
    body: 'Play your song, set the tempo, loop sections, and adjust snap.',
    anchor: '[aria-label="Transport controls"]',
  },
  {
    id: 'tracks',
    title: 'Tracks',
    body: 'Add and manage the instrument tracks that shape your arrangement.',
    anchor: '[aria-label="Tracks"]',
  },
  {
    id: 'ai-assistant',
    title: 'AI Assistant',
    body: 'Generate musical ideas with AI whenever you want a spark.',
    anchor: '[aria-label="AI Assistant"]',
  },
  {
    id: 'piano-roll-editor',
    title: 'Piano roll editor',
    body: 'Click the grid to place notes; use arrow keys and Enter to edit.',
    anchor: '[aria-label="Piano roll editor"]',
  },
  {
    id: 'finish',
    title: 'You’re ready',
    body: "You're all set. Press Play when inspiration strikes.",
  },
]
