import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PluginsPanel } from './PluginsPanel'
import type { PluginsController } from '../plugins/usePlugins'
import { createEmptyProject } from '../model/project'

function makeController(overrides: Partial<PluginsController> = {}): PluginsController {
  return {
    plugins: [
      { id: 'cadence.core', name: 'Cadence Core', version: '1.0.0', builtin: true, enabled: true },
      {
        id: 'acme.extra',
        name: 'Acme Extra',
        description: 'Adds a marimba.',
        version: '1.0.0',
        builtin: false,
        enabled: false,
      },
    ],
    setPluginEnabled: vi.fn(),
    commands: [{ id: 'acme.hello', title: 'Say hello', keybinding: 'mod+shift+h', run: vi.fn() }],
    runCommand: vi.fn(),
    keybindingFor: (id) => (id === 'acme.hello' ? 'mod+shift+h' : undefined),
    setKeybinding: vi.fn(),
    visiblePanels: [],
    allPanels: [],
    isPanelVisible: () => true,
    setPanelVisible: vi.fn(),
    panelContext: { project: createEmptyProject('p'), runCommand: vi.fn() },
    ...overrides,
  }
}

function panelRegion() {
  return screen.getByRole('region', { name: 'Extensions' })
}

describe('<PluginsPanel />', () => {
  it('lists plugins and locks the built-in core toggle on', () => {
    render(<PluginsPanel plugins={makeController()} />)
    const panel = panelRegion()

    const core = within(panel).getByRole('checkbox', { name: /Cadence Core/ })
    expect(core).toBeChecked()
    expect(core).toBeDisabled()

    const extra = within(panel).getByRole('checkbox', { name: /Acme Extra/ })
    expect(extra).not.toBeChecked()
    expect(extra).toBeEnabled()
  })

  it('enables a plugin via its checkbox', () => {
    const setPluginEnabled = vi.fn()
    render(<PluginsPanel plugins={makeController({ setPluginEnabled })} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /Acme Extra/ }))
    expect(setPluginEnabled).toHaveBeenCalledWith('acme.extra', true)
  })

  it('runs a contributed command from its button', () => {
    const runCommand = vi.fn()
    render(<PluginsPanel plugins={makeController({ runCommand })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Say hello' }))
    expect(runCommand).toHaveBeenCalledWith('acme.hello')
  })

  it('records a new keyboard shortcut for a command', () => {
    const setKeybinding = vi.fn()
    render(<PluginsPanel plugins={makeController({ setKeybinding })} />)

    // The shortcut button shows the current binding; click to record, then press.
    const shortcut = screen.getByRole('button', { name: /Shortcut for command/ })
    expect(shortcut).toHaveTextContent('Ctrl+Shift+H')

    fireEvent.click(shortcut)
    fireEvent.keyDown(shortcut, { key: 'k', ctrlKey: true, altKey: true })
    expect(setKeybinding).toHaveBeenCalledWith('acme.hello', 'mod+alt+k')
  })

  it('clears a shortcut when Escape is pressed while recording', () => {
    const setKeybinding = vi.fn()
    render(<PluginsPanel plugins={makeController({ setKeybinding })} />)

    const shortcut = screen.getByRole('button', { name: /Shortcut for command/ })
    fireEvent.click(shortcut)
    fireEvent.keyDown(shortcut, { key: 'Escape' })
    expect(setKeybinding).toHaveBeenCalledWith('acme.hello', null)
  })

  it('toggles contributed-panel visibility', () => {
    const setPanelVisible = vi.fn()
    render(
      <PluginsPanel
        plugins={makeController({
          allPanels: [{ id: 'acme.side', title: 'Marimba tips', render: () => null }],
          setPanelVisible,
        })}
      />,
    )

    const toggle = screen.getByRole('checkbox', { name: /Marimba tips/ })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(setPanelVisible).toHaveBeenCalledWith('acme.side', false)
  })
})
