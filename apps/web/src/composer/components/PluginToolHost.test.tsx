import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { createEmptyProject } from '../model/project'
import type { PanelContribution } from '../plugins'
import { PluginToolHost } from './PluginToolHost'

describe('<PluginToolHost />', () => {
  it('mounts the active panel with complete tabs semantics and roving focus', async () => {
    coversInteractions('studio.plugins.panel.open')
    const firstRender = vi.fn(() => <button type="button">First action</button>)
    const secondRender = vi.fn(() => <button type="button">Second action</button>)
    const panels: PanelContribution[] = [
      { id: 'first', title: 'First tool', render: firstRender },
      { id: 'second', title: 'Second tool', render: secondRender },
    ]

    const { rerender } = render(
      <PluginToolHost
        panels={panels}
        context={{ project: createEmptyProject('p'), runCommand: vi.fn() }}
      />,
    )

    expect(firstRender).toHaveBeenCalledTimes(1)
    expect(secondRender).not.toHaveBeenCalled()
    const firstTab = screen.getByRole('tab', { name: 'First tool' })
    const secondTab = screen.getByRole('tab', { name: 'Second tool' })
    const panel = screen.getByRole('tabpanel')
    expect(firstTab).toHaveAttribute('aria-controls', 'plugin-tool-panel')
    expect(secondTab).toHaveAttribute('aria-controls', 'plugin-tool-panel')
    expect(firstTab).toHaveAttribute('aria-selected', 'true')
    expect(firstTab).toHaveAttribute('tabindex', '0')
    expect(secondTab).toHaveAttribute('tabindex', '-1')
    expect(panel).toHaveAttribute('id', 'plugin-tool-panel')
    expect(panel).toHaveAttribute('aria-labelledby', firstTab.id)
    expect(screen.getByRole('region', { name: 'First tool' })).toBeVisible()

    fireEvent.keyDown(firstTab, { key: 'ArrowRight' })

    expect(secondRender).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'First tool' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Second tool' })).toBeVisible()
    expect(secondTab).toHaveFocus()
    expect(secondTab).toHaveAttribute('aria-selected', 'true')
    expect(secondTab).toHaveAttribute('tabindex', '0')
    expect(firstTab).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', secondTab.id)

    fireEvent.keyDown(secondTab, { key: 'Home' })
    expect(firstTab).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', firstTab.id)

    fireEvent.keyDown(firstTab, { key: 'End' })
    expect(secondTab).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', secondTab.id)

    rerender(
      <PluginToolHost
        panels={[panels[0]]}
        context={{ project: createEmptyProject('p'), runCommand: vi.fn() }}
      />,
    )
    await waitFor(() => expect(firstTab).toHaveFocus())
    expect(screen.getByRole('tab', { name: 'First tool' })).toHaveAttribute('tabindex', '0')
  })

  it('renders nothing when all contributed panels are hidden upstream', () => {
    const { container } = render(
      <PluginToolHost
        panels={[]}
        context={{ project: createEmptyProject('p'), runCommand: vi.fn() }}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
