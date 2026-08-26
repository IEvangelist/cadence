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

/**
 * Dev-server wiring for a one-command `aspire run`.
 *
 * When the AppHost launches this SPA (via AddNpmApp + WithReference("api")),
 * Aspire injects the listen port as `PORT` and the API's address as the service
 * discovery variable `services__api__http__0`. Proxying `/api` — including the
 * `/api/collab` WebSocket (`ws: true`) — keeps the browser same-origin, so the
 * SPA's relative `/api/*` fetches and the collaboration socket reach the API
 * with no CORS. Run standalone (`npm run dev`) neither variable is set, so the
 * proxy is omitted and Vite uses its default port — preserving existing behavior.
 */
function devServerOptions() {
  const port = Number(process.env.PORT) || undefined
  const apiTarget =
    process.env['services__api__http__0'] ?? process.env['services__api__https__0']
  return {
    port,
    strictPort: port !== undefined,
    proxy: apiTarget
      ? { '/api': { target: apiTarget, changeOrigin: true, ws: true } }
      : undefined,
  }
}

// https://vite.dev/config/
const configuredBase = process.env.CADENCE_BASE_PATH ?? '/'
const base = `/${configuredBase.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')

export default defineConfig({
  base,
  plugins: [magentaGlobalShim(), react()],
  server: devServerOptions(),
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
        // Sampled-instrument packs (#113) build ToneAudioBuffers + a Tone.Sampler,
        // which need Web Audio and can't run under jsdom. The pure sample renderer
        // and the voice's buffer/flush logic ARE unit-tested; this thin, lazy-loaded
        // Tone binding is exercised in the browser (mirrors offlineRender.ts).
        'src/composer/plugins/builtins/samplePacks/pianoPacks.ts',
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
