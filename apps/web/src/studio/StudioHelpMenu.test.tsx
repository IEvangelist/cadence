import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { StudioHelpMenu } from './StudioHelpMenu'

describe('<StudioHelpMenu />', () => {
  it('keeps secondary destinations hidden until Help opens', async () => {
    coversInteractions('studio.help.toggle')
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<StudioHelpMenu onNavigate={onNavigate} />)

    expect(screen.queryByRole('menuitem', { name: 'Stem separation' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Help' }))
    await user.click(screen.getByRole('menuitem', { name: 'Third-party licenses' }))

    expect(onNavigate).toHaveBeenCalledWith('/licenses')
  })
})
