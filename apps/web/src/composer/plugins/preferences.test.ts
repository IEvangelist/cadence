import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../model/storage'
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_SCHEMA_VERSION,
  PreferencesStore,
  migratePreferences,
  parsePreferences,
  serializePreferences,
} from './preferences'

describe('preferences serialize/parse round trip', () => {
  it('preserves a full preferences object', () => {
    const prefs = {
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      enabledPlugins: { 'acme.hello': true },
      keybindings: { 'acme.hello.cmd': 'mod+shift+h' },
      panelVisibility: { assistant: false },
      aiProviderId: 'mock',
    }
    expect(parsePreferences(serializePreferences(prefs))).toEqual(prefs)
  })
})

describe('migratePreferences', () => {
  it('returns defaults for non-objects', () => {
    expect(migratePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(migratePreferences(42)).toEqual(DEFAULT_PREFERENCES)
    expect(migratePreferences([1, 2])).toEqual(DEFAULT_PREFERENCES)
  })

  it('drops malformed entries and stamps the current schema version', () => {
    const migrated = migratePreferences({
      schemaVersion: 0,
      enabledPlugins: { good: true, bad: 'yes' },
      keybindings: { cmd: 'mod+k', empty: '', wrong: 5 },
      panelVisibility: { plugins: true, nope: 1 },
      aiProviderId: 123,
    })
    expect(migrated).toEqual({
      schemaVersion: PREFERENCES_SCHEMA_VERSION,
      enabledPlugins: { good: true },
      keybindings: { cmd: 'mod+k' },
      panelVisibility: { plugins: true },
      aiProviderId: null,
    })
  })

  it('upgrades a legacy/partial document', () => {
    const migrated = migratePreferences({ aiProviderId: 'magenta' })
    expect(migrated.schemaVersion).toBe(PREFERENCES_SCHEMA_VERSION)
    expect(migrated.aiProviderId).toBe('magenta')
    expect(migrated.enabledPlugins).toEqual({})
  })
})

describe('parsePreferences', () => {
  it('falls back to defaults on invalid JSON', () => {
    expect(parsePreferences('{not json')).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('PreferencesStore', () => {
  it('returns defaults when nothing is stored', () => {
    const store = new PreferencesStore(new MemoryStorage())
    expect(store.load()).toEqual(DEFAULT_PREFERENCES)
  })

  it('round-trips through the backend', () => {
    const store = new PreferencesStore(new MemoryStorage())
    const saved = store.update((p) => ({ ...p, aiProviderId: 'mock' }))
    expect(saved.aiProviderId).toBe('mock')
    expect(store.load().aiProviderId).toBe('mock')
  })

  it('recovers defaults from a corrupt stored blob', () => {
    const backend = new MemoryStorage()
    backend.setItem('cadence.v1.preferences', 'not-json')
    const store = new PreferencesStore(backend)
    expect(store.load()).toEqual(DEFAULT_PREFERENCES)
  })
})
