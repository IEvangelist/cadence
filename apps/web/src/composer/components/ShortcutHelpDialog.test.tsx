import { useRef, useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StudioCommandRegistry } from '../commands/studioCommands'
import { ShortcutHelpDialog } from './ShortcutHelpDialog'
import { coversInteractions } from '../../test/coversInteractions'

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

function Harness() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Open shortcuts
      </button>
      <button type="button">Background action</button>
      <ShortcutHelpDialog
        open={open}
        registry={registry}
        onClose={() => setOpen(false)}
        returnFocusRef={triggerRef}
      />
    </>
  )
}

describe('<ShortcutHelpDialog />', () => {
  it('groups, searches, labels disabled commands, and explains conflicts', async () => {
    coversInteractions(
      'studio.shortcuts.dialog',
      'studio.shortcuts.search',
      'studio.shortcuts.close',
    )
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open shortcuts' }))
    expect(screen.getByRole('heading', { name: 'Transport' })).toBeInTheDocument()
    expect(screen.getByText(/Ctrl\+Alt\+C \(disabled\)/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/plugin.play cannot use Space/)

    await user.type(screen.getByRole('searchbox', { name: 'Search commands' }), 'chord')
    expect(screen.queryByText('Play')).not.toBeInTheDocument()
    expect(screen.getByText('Insert chord')).toBeInTheDocument()
  })

  it('traps focus and restores it after Escape and Close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open shortcuts' })
    await user.click(trigger)
    const search = screen.getByRole('searchbox', { name: 'Search commands' })
    const close = screen.getByRole('button', { name: 'Close' })
    expect(search).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
    await user.tab()
    expect(search).toHaveFocus()

    const background = screen.getByText('Background action').parentElement
    expect(background).toHaveAttribute(
      'data-aria-hidden',
      'true',
    )
    expect(document.body).toHaveStyle({ pointerEvents: 'none' })
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(trigger).toHaveFocus()
  })
})
