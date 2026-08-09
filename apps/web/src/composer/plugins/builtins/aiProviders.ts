/**
 * Built-in AI/composition providers, expressed as Plugin SDK contributions.
 *
 * The in-browser {@link MagentaAssistant} and the deterministic
 * {@link MockAssistant} (used by e2e/tests) are registered through the same
 * {@link AiProviderContribution} contract a plugin uses. `create` is lazy so the
 * heavy Magenta/TensorFlow worker is still only spun up on first generate —
 * importing this module pulls in no model code and preserves the AI worker
 * code-split (the worker is created via `new Worker(new URL(...))` inside
 * MagentaAssistant, never at import time).
 */
import { MagentaAssistant } from '../../ai/magentaProvider'
import { MockAssistant } from '../../ai/mockProvider'
import type { AiProviderContribution } from '../types'

/** The Magenta and mock providers, registered through the SDK. */
export const BUILTIN_AI_PROVIDERS: AiProviderContribution[] = [
  {
    id: 'magenta',
    name: 'Magenta (in-browser)',
    create: () => new MagentaAssistant(),
  },
  {
    id: 'mock',
    name: 'Mock (deterministic)',
    create: () => new MockAssistant(),
  },
]
