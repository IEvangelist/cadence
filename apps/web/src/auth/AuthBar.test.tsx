import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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

const renderBar = (
  value: AuthContextValue,
  {
    profileActive = false,
    signingOut = false,
    onShowProfile = vi.fn(),
    onShowSignIn = vi.fn(),
    onSignOut = vi.fn(async () => undefined),
  } = {},
) =>
  render(
    <AuthContext value={value}>
      <AuthBar
        onShowSignIn={onShowSignIn}
        onShowProfile={onShowProfile}
        profileActive={profileActive}
        signingOut={signingOut}
        onSignOut={onSignOut}
      />
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
    const onSignOut = vi.fn(async () => undefined)
    const onShowProfile = vi.fn()
    renderBar(
      makeValue({
        status: 'authenticated',
        user: { id: '1', email: 'a@b.com', displayName: 'Ada', tier: 'Free' },
      }),
      { onShowProfile, onSignOut },
    )

    expect(screen.getByText('Ada')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Profile' }))
    expect(onShowProfile).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('disables account actions while sign-out is pending', () => {
    renderBar(
      makeValue({
        status: 'authenticated',
        user: { id: '1', email: 'a@b.com', displayName: 'Ada', tier: 'Free' },
      }),
      { signingOut: true },
    )

    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Profile' })).toBeDisabled()
  })

  it('opens the shared sign-in Dialog', async () => {
    coversInteractions('auth.panel.toggle')
    const user = userEvent.setup()
    const onShowSignIn = vi.fn()
    renderBar(makeValue(), { onShowSignIn })

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onShowSignIn).toHaveBeenCalledOnce()
  })
})
