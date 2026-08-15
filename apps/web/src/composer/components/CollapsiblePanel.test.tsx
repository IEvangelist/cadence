import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
/* Interaction coverage: studio.panel.toggle */
import { describe, expect, it, vi } from 'vitest'
import { CollapsiblePanel } from './CollapsiblePanel'

function renderPanel(open: boolean, onToggle = vi.fn()) {
  render(
    <CollapsiblePanel id="mixer" title="Mixer" open={open} onToggle={onToggle}>
      <p>Panel body content</p>
    </CollapsiblePanel>,
  )
  return onToggle
}

describe('<CollapsiblePanel />', () => {
  it('exposes the title as a level-2 heading button', () => {
    renderPanel(true)
    const heading = screen.getByRole('heading', { level: 2, name: 'Mixer' })
    expect(heading).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mixer' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('shows the body when open and hides it when collapsed', () => {
    const { unmount } = render(
      <CollapsiblePanel id="mixer" title="Mixer" open onToggle={vi.fn()}>
        <p>Panel body content</p>
      </CollapsiblePanel>,
    )
    expect(screen.getByText('Panel body content')).toBeVisible()
    unmount()

    renderPanel(false)
    // `hidden` removes the body from the accessibility tree.
    expect(screen.queryByText('Panel body content')).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Mixer' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('calls onToggle with its id when the disclosure is clicked', async () => {
    const user = userEvent.setup()
    const onToggle = renderPanel(false)
    await user.click(screen.getByRole('button', { name: 'Mixer' }))
    expect(onToggle).toHaveBeenCalledWith('mixer')
  })

  it('wires aria-controls to the body element', () => {
    renderPanel(true)
    const button = screen.getByRole('button', { name: 'Mixer' })
    const controlledId = button.getAttribute('aria-controls')
    expect(controlledId).toBeTruthy()
    expect(document.getElementById(controlledId as string)).toHaveTextContent(
      'Panel body content',
    )
  })
})
