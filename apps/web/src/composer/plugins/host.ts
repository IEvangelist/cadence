/**
 * The plugin host / registry.
 *
 * Owns the plugin lifecycle (register → activate → dispose) and aggregates the
 * contributions of **active** plugins into typed views the composer consumes
 * (instruments, effects, formats, AI providers, commands, panels). It is a plain
 * class with no framework or audio dependency, so it is trivially unit-testable;
 * a module-level singleton wired with the built-ins lives in `defaultHost.ts`.
 *
 * Semantics:
 * - Registering a duplicate id throws unless `{ override: true }` is passed.
 * - Contributions are visible only while a plugin is `active`.
 * - When two active plugins contribute the same contribution id, the
 *   most-recently-registered one wins (so a plugin can override a built-in).
 * - `dispose` runs the plugin's `dispose` hook and hides its contributions but
 *   keeps it registered, so it can be re-activated (enable/disable toggling).
 */
import { validateManifest } from './manifest'
import { effectParameterDescriptors } from './effectParameters'
import type {
  AiProviderContribution,
  CadencePlugin,
  CommandContribution,
  EffectContribution,
  FormatContribution,
  InstrumentContribution,
  PanelContribution,
  PluginContributions,
  PluginManifest,
} from './types'

/** Thrown when a plugin cannot be registered (e.g. a duplicate id). */
export class PluginRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginRegistrationError'
  }
}

export type PluginState = 'registered' | 'active' | 'disposed'

/** A plugin as tracked by the host. */
export interface RegisteredPlugin {
  readonly manifest: PluginManifest
  readonly plugin: CadencePlugin
  state: PluginState
}

export interface RegisterOptions {
  /** Replace an already-registered plugin with the same id. */
  override?: boolean
}

function validateEffectDescriptors(plugin: CadencePlugin): void {
  for (const effect of plugin.contributes?.effects ?? []) {
    const declared = effect.parameters ?? []
    if (effectParameterDescriptors(effect).length !== declared.length) {
      throw new PluginRegistrationError(
        `Effect "${effect.id}" has invalid or duplicate parameter descriptors`,
      )
    }
  }
}

const EMPTY: Required<PluginContributions> = {
  instruments: [],
  effects: [],
  formats: [],
  aiProviders: [],
  commands: [],
  panels: [],
}

export class PluginHost {
  // Insertion order is preserved by Map, which fixes contribution precedence.
  private readonly plugins = new Map<string, RegisteredPlugin>()
  private readonly listeners = new Set<() => void>()

  /** Register a plugin (validating its manifest). Does not activate it. */
  register(plugin: CadencePlugin, options: RegisterOptions = {}): RegisteredPlugin {
    const manifest = validateManifest(plugin.manifest)
    validateEffectDescriptors(plugin)
    const existing = this.plugins.get(manifest.id)
    if (existing && !options.override) {
      throw new PluginRegistrationError(
        `A plugin with id "${manifest.id}" is already registered`,
      )
    }
    if (existing) this.runDispose(existing)
    // Re-registering an id must restore insertion order for precedence.
    this.plugins.delete(manifest.id)
    const entry: RegisteredPlugin = { manifest, plugin, state: 'registered' }
    this.plugins.set(manifest.id, entry)
    this.notify()
    return entry
  }

  /** Register (if needed) and activate a plugin in one step. */
  use(plugin: CadencePlugin, options: RegisterOptions = {}): RegisteredPlugin {
    const entry = this.register(plugin, options)
    this.activate(entry.manifest.id)
    return entry
  }

  /** Activate a registered plugin so its contributions go live. Idempotent. */
  activate(id: string): void {
    const entry = this.require(id)
    if (entry.state === 'active') return
    entry.plugin.activate?.({ manifest: entry.manifest })
    entry.state = 'active'
    this.notify()
  }

  /** Dispose a plugin's runtime + hide its contributions (stays registered). */
  dispose(id: string): void {
    const entry = this.plugins.get(id)
    if (!entry || entry.state === 'disposed') return
    this.runDispose(entry)
    this.notify()
  }

  /** Fully remove a plugin (disposing it first). */
  unregister(id: string): void {
    const entry = this.plugins.get(id)
    if (!entry) return
    this.runDispose(entry)
    this.plugins.delete(id)
    this.notify()
  }

  has(id: string): boolean {
    return this.plugins.has(id)
  }

  isActive(id: string): boolean {
    return this.plugins.get(id)?.state === 'active'
  }

  get(id: string): RegisteredPlugin | undefined {
    return this.plugins.get(id)
  }

  /** All registered plugins in registration order. */
  list(): RegisteredPlugin[] {
    return [...this.plugins.values()]
  }

  // -- Aggregate contribution views (active plugins only) -------------------

  instruments(): InstrumentContribution[] {
    return this.dedupeById(this.collect((c) => c.instruments))
  }

  effects(): EffectContribution[] {
    return this.dedupeById(this.collect((c) => c.effects))
  }

  formats(): FormatContribution[] {
    return this.dedupeById(this.collect((c) => c.formats))
  }

  aiProviders(): AiProviderContribution[] {
    return this.dedupeById(this.collect((c) => c.aiProviders))
  }

  commands(): CommandContribution[] {
    return this.dedupeById(this.collect((c) => c.commands))
  }

  panels(): PanelContribution[] {
    return this.dedupeById(this.collect((c) => c.panels))
  }

  /** Subscribe to any lifecycle/contribution change. Returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // -- internals ------------------------------------------------------------

  private require(id: string): RegisteredPlugin {
    const entry = this.plugins.get(id)
    if (!entry) throw new PluginRegistrationError(`No plugin registered with id "${id}"`)
    return entry
  }

  private runDispose(entry: RegisteredPlugin): void {
    if (entry.state === 'active') {
      try {
        entry.plugin.dispose?.()
      } finally {
        entry.state = 'disposed'
      }
    } else {
      entry.state = 'disposed'
    }
  }

  private collect<T>(pick: (c: PluginContributions) => T[] | undefined): T[] {
    const out: T[] = []
    for (const entry of this.plugins.values()) {
      if (entry.state !== 'active') continue
      const items = pick(entry.plugin.contributes ?? EMPTY)
      if (items) out.push(...items)
    }
    return out
  }

  /** Last contribution wins when ids collide (later plugins override earlier). */
  private dedupeById<T extends { id: string }>(items: T[]): T[] {
    const byId = new Map<string, T>()
    for (const item of items) byId.set(item.id, item)
    return [...byId.values()]
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** Construct an empty host. */
export function createPluginHost(): PluginHost {
  return new PluginHost()
}
