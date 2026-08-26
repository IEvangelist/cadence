import { defineConfig, devices } from '@playwright/test'

const PORT = 4400
const origin = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: 'pages-deployment.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'node ../../tools/build-pages.mjs && node ../../tools/serve-pages.mjs ../../.pages-artifact',
    url: `${origin}/cadence/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
