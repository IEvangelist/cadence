import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlugins } from './usePlugins'
import { createPluginHost, type PluginHost } from './host'
import { PreferencesStore } from './preferences'
import { MemoryStorage } from '../model/storage'
import { createEmptyProject } from '../model/project'
import type { ComposerController } from '../hooks/useComposer'
import type { CadencePlugin, CommandApi } from './types'

/** A stub controller exposing only what usePlugins reads. */
function stubController() {
  return {
    project: createEmptyProject('p'),
    selectedTrackId: 't1',
    insertNotes: vi.fn(),
    notify: vi.fn(),
  } as unknown as ComposerController
}

function commandPlugin(run: (api: CommandApi) => void): CadencePlugin {
  return {
    manifest: { id: 'acme.cmd', name: 'Acme Commands', version: '1.0.0' },
    contributes: {
      commands: [
        { id: 'acme.hello', title: 'Say hello', keybinding: 'mod+shift+h', run },
      ],
    },
  }
}

function enabledStore(...ids: string[]) {
  const store = new PreferencesStore(new MemoryStorage())
  const enabledPlugins: Record<string, boolean> = {}
  for (const id of ids) enabledPlugins[id] = true
  store.save({
    schemaVersion: 1,
    enabledPlugins,
    keybindings: {},
    panelVisibility: {},
    aiProviderId: null,
  })
  return store
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('usePlugins', () => {
  it('reconciles host activation with saved preferences on mount', () => {
    const host = createPluginHost()
    host.register({
      manifest: { id: 'acme.extra', name: 'Extra', version: '1.0.0' },
      contributes: {},
    })
    const store = new PreferencesStore(new MemoryStorage())
    store.save({
      schemaVersion: 1,
      enabledPlugins: { 'acme.extra': true },
      keybindings: {},
      panelVisibility: {},
      aiProviderId: null,
    })

    const { result } = renderHook(() =>
      usePlugins(stubController(), { host, preferencesStore: store }),
    )

    expect(host.isActive('acme.extra')).toBe(true)
    expect(result.current.plugins.find((p) => p.id === 'acme.extra')?.enabled).toBe(true)
  })

  it('enables and disables a plugin, persisting the choice', () => {
    const host = createPluginHost()
    host.register({
      manifest: { id: 'acme.extra', name: 'Extra', version: '1.0.0' },
      contributes: {},
    })
    const store = new PreferencesStore(new MemoryStorage())

    const { result } = renderHook(() =>
      usePlugins(stubController(), { host, preferencesStore: store }),
    )

    expect(host.isActive('acme.extra')).toBe(false)

    act(() => result.current.setPluginEnabled('acme.extra', true))
    expect(host.isActive('acme.extra')).toBe(true)
    expect(store.load().enabledPlugins['acme.extra']).toBe(true)

    act(() => result.current.setPluginEnabled('acme.extra', false))
    expect(host.isActive('acme.extra')).toBe(false)
    expect(store.load().enabledPlugins['acme.extra']).toBe(false)
  })

  it('runs a command through a CommandApi backed by the controller', () => {
    const host = createPluginHost()
    let selectedSeen = ''
    host.register(
      commandPlugin((api: CommandApi) => {
        selectedSeen = api.getSelectedTrackId()
        api.notify('done')
        api.insertNotes('t1', [{ pitch: 60, start: 0, duration: 1, velocity: 0.8 }])
      }),
    )
    const controller = stubController()
    const store = enabledStore('acme.cmd')

    const { result } = renderHook(() =>
      usePlugins(controller, { host, preferencesStore: store }),
    )

    act(() => result.current.runCommand('acme.hello'))

    expect(selectedSeen).toBe('t1')
    expect(controller.notify).toHaveBeenCalledWith('done')
    expect(controller.insertNotes).toHaveBeenCalledWith('t1', [
      { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
    ])
  })

  it('dispatches a command from its keybinding, honoring overrides', () => {
    const host = createPluginHost()
    const run = vi.fn()
    host.register(commandPlugin(run))
    const store = enabledStore('acme.cmd')

    const { result } = renderHook(() =>
      usePlugins(stubController(), { host, preferencesStore: store }),
    )

    // Default binding fires.
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, shiftKey: true }),
      )
    })
    expect(run).toHaveBeenCalledTimes(1)

    // Override the binding; the old one no longer fires, the new one does.
    act(() => result.current.setKeybinding('acme.hello', 'mod+alt+z'))
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, shiftKey: true }),
      )
    })
    expect(run).toHaveBeenCalledTimes(1)
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, altKey: true }),
      )
    })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('tracks panel visibility with a persisted default of visible', () => {
    const host = createPluginHost()
    host.register({
      manifest: { id: 'acme.panel', name: 'Panel', version: '1.0.0' },
      contributes: {
        panels: [{ id: 'acme.side', title: 'Side', render: () => null }],
      },
    })
    const store = enabledStore('acme.panel')

    const { result } = renderHook(() =>
      usePlugins(stubController(), { host, preferencesStore: store }),
    )

    expect(result.current.isPanelVisible('acme.side')).toBe(true)
    expect(result.current.visiblePanels).toHaveLength(1)

    act(() => result.current.setPanelVisible('acme.side', false))
    expect(result.current.isPanelVisible('acme.side')).toBe(false)
    expect(result.current.visiblePanels).toHaveLength(0)
    expect(store.load().panelVisibility['acme.side']).toBe(false)
  })

  // Security (prototype-pollution gate bypass): the enable state is read from a
  // plain-object map keyed by the untrusted plugin id. An id equal to an
  // Object.prototype member (e.g. `constructor`) would otherwise read an inherited
  // truthy value and get silently activated even though the user never enabled it.
  it('does not activate a plugin whose id collides with an Object.prototype member', () => {
    const entry = {
      manifest: { id: 'constructor', name: 'Evil', version: '1.0.0' },
      plugin: {},
      state: 'registered' as const,
    }
    const activate = vi.fn()
    const dispose = vi.fn()
    const host = {
      subscribe: () => () => {},
      list: () => [entry],
      commands: () => [],
      panels: () => [],
      activate,
      dispose,
    } as unknown as PluginHost
    // Default (empty) preferences: nothing has been explicitly enabled.
    const store = new PreferencesStore(new MemoryStorage())

    const { result } = renderHook(() =>
      usePlugins(stubController(), { host, preferencesStore: store }),
    )

    expect(activate).not.toHaveBeenCalled()
    expect(result.current.plugins.find((p) => p.id === 'constructor')?.enabled).toBe(false)
  })

  it('keydown dispatch is a safe no-op for a command id that collides with a prototype member', () => {
    const host = createPluginHost()
    const run = vi.fn()
    // Valid manifest id, but the contributed command id shadows Object.prototype.
    host.use({
      manifest: { id: 'acme.evil', name: 'Evil', version: '1.0.0' },
      contributes: {
        commands: [{ id: 'toString', title: 'Danger', keybinding: 'mod+shift+t', run }],
      },
    })
    const store = enabledStore('acme.evil')

    // Mount must not crash while building the keybinding map from a plain-keyed
    // overrides object (the pre-fix bug read Object.prototype.toString as data).
    renderHook(() => usePlugins(stubController(), { host, preferencesStore: store }))

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', ctrlKey: true, shiftKey: true }),
      )
    })
    expect(run).toHaveBeenCalledTimes(1)

    // An unbound shortcut does nothing — no inherited-member bypass.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true }))
    })
    expect(run).toHaveBeenCalledTimes(1)
  })
})
