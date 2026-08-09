/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Replace Magenta's `core/compat/global.js` with its already browser/worker-safe
 * sibling `global_browser.js`.
 *
 * The stock `global.js` branches on a Node check and statically references
 * `require('node-fetch')` and `window`, which breaks bundling (node-fetch is a
 * dev-only dep) and the Web Worker (no `window`). `global_browser.js` reads the
 * global object via `globalThis`/`self` fallback, so redirecting to it makes the
 * MusicRNN import bundle cleanly for both the main thread and the worker.
 */
function magentaGlobalShim(): Plugin {
  const target = '@magenta/music/esm/core/compat/global.js'
  return {
    name: 'cadence:magenta-global-shim',
    enforce: 'pre',
    load(id) {
      const normalized = id.split('?')[0].replace(/\\/g, '/')
      if (normalized.endsWith(target)) {
        return "export { fetch, performance, navigator, isSafari, getOfflineAudioContext } from './global_browser'"
      }
      return null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [magentaGlobalShim(), react()],
  worker: {
    format: 'es',
    // The worker bundles Magenta/tfjs; it needs the same global shim.
    plugins: () => [magentaGlobalShim()],
  },
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
        // Magenta/tfjs integration runs in a Web Worker and downloads real model
        // checkpoints — it can't run under jsdom/coverage, so it's exercised via
        // the deterministic mock provider + e2e instead.
        'src/composer/ai/assistant.worker.ts',
        'src/composer/ai/magentaProvider.ts',
        // Offline audio render binds to Tone.Offline (Web Audio), which can't run
        // under jsdom. WAV export is covered via encodeWav + an injected mock
        // renderer; this thin Tone binding is exercised in the browser/e2e only.
        'src/composer/audio/offlineRender.ts',
        // Thin y-websocket network glue (opens a real socket). The binding it
        // feeds is fully covered via in-memory docs; this factory is exercised
        // by the e2e collaboration spec against the Node relay harness.
        'src/composer/model/collab/websocketProvider.ts',
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

