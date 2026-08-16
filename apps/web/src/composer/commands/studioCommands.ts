import { canonicalizeKeybinding, eventToKeybinding } from '../plugins/keybindings'

export type StudioCommandGroup = 'Project' | 'Transport' | 'Edit' | 'View' | 'Extensions'
export type StudioCommandSource = 'core' | 'plugin'

export interface StudioCommand {
  id: string
  title: string
  group: StudioCommandGroup
  binding?: string
  enabled: boolean
  source: StudioCommandSource
  run: () => void | Promise<void>
}

export interface StudioCommandCandidate extends Omit<StudioCommand, 'binding'> {
  defaultBinding?: string
}

export interface StudioCommandConflict {
  binding: string
  winnerId: string
  rejectedId: string
  reason: 'reserved-core' | 'duplicate'
  suggestedBinding?: string
}

export interface StudioCommandRegistry {
  commands: StudioCommand[]
  conflicts: StudioCommandConflict[]
}

export interface CoreStudioCommandActions {
  isPlaying: boolean
  togglePlay: () => void
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  openHelp: () => void
}

export const RESERVED_CORE_BINDINGS = new Map<string, string>([
  ['space', 'core.transport.toggle-play'],
  ['mod+z', 'core.edit.undo'],
  ['mod+shift+z', 'core.edit.redo'],
  ['?', 'core.view.shortcuts'],
])

export function createCoreStudioCommands(
  actions: CoreStudioCommandActions,
): StudioCommandCandidate[] {
  return [
    {
      id: 'core.transport.toggle-play',
      title: actions.isPlaying ? 'Pause' : 'Play',
      group: 'Transport',
      defaultBinding: 'space',
      enabled: true,
      source: 'core',
      run: actions.togglePlay,
    },
    {
      id: 'core.edit.undo',
      title: 'Undo',
      group: 'Edit',
      defaultBinding: 'mod+z',
      enabled: actions.canUndo,
      source: 'core',
      run: actions.undo,
    },
    {
      id: 'core.edit.redo',
      title: 'Redo',
      group: 'Edit',
      defaultBinding: 'mod+shift+z',
      enabled: actions.canRedo,
      source: 'core',
      run: actions.redo,
    },
    {
      id: 'core.view.shortcuts',
      title: 'Keyboard shortcuts',
      group: 'View',
      defaultBinding: '?',
      enabled: true,
      source: 'core',
      run: actions.openHelp,
    },
  ]
}

export function reservedCoreCommandFor(binding: string): string | undefined {
  return RESERVED_CORE_BINDINGS.get(canonicalizeKeybinding(binding))
}

interface BindingCandidate {
  command: StudioCommandCandidate
  binding: string
  overridden: boolean
}

const FALLBACK_KEYS = ['k', 'j', 'u', 'i', 'o', 'p'] as const

function suggestedBinding(used: ReadonlySet<string>): string | undefined {
  return FALLBACK_KEYS
    .map((key) => `mod+alt+${key}`)
    .find((binding) => !used.has(binding))
}

export function composeStudioCommands(
  core: readonly StudioCommandCandidate[],
  plugins: readonly StudioCommandCandidate[],
  overrides: Readonly<Record<string, string>>,
): StudioCommandRegistry {
  const bindings = new Map<string, string>()
  const conflicts: StudioCommandConflict[] = []
  const effective = new Map<string, string>()

  for (const command of core) {
    if (!command.defaultBinding) continue
    const binding = canonicalizeKeybinding(command.defaultBinding)
    bindings.set(binding, command.id)
    effective.set(command.id, binding)
  }

  const candidates: BindingCandidate[] = plugins.flatMap((command) => {
    const override = Object.hasOwn(overrides, command.id) ? overrides[command.id] : undefined
    const raw = override ?? command.defaultBinding
    if (!raw) return []
    return [{ command, binding: canonicalizeKeybinding(raw), overridden: override !== undefined }]
  })

  candidates.sort((left, right) => {
    if (left.overridden !== right.overridden) return left.overridden ? -1 : 1
    return left.command.id.localeCompare(right.command.id)
  })

  for (const candidate of candidates) {
    const winnerId = bindings.get(candidate.binding)
    if (winnerId) {
      conflicts.push({
        binding: candidate.binding,
        winnerId,
        rejectedId: candidate.command.id,
        reason: core.some((command) => command.id === winnerId)
          ? 'reserved-core'
          : 'duplicate',
        suggestedBinding: suggestedBinding(new Set(bindings.keys())),
      })
      continue
    }
    bindings.set(candidate.binding, candidate.command.id)
    effective.set(candidate.command.id, candidate.binding)
  }

  return {
    commands: [...core, ...plugins].map((command) => ({
      id: command.id,
      title: command.title,
      group: command.group,
      binding: effective.get(command.id),
      enabled: command.enabled,
      source: command.source,
      run: command.run,
    })),
    conflicts,
  }
}

function closestElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

export function isStudioShortcutScopeSuppressed(target: EventTarget | null): boolean {
  const element = closestElement(target)
  if (!element) return false
  if (
    element.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  ) {
    return true
  }
  return Boolean(
    element.closest(
      '[role="dialog"], [role="alertdialog"], dialog[open], [aria-modal="true"], [data-shortcut-recorder="active"]',
    ),
  )
}

export function dispatchStudioCommand(
  registry: StudioCommandRegistry,
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target' | 'preventDefault' | 'stopPropagation'
  >,
): boolean {
  if (isStudioShortcutScopeSuppressed(event.target)) return false
  const binding = eventToKeybinding(event)
  if (!binding) return false
  const command = registry.commands.find(
    (candidate) => candidate.binding === binding && candidate.enabled,
  )
  if (!command) return false
  event.preventDefault()
  event.stopPropagation()
  void command.run()
  return true
}
