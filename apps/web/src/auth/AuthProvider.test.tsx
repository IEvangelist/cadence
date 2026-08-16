import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { AuthClient, Me } from './authClient'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './authContext'

const user: Me = { id: '1', email: 'a@b.com', displayName: 'Ada', tier: 'Free' }

function fakeClient(overrides: Partial<AuthClient> = {}): AuthClient {
  const base = {
    me: vi.fn(async () => null),
    providers: vi.fn(async () => [] as string[]),
    login: vi.fn(async () => user),
    register: vi.fn(async () => undefined),
    requestMagicLink: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    externalSignInUrl: vi.fn((p: string) => `/api/auth/external/${p}`),
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
  }
  return { ...base, ...overrides } as unknown as AuthClient
}

function Harness() {
  const auth = useAuth()
  const [signOutComplete, setSignOutComplete] = useState(false)
  return (
    <div>
      <output data-testid="status">{auth.status}</output>
      <output data-testid="user">{auth.user?.displayName ?? 'none'}</output>
      <output data-testid="providers">{auth.providers.join(',')}</output>
      <output data-testid="error">{auth.error ?? ''}</output>
      <output data-testid="signout-complete">{String(signOutComplete)}</output>
      <button onClick={() => void auth.signIn('a@b.com', 'pw').catch(() => {})}>signin</button>
      <button onClick={() => void auth.register('a@b.com', 'pw', 'Ada').catch(() => {})}>register</button>
      <button onClick={() => void auth.requestMagicLink('a@b.com').catch(() => {})}>magic</button>
      <button
        onClick={() =>
          void auth
            .signOut()
            .then(() => setSignOutComplete(true))
            .catch(() => {})
        }
      >
        signout
      </button>
    </div>
  )
}

const renderWith = (client: AuthClient, onAuthChange?: (a: boolean) => void) =>
  render(
    <AuthProvider client={client} onAuthChange={onAuthChange}>
      <Harness />
    </AuthProvider>,
  )

describe('AuthProvider / useAuth', () => {
  it('resolves to anonymous when there is no session', async () => {
    const onAuthChange = vi.fn()
    renderWith(fakeClient(), onAuthChange)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(onAuthChange).toHaveBeenCalledWith(false)
  })

  it('resolves to authenticated and loads providers', async () => {
    const client = fakeClient({
      me: vi.fn(async () => user),
      providers: vi.fn(async () => ['GitHub', 'Google']),
    })
    const onAuthChange = vi.fn()
    renderWith(client, onAuthChange)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('Ada')
    expect(screen.getByTestId('providers')).toHaveTextContent('GitHub,Google')
    expect(onAuthChange).toHaveBeenCalledWith(true)
  })

  it('signIn authenticates and notifies onAuthChange(true)', async () => {
    const onAuthChange = vi.fn()
    renderWith(fakeClient(), onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('signin'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(onAuthChange).toHaveBeenLastCalledWith(true)
  })

  it('publishes authenticated state only after store reconciliation settles', async () => {
    let finishReconciliation!: () => void
    const reconciliation = new Promise<void>((resolve) => {
      finishReconciliation = resolve
    })
    const onAuthChange = vi.fn(async (authenticated: boolean) => {
      if (authenticated) await reconciliation
    })
    renderWith(fakeClient(), onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('signin'))
    await waitFor(() => expect(onAuthChange).toHaveBeenLastCalledWith(true))
    expect(screen.getByTestId('status')).toHaveTextContent('loading')
    expect(screen.getByTestId('user')).toHaveTextContent('none')

    finishReconciliation()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('Ada')
  })

  it('surfaces a sign-in error without changing status', async () => {
    const client = fakeClient({
      login: vi.fn(async () => {
        throw new Error('Incorrect email or password.')
      }),
    })
    renderWith(client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('signin'))

    await waitFor(() =>
      expect(screen.getByTestId('error')).toHaveTextContent('Incorrect email or password.'),
    )
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
  })

  it('register does not sign the user in (verification required)', async () => {
    const client = fakeClient()
    renderWith(client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('register'))

    await waitFor(() => expect(client.register).toHaveBeenCalledWith('a@b.com', 'pw', 'Ada'))
    // #76: registration is neutral and deferred — the session must stay anonymous
    // until the emailed verification link is followed.
    expect(screen.getByTestId('status')).toHaveTextContent('anonymous')
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(client.me).toHaveBeenCalledTimes(1)
  })

  it('requestMagicLink calls the client', async () => {
    const client = fakeClient()
    renderWith(client)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('magic'))

    await waitFor(() => expect(client.requestMagicLink).toHaveBeenCalledWith('a@b.com'))
  })

  it('signOut returns to anonymous and notifies onAuthChange(false)', async () => {
    const client = fakeClient({ me: vi.fn(async () => user) })
    const onAuthChange = vi.fn()
    renderWith(client, onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    fireEvent.click(screen.getByText('signout'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(onAuthChange).toHaveBeenLastCalledWith(false)
  })

  it('does not resolve signOut before the store transition completes', async () => {
    let releaseStore!: () => void
    const storeTransition = new Promise<void>((resolve) => {
      releaseStore = resolve
    })
    const client = fakeClient({ me: vi.fn(async () => user) })
    const onAuthChange = vi.fn(async (authenticated: boolean) => {
      if (!authenticated) await storeTransition
    })
    renderWith(client, onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    fireEvent.click(screen.getByText('signout'))
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('loading'))
    expect(screen.getByTestId('signout-complete')).toHaveTextContent('false')

    releaseStore()
    await waitFor(() =>
      expect(screen.getByTestId('signout-complete')).toHaveTextContent('true'),
    )
  })

  it('useAuth throws when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Harness />)).toThrow(/within an AuthProvider/)
    spy.mockRestore()
  })
})
