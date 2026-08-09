/**
 * User customization preferences — versioned, client-side, `localStorage`-backed.
 *
 * Follows the same defensive, schema-versioned pattern as `model/persistence.ts`:
 * a stored (possibly legacy/partial/corrupt) document is coerced into a valid
 * {@link Preferences} rather than crashing the UI. Preferences are non-critical,
 * so parsing never throws — an unreadable blob falls back to
 * {@link DEFAULT_PREFERENCES}. Backend sync is out of scope (MVP is local-first).
 *
 * What we persist: which non-builtin plugins are enabled, per-command keybinding
 * overrides, panel visibility, and the selected AI provider.
 */
import {
  type SyncStorage,
  MemoryStorage,
} from '../model/storage'

/** Current preferences schema version. Bump when the shape changes. */
export const PREFERENCES_SCHEMA_VERSION = 1

export interface Preferences {
  schemaVersion: number
  /** Plugin id → enabled. Absent means "use the plugin's default". */
  enabledPlugins: Record<string, boolean>
  /** Command id → keybinding override (e.g. `mod+shift+h`). */
  keybindings: Record<string, string>
  /** Panel id → visible. Absent means visible by default. */
  panelVisibility: Record<string, boolean>
  /** Selected AI provider id, or null to use the environment default. */
  aiProviderId: string | null
}

/**
 * A prototype-less string map. Preference maps are keyed by untrusted plugin /
 * command / panel ids, so building them with a null prototype means an id that
 * equals an `Object.prototype` member (`constructor`, `toString`, ...) can never
 * read an inherited value and defeat a `map[id]` gate.
 */
function emptyIdMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

/** The out-of-the-box preferences. */
export const DEFAULT_PREFERENCES: Preferences = {
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  enabledPlugins: emptyIdMap<boolean>(),
  keybindings: emptyIdMap<string>(),
  panelVisibility: emptyIdMap<boolean>(),
  aiProviderId: null,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Keep only `string → boolean` entries from an untrusted record. */
function coerceBoolMap(value: unknown): Record<string, boolean> {
  const out = emptyIdMap<boolean>()
  if (!isRecord(value)) return out
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'boolean') out[key] = v
  }
  return out
}

/** Keep only `string → non-empty string` entries from an untrusted record. */
function coerceStringMap(value: unknown): Record<string, string> {
  const out = emptyIdMap<string>()
  if (!isRecord(value)) return out
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'string' && v.length > 0) out[key] = v
  }
  return out
}

/** Normalize any stored/parsed value into valid current-schema preferences. */
export function migratePreferences(data: unknown): Preferences {
  if (!isRecord(data)) return { ...DEFAULT_PREFERENCES }
  return {
    schemaVersion: PREFERENCES_SCHEMA_VERSION,
    enabledPlugins: coerceBoolMap(data.enabledPlugins),
    keybindings: coerceStringMap(data.keybindings),
    panelVisibility: coerceBoolMap(data.panelVisibility),
    aiProviderId: typeof data.aiProviderId === 'string' ? data.aiProviderId : null,
  }
}

/** Serialize preferences to a JSON string. */
export function serializePreferences(prefs: Preferences): string {
  return JSON.stringify(prefs)
}

/** Parse a JSON string into validated, migrated preferences (never throws). */
export function parsePreferences(raw: string): Preferences {
  try {
    return migratePreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

const PREFERENCES_KEY = 'cadence.v1.preferences'

/**
 * A tiny synchronous preferences store over a {@link SyncStorage} backend
 * (`window.localStorage` in the app, {@link MemoryStorage} elsewhere).
 */
export class PreferencesStore {
  private readonly storage: SyncStorage

  constructor(storage: SyncStorage) {
    this.storage = storage
  }

  /** Load preferences, falling back to defaults when absent/corrupt. */
  load(): Preferences {
    const raw = this.storage.getItem(PREFERENCES_KEY)
    return raw ? parsePreferences(raw) : { ...DEFAULT_PREFERENCES }
  }

  /** Persist preferences. */
  save(prefs: Preferences): void {
    this.storage.setItem(PREFERENCES_KEY, serializePreferences(prefs))
  }

  /** Read, transform, and persist in one step; returns the saved value. */
  update(mutate: (prefs: Preferences) => Preferences): Preferences {
    const next = mutate(this.load())
    this.save(next)
    return next
  }
}

/** Build the default browser-backed store, or a memory store when unavailable. */
export function createPreferencesStore(): PreferencesStore {
  const hasLocalStorage =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined'
  const backend: SyncStorage = hasLocalStorage
    ? (globalThis as unknown as { localStorage: SyncStorage }).localStorage
    : new MemoryStorage()
  return new PreferencesStore(backend)
}
