import { useEffect, useMemo } from 'react'
import type { PluginsController } from '../plugins/usePlugins'
import {
  composeStudioCommands,
  createCoreStudioCommands,
  dispatchStudioCommand,
  type CoreStudioCommandActions,
  type StudioCommandRegistry,
} from './studioCommands'

export function useStudioCommandDispatcher(
  actions: CoreStudioCommandActions,
  plugins: PluginsController,
): StudioCommandRegistry {
  const { commands, keybindingOverrides, runCommand } = plugins
  const core = useMemo(() => createCoreStudioCommands(actions), [actions])
  const candidates = useMemo(
    () =>
      commands.map((command) => ({
        id: command.id,
        title: command.title,
        group: 'Extensions' as const,
        defaultBinding: command.keybinding,
        enabled: true,
        source: 'plugin' as const,
        run: () => runCommand(command.id),
      })),
    [commands, runCommand],
  )
  const registry = useMemo(
    () => composeStudioCommands(core, candidates, keybindingOverrides),
    [candidates, core, keybindingOverrides],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      dispatchStudioCommand(registry, event)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [registry])

  return registry
}
