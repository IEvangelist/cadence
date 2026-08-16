import { type KeyboardEvent, useState } from 'react'
import type { PluginsController } from '../plugins/usePlugins'
import { eventToKeybinding, formatKeybinding } from '../plugins/keybindings'

interface PluginsPanelProps {
  plugins: PluginsController
}

/** A small "press keys to record a shortcut" control for one command. */
function KeybindingRecorder({
  commandId,
  binding,
  onChange,
}: {
  commandId: string
  binding: string | undefined
  onChange: (commandId: string, binding: string | null) => void
}) {
  const [recording, setRecording] = useState(false)

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return
    // Escape clears the shortcut; Enter/Space are reserved for toggling.
    if (event.key === 'Escape') {
      event.preventDefault()
      onChange(commandId, null)
      setRecording(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') return
    const next = eventToKeybinding(event)
    if (!next) return // modifier-only — keep listening
    // Stop the global keybinding dispatcher from also firing while recording.
    event.preventDefault()
    event.stopPropagation()
    onChange(commandId, next)
    setRecording(false)
  }

  const label = recording ? 'Press keys…' : binding ? formatKeybinding(binding) : 'Set shortcut'

  return (
    <button
      type="button"
      className="btn btn-sm plugin-shortcut"
      data-interaction="studio.plugins.keybinding.record"
      data-shortcut-recorder={recording ? 'active' : undefined}
      aria-pressed={recording}
      aria-label={`Shortcut for command${binding ? `, currently ${formatKeybinding(binding)}` : ', not set'}`}
      onClick={() => setRecording((value) => !value)}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
    >
      {label}
    </button>
  )
}

/**
 * The Extensions panel: enable/disable plugins, run contributed commands (with
 * customizable keyboard shortcuts), and toggle contributed-panel visibility.
 * Brand-token themed, fully keyboard-operable, and axe-clean.
 */
export function PluginsPanel({ plugins }: PluginsPanelProps) {
  const {
    plugins: list,
    setPluginEnabled,
    commands,
    runCommand,
    keybindingFor,
    setKeybinding,
    allPanels,
    isPanelVisible,
    setPanelVisible,
    keybindingNotice,
  } = plugins

  return (
    <section className="plugins-panel" aria-label="Extensions">
      <header className="panel-header">
        <h3>Extensions</h3>
      </header>

      <ul className="plugin-list">
        {list.map((plugin) => (
          <li key={plugin.id} className="plugin-item">
            <label className="plugin-toggle">
              <input
                type="checkbox"
                data-interaction="studio.plugins.plugin.toggle"
                checked={plugin.enabled}
                disabled={plugin.builtin}
                onChange={(event) => setPluginEnabled(plugin.id, event.target.checked)}
              />
              <span className="plugin-name">{plugin.name}</span>
              {plugin.builtin && <span className="plugin-badge">Built-in</span>}
            </label>
            {plugin.description && <p className="plugin-desc">{plugin.description}</p>}
          </li>
        ))}
      </ul>

      {commands.length > 0 && (
        <div className="plugin-section">
          <h4 className="plugin-subhead">Commands</h4>
          <ul className="plugin-command-list">
            {commands.map((command) => (
              <li key={command.id} className="plugin-command">
                <button
                  type="button"
                  className="btn btn-sm"
                  data-interaction="studio.plugins.command.run"
                  onClick={() => runCommand(command.id)}
                >
                  {command.title}
                </button>
                <KeybindingRecorder
                  commandId={command.id}
                  binding={keybindingFor(command.id)}
                  onChange={setKeybinding}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      {keybindingNotice ? (
        <p className="plugin-keybinding-notice" role="status" aria-live="polite">
          {keybindingNotice}
        </p>
      ) : null}

      {allPanels.length > 0 && (
        <div className="plugin-section">
          <h4 className="plugin-subhead">Panels</h4>
          <ul className="plugin-list">
            {allPanels.map((panel) => (
              <li key={panel.id}>
                <label className="plugin-toggle">
                  <input
                    type="checkbox"
                    data-interaction="studio.plugins.panel.toggle"
                    checked={isPanelVisible(panel.id)}
                    onChange={(event) => setPanelVisible(panel.id, event.target.checked)}
                  />
                  <span className="plugin-name">{panel.title}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
