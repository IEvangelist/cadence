import { describe, expect, it, vi } from 'vitest'
/* Interaction coverage:
 * auth.profile.open, auth.sign-out, auth.panel.toggle,
 * auth.registration.display-name, auth.credentials.email, auth.credentials.password,
 * auth.credentials.submit, auth.mode.toggle, auth.magic-link.email,
 * auth.magic-link.submit, auth.provider.sign-in
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    const user = userEvent.setup()
    const signIn = vi.fn(async () => undefined)
    renderBar(makeValue({ signIn }))

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email'), 'a@b.com')
    await user.type(screen.getByLabelText('Password'), 'secret12')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret12')
  })

  it('toggles to register mode, submits, and confirms a verification email was sent', async () => {
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
