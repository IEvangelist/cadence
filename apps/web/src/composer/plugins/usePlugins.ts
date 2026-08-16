/**
 * usePlugins — the React glue between the {@link PluginHost}, user
 * {@link Preferences}, and the composer UI.
 *
 * Responsibilities:
 * - Expose the registered plugins and let the user enable/disable the
 *   non-builtin ones (persisted to preferences, applied to the host).
 * - Expose the active commands and run them through a {@link CommandApi} backed
 *   by the composer controller, plus dispatch their keybindings.
 * - Expose the active panels and their per-panel visibility preference.
 *
 * It reads from the shared {@link defaultPluginHost} and re-renders on any host
 * lifecycle change, so plugin-contributed capabilities appear live.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ComposerController } from '../hooks/useComposer'
import { defaultPluginHost } from './defaultHost'
import type { PluginHost } from './host'
import {
  type PreferencesStore,
  type Preferences,
  createPreferencesStore,
} from './preferences'
import { canonicalizeKeybinding } from './keybindings'
import { reservedCoreCommandFor } from '../commands/studioCommands'
import { CORE_PLUGIN_ID } from './builtins'
import type {
  CommandApi,
  CommandContribution,
  PanelContribution,
  PanelRenderContext,
} from './types'

export interface PluginSummary {
  id: string
  name: string
  description?: string
  version: string
  builtin: boolean
  enabled: boolean
}

export interface PluginsController {
  /** All registered plugins (builtin + third-party) with their enabled state. */
  plugins: PluginSummary[]
  /** Enable/disable a plugin (persisted); the builtin core can't be disabled. */
  setPluginEnabled: (id: string, enabled: boolean) => void
  /** Commands contributed by active plugins. */
  commands: CommandContribution[]
  /** Run a contributed command by id through the composer-backed CommandApi. */
  runCommand: (id: string) => void
  /** The effective keybinding for a command (override or default), if any. */
  keybindingFor: (commandId: string) => string | undefined
  /** Set or clear a command's keybinding override (persisted). */
  setKeybinding: (commandId: string, binding: string | null) => void
  /** Raw persisted overrides consumed by the internal Studio dispatcher. */
  keybindingOverrides: Readonly<Record<string, string>>
  /** Accessible feedback from the latest binding conflict, if any. */
  keybindingNotice: string | null
  /** Panels contributed by active plugins that are currently visible. */
  visiblePanels: PanelContribution[]
  /** All panels contributed by active plugins (for the visibility toggles). */
  allPanels: PanelContribution[]
  isPanelVisible: (id: string) => boolean
  setPanelVisible: (id: string, visible: boolean) => void
  /** Render context passed to a panel's `render`. */
  panelContext: PanelRenderContext
}

export interface UsePluginsOptions {
  /** Injected host (tests); defaults to the shared singleton. */
  host?: PluginHost
  /** Injected preferences store (tests); defaults to the browser-backed one. */
  preferencesStore?: PreferencesStore
}

