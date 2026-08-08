/**
 * Provider factory — the single place the UI resolves a {@link CompositionAssistant}.
 *
 * Returns the deterministic {@link MockAssistant} when `window.__CADENCE_AI_MOCK__`
 * is set (Playwright e2e + tests inject this before the app mounts, so CI never
 * downloads a real checkpoint or hits the network), and the real in-browser
 * {@link MagentaAssistant} otherwise. A future premium provider would slot in
 * here behind the same interface.
 */
import { MagentaAssistant } from './magentaProvider'
import { MockAssistant } from './mockProvider'
import type { CompositionAssistant } from './types'

declare global {
  interface Window {
    /** When true, use the deterministic mock provider (e2e/tests). */
    __CADENCE_AI_MOCK__?: boolean
  }
}

/** True when the deterministic mock provider should be used. */
export function shouldUseMock(): boolean {
  return typeof window !== 'undefined' && window.__CADENCE_AI_MOCK__ === true
}

/** Resolve the assistant provider for the current environment. */
export function createAssistant(): CompositionAssistant {
  return shouldUseMock() ? new MockAssistant() : new MagentaAssistant()
}
