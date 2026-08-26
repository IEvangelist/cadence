import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { coversInteractions } from '../test/coversInteractions'
import type { AuthClient, Me } from '../auth/authClient'
import { AuthContext, type AuthContextValue, type AuthStatus } from '../auth/authContext'
import {
  readAuthReturnTarget,
  saveAuthReturnTarget,
  takeAuthReturnTarget,
} from '../auth/authReturnTarget'
import { AuthCallbackEffect } from './AuthCallbackEffect'
import { useMemo, useState } from 'react'

const user: Me = {
  id: '1',
  email: 'ada@example.test',
  displayName: 'Ada',
  tier: 'Free',
}

function LocationOutput() {
  const location = useLocation()
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  )
}

function AuthHarness({
  children,
  refresh,
}: {
  children: React.ReactNode
  refresh: () => Promise<boolean>
}) {
  const [status, setStatus] = useState<AuthStatus>('anonymous')
  const value = useMemo<AuthContextValue>(
    () => ({
      user: status === 'authenticated' ? user : null,
      offlineUser: null,
      status,
      providers: [],
      error: null,
      client: {} as AuthClient,
      register: vi.fn(async () => undefined),
      signIn: vi.fn(async () => undefined),
      requestMagicLink: vi.fn(async () => undefined),
      signOut: vi.fn(async () => undefined),
      refresh: async () => {
        const authenticated = await refresh()
        setStatus(authenticated ? 'authenticated' : 'anonymous')
      },
    }),
    [refresh, status],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

describe('AuthCallbackEffect', () => {
  it('refreshes auth, consumes callback parameters, and restores the safe target', async () => {
    coversInteractions('auth.callback.dismiss')
    const interaction = userEvent.setup()
    saveAuthReturnTarget('/profile?from=guard')
    const refresh = vi.fn(async () => true)
    render(
      <MemoryRouter
        initialEntries={[
          '/?auth=success&collab=p1&role=editor&share=t#project=x',
        ]}
      >
        <AuthHarness refresh={refresh}>
          <AuthCallbackEffect />
          <LocationOutput />
        </AuthHarness>
      </MemoryRouter>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/profile?from=guard&collab=p1&role=editor&share=t#project=x',
      ),
    )
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.getByText('You’re signed in.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('auth=')
    await interaction.click(
      screen.getByRole('button', { name: 'Dismiss authentication status' }),
    )
    expect(screen.queryByText('You’re signed in.')).not.toBeInTheDocument()
  })

  it('shows neutral linking guidance, stays anonymous, and preserves other inputs', async () => {
    saveAuthReturnTarget('/profile?collab=p1&share=t#project=x')
    const refresh = vi.fn(async () => true)
    render(
      <MemoryRouter
        initialEntries={['/?auth=error&reason=link-required&share=t#project=x']}
      >
        <AuthHarness refresh={refresh}>
          <AuthCallbackEffect />
          <LocationOutput />
        </AuthHarness>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Sign in with your existing method first/i,
    )
    expect(screen.getByTestId('location')).toHaveTextContent('/?share=t#project=x')
    expect(screen.getByTestId('location')).not.toHaveTextContent('auth=')
    expect(screen.getByTestId('location')).not.toHaveTextContent('reason=')
    expect(refresh).not.toHaveBeenCalled()
    expect(readAuthReturnTarget()).toBe('/profile?collab=p1&share=t#project=x')
  })

  it('retains the safe target when callback session refresh is transiently anonymous', async () => {
    saveAuthReturnTarget('/profile')
    const refresh = vi.fn(async () => false)
    render(
      <MemoryRouter initialEntries={['/?auth=success']}>
        <AuthHarness refresh={refresh}>
          <AuthCallbackEffect />
          <LocationOutput />
        </AuthHarness>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn’t confirm your session/i,
    )
    expect(takeAuthReturnTarget()).toBe('/profile')
  })
})
