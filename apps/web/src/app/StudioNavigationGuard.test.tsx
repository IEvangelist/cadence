import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryRouter,
  RouterProvider,
  useNavigate,
} from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { StudioNavigationGuard } from './StudioNavigationGuard'

function Studio({
  flushAutosave,
  discardAutosaveRecovery = vi.fn(),
  dirty = true,
  isFlushing = false,
}: {
  flushAutosave: () => Promise<void>
  discardAutosaveRecovery?: () => void
  dirty?: boolean
  isFlushing?: boolean
}) {
  const navigate = useNavigate()
  return (
    <>
      <StudioNavigationGuard
        controller={{
          isDirty: dirty,
          isFlushing,
          flushAutosave,
          discardAutosaveRecovery,
        }}
      />
      <button type="button" onClick={() => void navigate('/pricing')}>
        Pricing
      </button>
      <button type="button" onClick={() => void navigate('/stems')}>
        Stems
      </button>
    </>
  )
}

function renderGuard(
  flushAutosave: () => Promise<void>,
  discardAutosaveRecovery = vi.fn(),
) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <Studio
            flushAutosave={flushAutosave}
            discardAutosaveRecovery={discardAutosaveRecovery}
          />
        ),
      },
      { path: '/pricing', element: <h1>Pricing</h1> },
      { path: '/stems', element: <h1>Stems</h1> },
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

    await user.click(screen.getByRole('button', { name: 'Pricing' }))
    await user.click(await screen.findByRole('button', { name: 'Retry save' }))

    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument()
    expect(flush).toHaveBeenCalledTimes(2)
  })

  it('requires an explicit discard after a failed save', async () => {
    coversInteractions('studio.autosave.discard')
    const user = userEvent.setup()
    const discardRecovery = vi.fn()
    renderGuard(
      vi.fn(async () => Promise.reject(new Error('offline'))),
      discardRecovery,
    )

    await user.click(screen.getByRole('button', { name: 'Pricing' }))
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }))

    expect(await screen.findByRole('heading', { name: 'Pricing' })).toBeInTheDocument()
    expect(discardRecovery).toHaveBeenCalledOnce()
  })

  it('registers beforeunload only while dirty or flushing', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const flush = vi.fn(async () => undefined)
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <Studio flushAutosave={flush} dirty={false} />,
        },
      ],
      { initialEntries: ['/'] },
    )
    const rendered = render(<RouterProvider router={router} />)
    expect(add.mock.calls.some(([type]) => String(type) === 'beforeunload')).toBe(false)

    const dirtyRouter = createMemoryRouter(
      [
        {
          path: '/',
          element: <Studio flushAutosave={flush} dirty />,
        },
      ],
      { initialEntries: ['/'] },
    )
    rendered.rerender(<RouterProvider router={dirtyRouter} />)
    expect(add.mock.calls.some(([type]) => String(type) === 'beforeunload')).toBe(true)

    rendered.unmount()
    expect(remove.mock.calls.some(([type]) => String(type) === 'beforeunload')).toBe(true)

    const flushingRouter = createMemoryRouter(
      [
        {
          path: '/',
          element: <Studio flushAutosave={flush} dirty={false} isFlushing />,
        },
      ],
      { initialEntries: ['/'] },
    )
    render(<RouterProvider router={flushingRouter} />)
    expect(add.mock.calls.filter(([type]) => String(type) === 'beforeunload')).toHaveLength(2)
  })

  it('allows only the latest blocked destination to proceed', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    const pending = new Promise<void>((accept) => {
      resolve = accept
    })
    const flush = vi.fn(() => pending)
    renderGuard(flush)

    await user.click(screen.getByRole('button', { name: 'Pricing' }))
    await user.click(screen.getByRole('button', { name: 'Stems' }))
    resolve()

    expect(await screen.findByRole('heading', { name: 'Stems' })).toBeInTheDocument()
    expect(flush).toHaveBeenCalledTimes(1)
  })
})
