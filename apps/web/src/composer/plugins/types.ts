/**
 * Cadence Plugin SDK — public contracts.
 *
 * This is the typed, in-process extensibility surface for the composer. It
 * generalizes the app's previously ad-hoc registries (instruments, formats, AI
 * providers) into ONE plugin model so later efforts (collaboration, billing,
 * stem separation) register their capabilities the same way.
 *
 * A plugin is a plain module object: a {@link PluginManifest} plus a set of
 * typed {@link PluginContributions}. Plugins are registered with a
 * {@link PluginHost}, activated (contributions go live), and disposed. The core
 * has **no runtime dependencies** — Tone/React types are imported `type`-only so
 * nothing heavy is pulled into the SDK (or the AI worker) bundle.
 *
 * MVP scope: an in-process, typed *module* plugin model. Remote loading, a
 * marketplace, and hardened untrusted-plugin sandboxing are intentionally out of
 * scope (see docs/plugins.md) — this surface is the seam they will build on.
 */
import type * as Tone from 'tone'
import type { ReactNode } from 'react'
import type { Project, Track } from '../model/project'
import type { CompositionAssistant } from '../ai/types'

/** A dotted, npm-style semantic version string, e.g. `1.0.0`. */
export type SemVer = string

/**
 * Plugin identity + metadata. `id` is the stable key used for registration,
 * override, and preferences; `version` gates future compatibility checks.
 */
export interface PluginManifest {
  /** Stable unique id, e.g. `cadence.core` or `acme.extra-instruments`. */
  id: string
  /** Human-readable name shown in the plugins UI. */
  name: string
  /** Semantic version, e.g. `1.0.0`. */
  version: SemVer
  /** One-line description shown in the plugins UI. */
  description?: string
  /** Optional author/vendor label. */
  author?: string
  /** True for the always-on core plugin bundling the built-ins. */
  builtin?: boolean
}

// ---------------------------------------------------------------------------
// (a) Instrument contribution
// ---------------------------------------------------------------------------

/** How an instrument interprets pitch: melodic (pitched) or a drum map. */
export type InstrumentKind = 'synth' | 'drum'

/** Descriptive metadata for a selectable instrument (no audio dependency). */
export interface InstrumentDefinition {
  id: string
  name: string
  kind: InstrumentKind
  description: string
  /** True when the instrument plays multiple simultaneous notes. */
  polyphonic: boolean
}

/** A playable voice for one track. Times are absolute audio-context seconds. */
export interface InstrumentVoice {
  trigger(pitch: number, durationSeconds: number, time: number, velocity: number): void
  dispose(): void
}

/** Everything an instrument factory needs to build a voice. */
export interface InstrumentVoiceContext {
  /** Master output node the voice should connect to. */
  readonly output: Tone.Gain
  /** The track the voice plays. */
  readonly track: Track
  /** Current tempo in BPM (for factories that need seconds↔beats). */
  readonly tempo: number
}

/** Builds a {@link InstrumentVoice} for a track. */
export type InstrumentVoiceFactory = (context: InstrumentVoiceContext) => InstrumentVoice

/** An instrument a plugin contributes: metadata + a voice factory. */
export interface InstrumentContribution extends InstrumentDefinition {
  createVoice: InstrumentVoiceFactory
}

// ---------------------------------------------------------------------------
// (b) Audio effect contribution
// ---------------------------------------------------------------------------

/** An effect's audio graph: connect `input` → effect → `output`. */
export interface EffectNode {
  readonly input: Tone.ToneAudioNode
  readonly output: Tone.ToneAudioNode
  dispose(): void
}

/** Context handed to an effect factory. */
export interface EffectContext {
  /** Current tempo in BPM (for tempo-synced effects). */
  readonly tempo: number
}

/** Builds an {@link EffectNode}. */
export type EffectFactory = (context: EffectContext) => EffectNode

/** An audio effect a plugin contributes. */
export interface EffectContribution {
  id: string
  name: string
  description: string
  /** When true, the effect is applied unless the user disables it. */
  enabledByDefault?: boolean
  createNode: EffectFactory
}

