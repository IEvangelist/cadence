import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { StudioInspectorPanels } from './StudioInspectorPanels'

function InspectorHarness() {
  const [activePanel, setActivePanel] = useState('assistant')
  return (
    <StudioInspectorPanels
      panels={[
        { id: 'assistant', label: 'Assistant', content: <button type="button">Generate</button> },
        { id: 'ai', label: 'AI Studio', content: <button type="button">Humanize</button> },
        { id: 'extensions', label: 'Extensions', content: <button type="button">Enable</button> },
      ]}
      activePanel={activePanel}
      onPanelChange={setActivePanel}
    />
  )
}

describe('<StudioInspectorPanels />', () => {
  it('mounts only the active contextual panel', async () => {
    const user = userEvent.setup()
    render(<InspectorHarness />)

    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Humanize' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Extensions' }))

    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Extensions' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('falls back to the first panel when the requested panel is unavailable', () => {
    render(
      <StudioInspectorPanels
        panels={[{ id: 'assistant', label: 'Assistant', content: 'Ready' }]}
        activePanel="missing"
        onPanelChange={() => undefined}
      />,
    )

    expect(screen.getByRole('tabpanel')).toHaveTextContent('Ready')
    expect(screen.getByRole('tab', { name: 'Assistant' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('moves panel focus and content with arrow keys', async () => {
    const user = userEvent.setup()
    render(<InspectorHarness />)

    const assistant = screen.getByRole('tab', { name: 'Assistant' })
    assistant.focus()
    await user.keyboard('{ArrowLeft}')

    expect(screen.getByRole('tab', { name: 'Extensions' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument()
  })
})
