import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { createEmptyProject } from '../model/project'
import type { PanelContribution } from '../plugins'
import { PluginToolHost } from './PluginToolHost'

describe('<PluginToolHost />', () => {
  it('mounts only the active visible extension panel', () => {
    coversInteractions('studio.plugins.panel.open')
    const firstRender = vi.fn(() => <button type="button">First action</button>)
    const secondRender = vi.fn(() => <button type="button">Second action</button>)
    const panels: PanelContribution[] = [
      { id: 'first', title: 'First tool', render: firstRender },
      { id: 'second', title: 'Second tool', render: secondRender },
    ]

    render(
      <PluginToolHost
        panels={panels}
        context={{ project: createEmptyProject('p'), runCommand: vi.fn() }}
      />,
    )

    expect(firstRender).toHaveBeenCalledTimes(1)
    expect(secondRender).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'First tool' })).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Second tool' }))

    expect(secondRender).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'First tool' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Second tool' })).toBeVisible()
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
