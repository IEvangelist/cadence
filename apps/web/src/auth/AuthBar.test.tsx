import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('shows the signed-in greeting and account actions', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(onShowProfile).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
  })

  it('opens the panel and submits local sign-in', () => {
    const signIn = vi.fn(async () => undefined)
    renderBar(makeValue({ signIn }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(signIn).toHaveBeenCalledWith('a@b.com', 'secret12')
  })

  it('toggles to register mode, submits, and confirms a verification email was sent', async () => {
    const register = vi.fn(async () => undefined)
    renderBar(makeValue({ register }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.click(screen.getByRole('button', { name: /Create an account/ }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(register).toHaveBeenCalledWith('a@b.com', 'secret12', 'Ada')
    // #76: register does not sign in — the UI must tell the user to check their email.
    expect(await screen.findByText(/Check your email/)).toBeInTheDocument()
  })

  it('requests a magic link and confirms it was sent', async () => {
    const requestMagicLink = vi.fn(async () => undefined)
    renderBar(makeValue({ requestMagicLink }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.change(screen.getByLabelText(/magic sign-in link/), { target: { value: 'a@b.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }))

    expect(requestMagicLink).toHaveBeenCalledWith('a@b.com')
    expect(await screen.findByRole('status')).toHaveTextContent(/sign-in link is on its way/)
  })

  it('renders external provider links', () => {
    renderBar(makeValue({ providers: ['GitHub'] }))

    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const link = screen.getByRole('link', { name: 'GitHub' })
    expect(link).toHaveAttribute('href', '/api/auth/external/GitHub')
  })

  it('shows the auth error', () => {
    renderBar(makeValue({ error: 'Incorrect email or password.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })
})
