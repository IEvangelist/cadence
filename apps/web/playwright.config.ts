import { defineConfig, devices } from '@playwright/test'
import { returningProjectStorage } from './e2e/projectFixtures'

// The smoke suite is intentionally run against a *production build* served by
// `vite preview`, so it proves the app compiles and renders the same bundle we
// ship. Playwright builds + serves it via the `webServer` block below.
const PORT = 4173
const RELAY_PORT = 4174
const baseURL = `http://127.0.0.1:${PORT}`
// Build-time relay URL for the live-collaboration e2e. The collaboration spec
// activates only when a `?collab=` link is opened, so baking this in is inert
// for every other suite.
const collabUrl = `ws://127.0.0.1:${RELAY_PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Keep interaction suites on the returning-user path; onboarding.spec.ts
    // opts back into first-run by resetting storageState.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: 'cadence.v1.onboarding.seen', value: '1' },
            ...returningProjectStorage,
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_COLLAB_URL: collabUrl },
    },
    {
      // Standalone Yjs relay backing the live-collaboration spec (Node-only, so
      // it runs in the web-e2e CI job which has no .NET). Mirrors the production
      // relay's server-side viewer write-gate.
      command: `node e2e/collab-server.mjs`,
      url: `http://127.0.0.1:${RELAY_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { COLLAB_PORT: String(RELAY_PORT) },
    },
  ],
})
