import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DialogClose, DialogSurface } from './Dialog'

describe('DialogSurface', () => {
  it('provides a labelled modal and restores the controlled open state on close', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <DialogSurface
        open
        onOpenChange={onOpenChange}
        title={<h2>Account settings</h2>}
        description={<p>Update your account preferences.</p>}
      >
        <DialogClose asChild>
          <button type="button">Done</button>
        </DialogClose>
      </DialogSurface>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Account settings' })
    expect(dialog).toHaveAccessibleDescription('Update your account preferences.')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
