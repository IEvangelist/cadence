import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EditorDetailLane } from './EditorDetailLane'
import { coversInteractions } from '../../test/coversInteractions'

describe('<EditorDetailLane />', () => {
  it('renders one accessible detail panel and switches through its controlled API', async () => {
    coversInteractions('studio.editor-detail.tab')
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <EditorDetailLane
        activeId="velocity"
        onChange={onChange}
        items={[
          { id: 'velocity', label: 'Velocity', content: <p>Velocity editor</p> },
          { id: 'automation', label: 'Automation', content: <p>Automation editor</p> },
        ]}
      />,
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Velocity editor')
    await user.click(screen.getByRole('tab', { name: 'Automation' }))
    expect(onChange).toHaveBeenCalledWith('automation')

    rerender(
      <EditorDetailLane
        activeId="automation"
        onChange={onChange}
        items={[
          { id: 'velocity', label: 'Velocity', content: <p>Velocity editor</p> },
          { id: 'automation', label: 'Automation', content: <p>Automation editor</p> },
        ]}
      />,
    )
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Automation editor')
  })
})