// ---------------------------------------------------------------------------
// (c) Import/export format contribution
// ---------------------------------------------------------------------------

/** Options passed to an importer. */
export interface FormatImportOptions {
  id?: string
  name?: string
}

/** A file format a plugin contributes (exporter, importer, or both). */
export interface FormatContribution {
  id: string
  /** Menu label, e.g. `Plain text (.txt)`. */
  name: string
  /** File extension including the dot, e.g. `.txt`. */
  extension: string
  /** MIME type for the download blob. */
  mimeType: string
  /** Serialize a project. Omit for import-only formats. */
  export?: (project: Project) => string | Uint8Array
  /** Parse a project (throws a typed error on failure). Omit for export-only. */
  import?: (data: string, options?: FormatImportOptions) => Project
}

// ---------------------------------------------------------------------------
// (d) AI / composition provider contribution
// ---------------------------------------------------------------------------

/** A composition-assistant provider a plugin contributes. */
export interface AiProviderContribution {
  id: string
  name: string
  /** Construct the provider. Kept lazy so heavy models aren't loaded eagerly. */
  create: () => CompositionAssistant
}

// ---------------------------------------------------------------------------
// (e) UI surfaces: commands + panels
// ---------------------------------------------------------------------------

/** A note in the composer's units, as passed to {@link CommandApi.insertNotes}. */
export interface CommandNote {
  pitch: number
  start: number
  duration: number
  velocity: number
}

/**
 * The minimal, stable API a command receives at run time. The composer supplies
 * the implementation; plugins never reach into React or the reducer directly.
 */
export interface CommandApi {
  /** Show a transient status message in the composer status region. */
  notify(message: string): void
  /** A read-only snapshot of the current project. */
  getProject(): Project
  /** The id of the currently selected track (empty string if none). */
  getSelectedTrackId(): string
  /** Insert notes into a track (routed through the reducer's sanitizer). */
  insertNotes(trackId: string, notes: CommandNote[]): void
}

/** A command a plugin contributes to the command menu / keybindings. */
export interface CommandContribution {
  id: string
  /** Menu title, e.g. `Insert a C-major chord`. */
  title: string
  /**
   * Default keybinding in `mod+key` form (`mod` = Ctrl on Windows/Linux, ⌘ on
   * macOS), e.g. `mod+shift+h`. Users can override it in preferences.
   */
  keybinding?: string
  run: (api: CommandApi) => void | Promise<void>
}

/** Context handed to a panel's render function. */
export interface PanelRenderContext {
  /** A read-only snapshot of the current project. */
  project: Project
  /** Run a contributed command by id. */
  runCommand(commandId: string): void
}

/** A UI panel a plugin contributes to the composer sidebar. */
export interface PanelContribution {
  id: string
  title: string
  render: (context: PanelRenderContext) => ReactNode
}

// ---------------------------------------------------------------------------
// Plugin + contributions
// ---------------------------------------------------------------------------

/** Everything a plugin can contribute. Every field is optional. */
export interface PluginContributions {
  instruments?: InstrumentContribution[]
  effects?: EffectContribution[]
  formats?: FormatContribution[]
  aiProviders?: AiProviderContribution[]
  commands?: CommandContribution[]
  panels?: PanelContribution[]
}

/** The host surface a plugin's `activate` hook receives. */
export interface PluginHostApi {
  /** The manifest of the plugin being activated. */
  readonly manifest: PluginManifest
}

/**
 * A Cadence plugin: identity + contributions, with an optional lifecycle. The
 * host validates {@link manifest}, exposes {@link contributes} while active, and
 * calls {@link activate}/{@link dispose} on the corresponding transitions.
 */
export interface CadencePlugin {
  manifest: PluginManifest
  contributes?: PluginContributions
  /** Called when the plugin is activated (contributions go live). */
  activate?: (host: PluginHostApi) => void | Promise<void>
  /** Called when the plugin is disposed (contributions removed). Idempotent. */
  dispose?: () => void
}
