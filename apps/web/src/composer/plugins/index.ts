/**
 * Cadence Plugin SDK — public surface.
 *
 * Import from `composer/plugins` to build a plugin or drive the host. This
 * barrel re-exports the stable contracts (manifest + contribution types), the
 * host/registry, manifest validation, the customization preferences store, the
 * keybinding helpers, and the reference example plugin.
 *
 * MVP scope: an in-process, typed *module* plugin model. Remote loading, a
 * marketplace, and untrusted-plugin sandboxing are intentionally out of scope
 * (documented seams — see docs/plugins.md).
 */
export type {
  SemVer,
  PluginManifest,
  InstrumentKind,
  InstrumentDefinition,
  InstrumentVoice,
  InstrumentVoiceContext,
  InstrumentVoiceFactory,
  InstrumentContribution,
  EffectNode,
  EffectContext,
  EffectFactory,
  EffectContribution,
  FormatImportOptions,
  FormatContribution,
  AiProviderContribution,
  CommandNote,
  CommandApi,
  CommandContribution,
  PanelRenderContext,
  PanelContribution,
  PluginContributions,
  PluginHostApi,
  CadencePlugin,
} from './types'

export { PluginManifestError, validateManifest } from './manifest'
export {
  PluginHost,
  PluginRegistrationError,
  createPluginHost,
  type PluginState,
  type RegisteredPlugin,
  type RegisterOptions,
} from './host'
export { defaultPluginHost } from './defaultHost'
export { CORE_PLUGIN_ID, createCorePlugin, coreContributions } from './builtins'

export {
  type Preferences,
  PREFERENCES_SCHEMA_VERSION,
  DEFAULT_PREFERENCES,
  PreferencesStore,
  createPreferencesStore,
  migratePreferences,
  parsePreferences,
  serializePreferences,
} from './preferences'

export {
  canonicalizeKeybinding,
  eventToKeybinding,
  formatKeybinding,
  resolveKeybindingMap,
} from './keybindings'

export {
  createExamplePlugin,
  EXAMPLE_PLUGIN_ID,
  EXAMPLE_INSTRUMENT_ID,
  EXAMPLE_FORMAT_ID,
  EXAMPLE_COMMAND_ID,
  EXAMPLE_PANEL_ID,
} from './examples/helloPlugin'

export { usePlugins, type PluginsController, type PluginSummary } from './usePlugins'
