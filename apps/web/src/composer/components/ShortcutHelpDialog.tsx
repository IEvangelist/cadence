import { useMemo, useRef, useState, type RefObject } from 'react'
import { formatKeybinding } from '../plugins/keybindings'
import type { StudioCommandGroup, StudioCommandRegistry } from '../commands/studioCommands'
import { DialogClose, DialogSurface } from '../../ui/Dialog'
import { usePlatformCapabilities } from '../../platform/platformCapabilitiesContext'
import './EditorWorkspace.css'

interface ShortcutHelpDialogProps {
  open: boolean
  registry: StudioCommandRegistry
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
}

const GROUPS: StudioCommandGroup[] = ['Project', 'Transport', 'Edit', 'View', 'Extensions']

export function ShortcutHelpDialog({
  open,
  registry,
  onClose,
  returnFocusRef,
}: ShortcutHelpDialogProps) {
  const [query, setQuery] = useState('')
  const { keyboardPlatform } = usePlatformCapabilities()
  const searchRef = useRef<HTMLInputElement>(null)
  const commands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return registry.commands.filter(
      (command) =>
        normalized.length === 0 ||
        command.title.toLocaleLowerCase().includes(normalized) ||
        command.group.toLocaleLowerCase().includes(normalized),
    )
  }, [query, registry.commands])
  return (
    <DialogSurface
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
      title={<h2>Keyboard shortcuts</h2>}
      description={<p>Core Studio shortcuts are reserved from extensions.</p>}
      contentClassName="shortcut-help"
      role="dialog"
      data-interaction="studio.shortcuts.dialog"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        searchRef.current?.focus()
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault()
        returnFocusRef.current?.focus()
      }}
    >
      <header>
        <DialogClose asChild>
          <button
            type="button"
            className="btn"
            data-interaction="studio.shortcuts.close"
          >
            Close
          </button>
        </DialogClose>
      </header>
      <label htmlFor="shortcut-help-search">Search commands</label>
      <input
        ref={searchRef}
        id="shortcut-help-search"
        type="search"
        data-interaction="studio.shortcuts.search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="shortcut-help__groups">
        {GROUPS.map((group) => {
          const grouped = commands.filter((command) => command.group === group)
          if (grouped.length === 0) return null
          return (
            <section key={group} aria-labelledby={`shortcut-group-${group}`}>
              <h3 id={`shortcut-group-${group}`}>{group}</h3>
              <ul>
                {grouped.map((command) => (
                  <li key={command.id}>
                    <span>{command.title}</span>
                    <span>
                      {command.binding
                        ? formatKeybinding(command.binding, keyboardPlatform)
                        : 'Unassigned'}
                      {!command.enabled ? ' (disabled)' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {registry.conflicts.length > 0 ? (
        <div className="shortcut-help__conflicts" role="status">
          {registry.conflicts.map((conflict) => (
            <p key={`${conflict.rejectedId}-${conflict.binding}`}>
              {conflict.rejectedId} cannot use{' '}
              {formatKeybinding(conflict.binding, keyboardPlatform)} because it is
              already assigned to {conflict.winnerId}.
              {conflict.suggestedBinding
                ? ` Try ${formatKeybinding(conflict.suggestedBinding, keyboardPlatform)}.`
                : ''}
            </p>
          ))}
        </div>
      ) : null}
    </DialogSurface>
  )
}