export function usePlugins(
  controller: ComposerController,
  options: UsePluginsOptions = {},
): PluginsController {
  const host = options.host ?? defaultPluginHost
  const [store] = useState<PreferencesStore>(
    () => options.preferencesStore ?? createPreferencesStore(),
  )
  const [prefs, setPrefs] = useState<Preferences>(() => store.load())
  const [keybindingNotice, setKeybindingNotice] = useState<string | null>(null)

  // Force a re-render whenever the host's plugin set/state changes.
  const [hostVersion, bumpHostVersion] = useReducer((n: number) => n + 1, 0)
  useEffect(() => host.subscribe(bumpHostVersion), [host])

  const updatePrefs = useCallback(
    (mutate: (prefs: Preferences) => Preferences) => {
      setPrefs(store.update(mutate))
    },
    [store],
  )

  // Reconcile host activation with the saved preferences once on mount: a
  // non-builtin plugin is active iff the user has enabled it.
  const reconciled = useRef(false)
  useEffect(() => {
    if (reconciled.current) return
    reconciled.current = true
    const saved = store.load()
    for (const entry of host.list()) {
      if (entry.manifest.builtin) continue
      const id = entry.manifest.id
      // Trust only an own entry: a plugin id equal to an Object.prototype member
      // must default to disabled rather than reading an inherited truthy value.
      const enabled = Object.hasOwn(saved.enabledPlugins, id) ? saved.enabledPlugins[id] : false
      if (enabled && entry.state !== 'active') host.activate(id)
      else if (!enabled && entry.state === 'active') host.dispose(id)
    }
  }, [host, store])

  const plugins = useMemo<PluginSummary[]>(() => {
    void hostVersion // recompute as the host mutates
    return host.list().map((entry) => ({
      id: entry.manifest.id,
      name: entry.manifest.name,
      description: entry.manifest.description,
      version: entry.manifest.version,
      builtin: entry.manifest.builtin === true,
      enabled: entry.state === 'active',
    }))
  }, [host, hostVersion])

  const setPluginEnabled = useCallback(
    (id: string, enabled: boolean) => {
      if (id === CORE_PLUGIN_ID) return
      updatePrefs((p) => ({
        ...p,
        enabledPlugins: { ...p.enabledPlugins, [id]: enabled },
      }))
      if (enabled) host.activate(id)
      else host.dispose(id)
    },
    [host, updatePrefs],
  )

  const commands = useMemo(() => {
    void hostVersion
    return host.commands()
  }, [host, hostVersion])
  const allPanels = useMemo(() => {
    void hostVersion
    return host.panels()
  }, [host, hostVersion])

  const runCommand = useCallback(
    (id: string) => {
      const command = host.commands().find((c) => c.id === id)
      if (!command) return
      const api: CommandApi = {
        notify: (message) => controller.notify(message),
        getProject: () => controller.project,
        getSelectedTrackId: () => controller.selectedTrackId,
        insertNotes: (trackId, notes) => controller.insertNotes(trackId, notes),
      }
      void command.run(api)
    },
    [host, controller],
  )

  const keybindingFor = useCallback(
    (commandId: string) => {
      const binding =
        (Object.hasOwn(prefs.keybindings, commandId) ? prefs.keybindings[commandId] : undefined) ??
        host.commands().find((c) => c.id === commandId)?.keybinding
      return binding && !reservedCoreCommandFor(binding) ? canonicalizeKeybinding(binding) : undefined
    },
    [host, prefs.keybindings],
  )

  const setKeybinding = useCallback(
    (commandId: string, binding: string | null) => {
      const reserved = binding ? reservedCoreCommandFor(binding) : undefined
      if (reserved) {
        updatePrefs((p) => {
          const keybindings = { ...p.keybindings }
          delete keybindings[commandId]
          return { ...p, keybindings }
        })
        setKeybindingNotice(
          `${binding} is reserved by a core Studio command. Try Mod+Alt+K or another unassigned shortcut.`,
        )
        return
      }
      updatePrefs((p) => {
        const keybindings = { ...p.keybindings }
        if (binding) keybindings[commandId] = binding
        else delete keybindings[commandId]
        return { ...p, keybindings }
      })
      setKeybindingNotice(null)
    },
    [updatePrefs],
  )

  const isPanelVisible = useCallback(
    (id: string) => (Object.hasOwn(prefs.panelVisibility, id) ? prefs.panelVisibility[id] : true),
    [prefs.panelVisibility],
  )

  const setPanelVisible = useCallback(
    (id: string, visible: boolean) => {
      updatePrefs((p) => ({
        ...p,
        panelVisibility: { ...p.panelVisibility, [id]: visible },
      }))
    },
    [updatePrefs],
  )

  const visiblePanels = useMemo(
    () => allPanels.filter((panel) => isPanelVisible(panel.id)),
    [allPanels, isPanelVisible],
  )

  const panelContext = useMemo<PanelRenderContext>(
    () => ({ project: controller.project, runCommand }),
    [controller.project, runCommand],
  )

  return {
    plugins,
    setPluginEnabled,
    commands,
    runCommand,
    keybindingFor,
    setKeybinding,
    keybindingOverrides: prefs.keybindings,
    keybindingNotice,
    visiblePanels,
    allPanels,
    isPanelVisible,
    setPanelVisible,
    panelContext,
  }
}
