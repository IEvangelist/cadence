import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlugins } from './usePlugins'
import { createPluginHost } from './host'
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
})
