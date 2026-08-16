import { defineConfig } from '@playwright/test'
import finalGateConfig from './playwright.final-gate.config'

const viewports = [
  { name: '390x844', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: '768x1024', width: 768, height: 1024, isMobile: false, hasTouch: false },
  { name: '1440x900', width: 1440, height: 900, isMobile: false, hasTouch: false },
] as const

const themes = ['light', 'dark'] as const
const updatingSnapshots = process.argv.some((argument) =>
  argument.startsWith('--update-snapshots'),
)

if (updatingSnapshots && process.platform !== 'linux') {
  throw new Error(
    'Authoritative visual baselines must be generated on Linux Chromium.',
  )
}

export default defineConfig({
  ...finalGateConfig,
  outputDir: 'test-results/visual',
  reporter: process.env.CI
    ? [
        ['github'],
        ['html', { open: 'never', outputFolder: 'playwright-report-visual' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report-visual' }],
      ],
  testMatch: 'final-gate/visual.spec.ts',
  snapshotPathTemplate:
    '{testDir}/final-gate/__screenshots__/{projectName}/{arg}{ext}',
  projects: viewports.flatMap((viewport) =>
    themes.map((theme) => ({
      name: `chromium-${viewport.name}-${theme}`,
      metadata: {
        cadenceTheme: theme,
        cadenceViewport: viewport.name,
      },
      use: {
        browserName: 'chromium' as const,
        colorScheme: theme,
        deviceScaleFactor: 1,
        hasTouch: viewport.hasTouch,
        isMobile: viewport.isMobile,
        locale: 'en-US',
        reducedMotion: 'reduce' as const,
        serviceWorkers: 'block' as const,
        timezoneId: 'UTC',
        viewport: { width: viewport.width, height: viewport.height },
      },
    })),
  ),
})
