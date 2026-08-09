/**
 * The always-on **core plugin** that bundles Cadence's built-ins.
 *
 * Dogfooding: the composer's built-in instruments (and, in later wiring, its
 * formats, AI providers, and effects) are registered through the very same SDK
 * that third-party plugins use. There is no privileged built-in path — the core
 * plugin is just a plugin whose manifest is flagged `builtin: true`.
 */
import type { CadencePlugin, PluginContributions } from '../types'
import { BUILTIN_INSTRUMENTS } from './instruments'
import { BUILTIN_FORMATS } from './formats'
import { BUILTIN_AI_PROVIDERS } from './aiProviders'
import { BUILTIN_EFFECTS } from './effects'

/** The contributions bundled by the core plugin. */
export function coreContributions(): PluginContributions {
  return {
    instruments: BUILTIN_INSTRUMENTS,
    formats: BUILTIN_FORMATS,
    aiProviders: BUILTIN_AI_PROVIDERS,
    effects: BUILTIN_EFFECTS,
  }
}

/** Build the core plugin. */
export function createCorePlugin(): CadencePlugin {
  return {
    manifest: {
      id: 'cadence.core',
      name: 'Cadence Core',
      version: '1.0.0',
      description: 'Built-in instruments, formats, and AI providers.',
      author: 'Cadence',
      builtin: true,
    },
    contributes: coreContributions(),
  }
}

/** The stable id of the core plugin. */
export const CORE_PLUGIN_ID = 'cadence.core'
