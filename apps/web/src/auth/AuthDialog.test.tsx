import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLocation, MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import type { AuthClient } from './authClient'
import { AuthContext, type AuthContextValue } from './authContext'
import { AuthDialogProvider } from './AuthDialog'
import { useAuthDialog } from './authDialogContext'
import { takeAuthReturnTarget } from './authReturnTarget'

function makeValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    status: 'anonymous',
    providers: [],
    error: null,
    client: {
      externalSignInUrl: (provider: string) => `/api/auth/external/${provider}`,
    } as unknown as AuthClient,
    register: vi.fn(async () => undefined),
    signIn: vi.fn(async () => undefined),
    requestMagicLink: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  }
}

function Harness({ target = '/profile?collab=p1#project=x' }: { target?: string }) {
  const dialog = useAuthDialog()
  const location = useLocation()
  return (
    <>
      <button type="button" onClick={() => dialog.openAuth({ returnTarget: target })}>
        Open sign in
      </button>
      <output data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
    </>
  )
}

function renderDialog(value: AuthContextValue, target?: string) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthContext value={value}>
        <AuthDialogProvider>
          <Harness target={target} />
        </AuthDialogProvider>
      </AuthContext>
    </MemoryRouter>,
  )
}

describe('AuthDialogProvider', () => {
  it('submits local sign-in and returns to the guarded route', async () => {
    coversInteractions(
      'auth.dialog.close',
      'auth.credentials.email',
      'auth.credentials.password',
      'auth.credentials.submit',
    )
    const user = userEvent.setup()
    const signIn = vi.fn(async () => undefined)
    renderDialog(makeValue({ signIn }))

    await user.click(screen.getByRole('button', { name: 'Open sign in' }))
    expect(
      await screen.findByRole('dialog', { name: 'Sign in to Cadence' }),
    ).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret12')
    expect(await screen.findByTestId('location')).toHaveTextContent(
      '/profile?collab=p1#project=x',
    )
  })

  it('keeps registration neutral and inside the Dialog', async () => {
    coversInteractions('auth.mode.toggle', 'auth.registration.display-name')
    const user = userEvent.setup()
    const register = vi.fn(async () => undefined)
    renderDialog(makeValue({ register }))

    await user.click(screen.getByRole('button', { name: 'Open sign in' }))
    await user.click(screen.getByRole('button', { name: /Create an account/ }))
    await user.type(screen.getByLabelText('Display name'), 'Ada')
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(register).toHaveBeenCalledWith('a@b.com', 'secret12', 'Ada')
    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps magic-link requests neutral and inside the Dialog', async () => {
    coversInteractions('auth.magic-link.email', 'auth.magic-link.submit')
    const user = userEvent.setup()
    const requestMagicLink = vi.fn(async () => undefined)
    renderDialog(makeValue({ requestMagicLink }))

    await user.click(screen.getByRole('button', { name: 'Open sign in' }))
    await user.type(screen.getByLabelText(/magic sign-in link/), 'a@b.com')
    await user.click(screen.getByRole('button', { name: 'Email me a link' }))

    expect(requestMagicLink).toHaveBeenCalledWith('a@b.com')
    expect(await screen.findByText(/sign-in link is on its way/)).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('stores a safe return target before external sign-in navigation', async () => {
    coversInteractions('auth.provider.sign-in')
    const user = userEvent.setup()
    renderDialog(makeValue({ providers: ['GitHub'] }))

    await user.click(screen.getByRole('button', { name: 'Open sign in' }))
    const link = await screen.findByRole('link', { name: 'GitHub' })
    link.addEventListener('click', (event) => event.preventDefault())
    fireEvent.click(link)

    expect(takeAuthReturnTarget()).toBe('/profile?collab=p1#project=x')
  })

  it('restores focus to the launcher after closing', async () => {
    const user = userEvent.setup()
    renderDialog(makeValue())
    const launcher = screen.getByRole('button', { name: 'Open sign in' })

    await user.click(launcher)
    await user.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => expect(launcher).toHaveFocus())
  })

  it('does not navigate when a dismissed sign-in later succeeds', async () => {
    let resolveSignIn!: () => void
    const signIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSignIn = resolve
        }),
    )
    const user = userEvent.setup()
    renderDialog(makeValue({ signIn }))

    await user.click(screen.getByRole('button', { name: 'Open sign in' }))
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign in' }),
    )
    await user.click(screen.getByRole('button', { name: 'Close' }))
    resolveSignIn()

    await waitFor(() => expect(document.querySelector('dialog')).not.toHaveAttribute('open'))
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })
})
