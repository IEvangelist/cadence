import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { coversInteractions } from '../test/coversInteractions'
import type { AuthClient } from './authClient'
import { AuthContext, type AuthContextValue } from './authContext'
import { AuthBar } from './AuthBar'

function makeValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    user: null,
    status: 'anonymous',
    providers: [],
    error: null,
    client: { externalSignInUrl: (p: string) => `/api/auth/external/${p}` } as unknown as AuthClient,
    register: vi.fn(async () => undefined),
    signIn: vi.fn(async () => undefined),
    requestMagicLink: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  }
}

const renderBar = (value: AuthContextValue, profileActive = false, onShowProfile = vi.fn()) =>
  render(
    <AuthContext value={value}>
      <AuthBar onShowProfile={onShowProfile} profileActive={profileActive} />
    </AuthContext>,
  )

describe('AuthBar', () => {
  it('renders nothing interactive while loading', () => {
    const { container } = renderBar(makeValue({ status: 'loading' }))
    expect(container.querySelector('button')).toBeNull()
  })

  it('shows the signed-in greeting and account actions', async () => {
    coversInteractions('auth.profile.open', 'auth.sign-out')
    const user = userEvent.setup()
    const signOut = vi.fn(async () => undefined)
    const onShowProfile = vi.fn()
    renderBar(
      makeValue({
        status: 'authenticated',
        user: { id: '1', email: 'a@b.com', displayName: 'Ada', tier: 'Free' },
        signOut,
      }),
      false,
      onShowProfile,
    )

    expect(screen.getByText('Ada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Profile' }))
    expect(onShowProfile).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('opens the panel and submits local sign-in', async () => {
    coversInteractions(
      'auth.panel.toggle',
      'auth.credentials.email',
      'auth.credentials.password',
      'auth.credentials.submit',
    )
    const user = userEvent.setup()
    const signIn = vi.fn(async () => undefined)
    renderBar(makeValue({ signIn }))

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret12')
  })

  it('shows one visible busy state while sign-in reconciliation is pending', async () => {
    let finish!: () => void
    const signIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const user = userEvent.setup()
    renderBar(makeValue({ signIn }))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const busy = screen.getByRole('button', { name: 'Signing in...' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')

    finish()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Signing in...' })).not.toBeInTheDocument(),
    )
  })

  it('names the authentication popover dialog from its title', async () => {
    const user = userEvent.setup()
    renderBar(makeValue())

    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(screen.getByRole('dialog', { name: 'Sign in to Cadence' })).toBeInTheDocument()
  })

  it('toggles to register mode, submits, and confirms a verification email was sent', async () => {
    coversInteractions('auth.mode.toggle', 'auth.registration.display-name')
    const user = userEvent.setup()
    const register = vi.fn(async () => undefined)
    renderBar(makeValue({ register }))

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.click(screen.getByRole('button', { name: /Create an account/ }))
    await user.type(screen.getByLabelText('Display name'), 'Ada')
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(register).toHaveBeenCalledWith('a@b.com', 'secret12', 'Ada')
    // #76: register does not sign in — the UI must tell the user to check their email.
    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
  })

  it('requests a magic link and confirms it was sent', async () => {
    coversInteractions('auth.magic-link.email', 'auth.magic-link.submit')
    const user = userEvent.setup()
    const requestMagicLink = vi.fn(async () => undefined)
    renderBar(makeValue({ requestMagicLink }))

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText(/magic sign-in link/), 'a@b.com')
    await user.click(screen.getByRole('button', { name: 'Email me a link' }))

    expect(requestMagicLink).toHaveBeenCalledWith('a@b.com')
    expect(await screen.findByRole('status')).toHaveTextContent(/sign-in link is on its way/)
  })

  it('renders external provider links', async () => {
    coversInteractions('auth.provider.sign-in')
    const user = userEvent.setup()
    renderBar(makeValue({ providers: ['GitHub'] }))

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const link = screen.getByRole('link', { name: 'GitHub' })
    expect(link).toHaveAttribute('href', '/api/auth/external/GitHub')
  })

  it('shows the auth error', async () => {
    const user = userEvent.setup()
    renderBar(makeValue({ error: 'Incorrect email or password.' }))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })
})
