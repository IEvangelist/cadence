import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioCommandRegistry } from '../commands/studioCommands'
import { ShortcutHelpDialog } from './ShortcutHelpDialog'

const registry: StudioCommandRegistry = {
  commands: [
    {
      id: 'core.transport.toggle-play',
      title: 'Play',
      group: 'Transport',
      binding: 'space',
      enabled: true,
      source: 'core',
      run: vi.fn(),
    },
    {
      id: 'plugin.chord',
      title: 'Insert chord',
      group: 'Extensions',
      binding: 'mod+alt+c',
      enabled: false,
      source: 'plugin',
      run: vi.fn(),
    },
  ],
  conflicts: [
    {
      binding: 'space',
      winnerId: 'core.transport.toggle-play',
      rejectedId: 'plugin.play',
      reason: 'reserved-core',
      suggestedBinding: 'mod+alt+k',
    },
  ],
}

describe('<ShortcutHelpDialog />', () => {
  it('groups, searches, labels disabled commands, and explains conflicts', async () => {
    const user = userEvent.setup()
    render(<ShortcutHelpDialog open registry={registry} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Transport' })).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+Alt\+C \(disabled\)/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/plugin.play cannot use Space/)

    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'chord')
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
    expect(screen.getByText('Insert chord')).toBeInTheDocument()
  })

  it('closes with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ShortcutHelpDialog open registry={registry} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
