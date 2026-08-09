/**
 * Resolve a {@link CompositionAssistant} from the plugin host.
 *
 * This is the single place provider selection happens now that AI providers are
 * SDK contributions. Resolution order:
 *   1. When `useMock` is set (e2e/tests via `window.__CADENCE_AI_MOCK__`), always
 *      use the deterministic `mock` provider so CI never loads a real model.
 *   2. Otherwise honor the user's `preferredId` (from preferences), if present.
 *   3. Otherwise fall back to the first non-mock provider (the built-in Magenta).
 *
 * Providers are constructed lazily via each contribution's `create`, so no model
 * code loads until a provider is actually chosen.
 */
import type { CompositionAssistant } from '../ai/types'
import { MockAssistant } from '../ai/mockProvider'
import { defaultPluginHost } from './defaultHost'
import type { PluginHost } from './host'

export interface ResolveAssistantOptions {
  /** Host to resolve from; defaults to the shared {@link defaultPluginHost}. */
  host?: PluginHost
  /** The user's preferred provider id (from preferences). */
  preferredId?: string | null
  /** Force the deterministic mock provider (e2e/tests). */
  useMock?: boolean
}

export function resolveAssistant(
  options: ResolveAssistantOptions = {},
): CompositionAssistant {
  const host = options.host ?? defaultPluginHost
  const providers = host.aiProviders()
  const find = (id: string) => providers.find((p) => p.id === id)

  if (options.useMock) {
    const mock = find('mock')
    if (mock) return mock.create()
  }
  if (options.preferredId) {
    const chosen = find(options.preferredId)
    if (chosen) return chosen.create()
  }
  const preferred = providers.find((p) => p.id !== 'mock') ?? providers[0]
  if (preferred) return preferred.create()
  // Ultimate fallback if the host somehow has no providers registered.
  return new MockAssistant()
}
