/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    css: false,
    // Playwright specs live under ./e2e and are run by Playwright, not Vitest.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      // Entry point + test/setup files are not meaningful unit-coverage targets.
      exclude: [
        'src/main.tsx',
        'src/setupTests.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
      ],
      // CI-enforced gate: the run fails if coverage drops below these.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})

