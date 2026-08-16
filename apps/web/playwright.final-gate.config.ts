import { defineConfig, devices } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { returningProjectStorage } from './e2e/projectFixtures'

const PORT = 4260
const RELAY_PORT = 4360
const baseURL = `http://127.0.0.1:${PORT}`
const collabUrl = `ws://127.0.0.1:${RELAY_PORT}`
const servedHead =
  process.env.CADENCE_FINAL_GATE_SERVED_HEAD ??
  execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()
const workingTreeDirty = process.env.CADENCE_FINAL_GATE_WORKTREE_DIRTY
  ? process.env.CADENCE_FINAL_GATE_WORKTREE_DIRTY === 'true'
  : execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
    }).trim().length > 0

process.env.CADENCE_FINAL_GATE_SERVED_HEAD = servedHead
process.env.CADENCE_FINAL_GATE_BASE_URL = baseURL
process.env.CADENCE_FINAL_GATE_WORKTREE_DIRTY = String(workingTreeDirty)

export default defineConfig({
  metadata: { baseURL, servedHead, workingTreeDirty },
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ['github'],
        ['./e2e/final-gate/audit-reporter.ts'],
        ['html', { open: 'never' }],
      ]
    : [
        ['list'],
        ['./e2e/final-gate/audit-reporter.ts'],
        ['html', { open: 'never' }],
      ],
  use: {
    baseURL,
    trace: 'on-first-retry',
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
      name: 'chromium-final-gate',
      testIgnore: ['mobile-contract.spec.ts', 'final-gate/visual.spec.ts'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium-final-gate',
      testMatch: 'mobile-contract.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      },
    },
  ],
  webServer: [
    {
      command: `npm run build && npm run preview -- --port ${PORT} --strictPort --host 127.0.0.1`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_COLLAB_URL: collabUrl },
    },
    {
      command: 'node e2e/collab-server.mjs',
      url: `http://127.0.0.1:${RELAY_PORT}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { COLLAB_PORT: String(RELAY_PORT) },
    },
  ],
})
