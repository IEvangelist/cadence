import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  createMemoryRouter,
  RouterProvider,
  useNavigate,
} from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { StudioNavigationGuard } from './StudioNavigationGuard'

function Studio({ flushAutosave }: { flushAutosave: () => Promise<void> }) {
  const navigate = useNavigate()
  const [dirty] = useState(true)
  return (
    <>
      <StudioNavigationGuard controller={{ isDirty: dirty, flushAutosave }} />
      <button type="button" onClick={() => void navigate('/pricing')}>
        Leave
      </button>
    </>
  )
}

function renderGuard(flushAutosave: () => Promise<void>) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <Studio flushAutosave={flushAutosave} /> },
      { path: '/pricing', element: <h1>Pricing</h1> },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('<StudioNavigationGuard />', () => {
  it('retries a failed save before proceeding', async () => {
    coversInteractions('studio.autosave.retry')
    const user = userEvent.setup()
    const flush = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    renderGuard(flush)

    await user.click(screen.getByRole('button', { name: 'Leave' }))
    await user.click(await screen.findByRole('button', { name: 'Retry save' }))

    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument()
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('requires an explicit discard after a failed save', async () => {
    coversInteractions('studio.autosave.discard')
    const user = userEvent.setup()
    renderGuard(vi.fn(async () => Promise.reject(new Error('offline'))))

    await user.click(screen.getByRole('button', { name: 'Leave' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))

    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument()
  })
})
