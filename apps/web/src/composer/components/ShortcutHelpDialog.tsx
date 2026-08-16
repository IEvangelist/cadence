import { useEffect, useMemo, useRef, useState } from 'react'
import { formatKeybinding } from '../plugins/keybindings'
import type { StudioCommandGroup, StudioCommandRegistry } from '../commands/studioCommands'
import './EditorWorkspace.css'

interface ShortcutHelpDialogProps {
  open: boolean
  registry: StudioCommandRegistry
  onClose: () => void
}

const GROUPS: StudioCommandGroup[] = ['Project', 'Transport', 'Edit', 'View', 'Extensions']

export function ShortcutHelpDialog({
  open,
  registry,
  onClose,
}: ShortcutHelpDialogProps) {
  const [query, setQuery] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const commands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return registry.commands.filter(
      (command) =>
        normalized.length === 0 ||
        command.title.toLocaleLowerCase().includes(normalized) ||
        command.group.toLocaleLowerCase().includes(normalized),
    )
  }, [query, registry.commands])
  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      ref={dialogRef}
      className="shortcut-help"
      role="dialog"
      data-interaction="studio.shortcuts.dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <header>
        <div>
          <h2 id="shortcut-help-title">Keyboard shortcuts</h2>
          <p>Core Studio shortcuts are reserved from extensions.</p>
        </div>
        <button
          type="button"
          className="btn"
          data-interaction="studio.shortcuts.close"
          onClick={onClose}
        >
          Close
        </button>
      </header>
      <label htmlFor="shortcut-help-search">Search commands</label>
      <input
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
                      {command.binding ? formatKeybinding(command.binding) : 'Unassigned'}
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
              {conflict.rejectedId} cannot use {formatKeybinding(conflict.binding)} because it is
              already assigned to {conflict.winnerId}.
              {conflict.suggestedBinding
                ? ` Try ${formatKeybinding(conflict.suggestedBinding)}.`
                : ''}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
