import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import type { AuthClient, Me } from './authClient'
import { AuthProvider } from './AuthProvider'
import { useAuth, type AuthPersistenceChange } from './authContext'
import { OfflineIdentityStore } from './offlineIdentity'
import { MemoryStorage } from '../composer/model/storage'

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
      <output data-testid="offline-user">
        {auth.offlineUser?.displayName ?? 'none'}
      </output>
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

const renderWith = (
  client: AuthClient,
  onAuthChange?: (change: AuthPersistenceChange) => void | Promise<void>,
  offlineIdentityStore?: OfflineIdentityStore,
) =>
  render(
    <AuthProvider
      client={client}
      onAuthChange={onAuthChange}
      offlineIdentityStore={offlineIdentityStore}
    >
      <Harness />
    </AuthProvider>,
  )

describe('AuthProvider / useAuth', () => {
  beforeEach(() => localStorage.clear())

  it('resolves to anonymous when there is no session', async () => {
    const onAuthChange = vi.fn()
    renderWith(fakeClient(), onAuthChange)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(onAuthChange).toHaveBeenCalledWith({
      generation: expect.any(Number),
      mode: 'anonymous',
      ownerId: null,
      purgeOwnerIds: [],
    })
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
    expect(onAuthChange).toHaveBeenCalledWith({
      generation: expect.any(Number),
      mode: 'authenticated',
      ownerId: '1',
      purgeOwnerIds: [],
    })
  })

  it('uses a minimal confirmed identity only when session verification is offline', async () => {
    const storage = new MemoryStorage()
    const identityStore = new OfflineIdentityStore(storage)
    identityStore.remember(user)
    const onAuthChange = vi.fn()
    renderWith(
      fakeClient({
        me: vi.fn(async () => {
          throw new TypeError('Failed to fetch')
        }),
      }),
      onAuthChange,
      identityStore,
    )

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('offline'),
    )
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('offline-user')).toHaveTextContent('Ada')
    expect(onAuthChange).toHaveBeenCalledWith({
      generation: expect.any(Number),
      mode: 'offline',
      ownerId: '1',
      purgeOwnerIds: [],
    })
  })

  it('clears cached ownership after a confirmed anonymous response', async () => {
    const storage = new MemoryStorage()
    const identityStore = new OfflineIdentityStore(storage)
    identityStore.remember(user)
    const onAuthChange = vi.fn()
    renderWith(fakeClient(), onAuthChange, identityStore)

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    )
    expect(identityStore.read()).toBeNull()
    expect(onAuthChange).toHaveBeenCalledWith({
      generation: expect.any(Number),
      mode: 'anonymous',
      ownerId: null,
      purgeOwnerIds: ['1'],
    })
  })

  it('purges the previous owner before confirming an account switch', async () => {
    const storage = new MemoryStorage()
    const identityStore = new OfflineIdentityStore(storage)
    identityStore.remember(user)
    const nextUser: Me = {
      id: '2',
      email: 'b@b.com',
      displayName: 'Bea',
      tier: 'Free',
    }
    const onAuthChange = vi.fn()
    renderWith(
      fakeClient({ me: vi.fn(async () => nextUser) }),
      onAuthChange,
      identityStore,
    )

    await waitFor(() =>
      expect(screen.getByTestId('user')).toHaveTextContent('Bea'),
    )
    expect(onAuthChange).toHaveBeenCalledWith({
      generation: expect.any(Number),
      mode: 'authenticated',
      ownerId: '2',
      purgeOwnerIds: ['1'],
    })
    expect(identityStore.read()).toEqual({ id: '2', displayName: 'Bea' })
  })

  it('ignores a late old-user refresh after sign-out and never recreates its cache', async () => {
    let resolveOldUser!: (value: Me | null) => void
    let refreshSignal: AbortSignal | undefined
    const oldUser = new Promise<Me | null>((resolve) => {
      resolveOldUser = resolve
    })
    const client = fakeClient({
      me: vi.fn((signal?: AbortSignal) => {
        refreshSignal = signal
        return oldUser
      }),
    })
    const storage = new MemoryStorage()
    const identityStore = new OfflineIdentityStore(storage)
    identityStore.remember(user)
    const onAuthChange = vi.fn()
    renderWith(client, onAuthChange, identityStore)

    fireEvent.click(screen.getByText('signout'))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    )
    expect(refreshSignal?.aborted).toBe(true)

    resolveOldUser(user)
    await Promise.resolve()
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(identityStore.read()).toBeNull()
    expect(
      onAuthChange.mock.calls.some(
        ([change]) => change.mode === 'authenticated',
      ),
    ).toBe(false)
  })

  it('ignores a late old-user refresh after a newer user signs in', async () => {
    let resolveOldUser!: (value: Me | null) => void
    const oldUser = new Promise<Me | null>((resolve) => {
      resolveOldUser = resolve
    })
    const nextUser: Me = {
      id: '2',
      email: 'b@b.com',
      displayName: 'Bea',
      tier: 'Free',
    }
    const storage = new MemoryStorage()
    const identityStore = new OfflineIdentityStore(storage)
    const client = fakeClient({
      me: vi.fn(() => oldUser),
      login: vi.fn(async () => nextUser),
    })
    renderWith(client, undefined, identityStore)

    fireEvent.click(screen.getByText('signin'))
    await waitFor(() =>
      expect(screen.getByTestId('user')).toHaveTextContent('Bea'),
    )
    resolveOldUser(user)
    await Promise.resolve()

    expect(screen.getByTestId('user')).toHaveTextContent('Bea')
    expect(identityStore.read()).toEqual({ id: '2', displayName: 'Bea' })
  })

  it('keeps the newest StrictMode refresh and ignores the aborted response', async () => {
    const resolvers: Array<(value: Me | null) => void> = []
    const signals: AbortSignal[] = []
    const client = fakeClient({
      me: vi.fn((signal?: AbortSignal) => {
        if (signal) signals.push(signal)
        return new Promise<Me | null>((resolve) => resolvers.push(resolve))
      }),
    })
    const storage = new MemoryStorage()
    const identityStore = new OfflineIdentityStore(storage)
    render(
      <StrictMode>
        <AuthProvider
          client={client}
          offlineIdentityStore={identityStore}
        >
          <Harness />
        </AuthProvider>
      </StrictMode>,
    )
    await waitFor(() => expect(client.me).toHaveBeenCalledTimes(2))
    expect(signals[0].aborted).toBe(true)

    const nextUser: Me = {
      id: '2',
      email: 'b@b.com',
      displayName: 'Bea',
      tier: 'Free',
    }
    resolvers[1](nextUser)
    await waitFor(() =>
      expect(screen.getByTestId('user')).toHaveTextContent('Bea'),
    )
    resolvers[0](user)
    await Promise.resolve()

    expect(screen.getByTestId('user')).toHaveTextContent('Bea')
    expect(identityStore.read()).toEqual({ id: '2', displayName: 'Bea' })
  })

  it('signIn authenticates and notifies onAuthChange(true)', async () => {
    const onAuthChange = vi.fn()
    renderWith(fakeClient(), onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('signin'))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(onAuthChange).toHaveBeenLastCalledWith({
      generation: expect.any(Number),
      mode: 'authenticated',
      ownerId: '1',
      purgeOwnerIds: [],
    })
  })

  it('publishes authenticated state only after store reconciliation settles', async () => {
    let finishReconciliation!: () => void
    const reconciliation = new Promise<void>((resolve) => {
      finishReconciliation = resolve
    })
    const onAuthChange = vi.fn(async (change: AuthPersistenceChange) => {
      if (change.mode === 'authenticated') await reconciliation
    })
    renderWith(fakeClient(), onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))

    fireEvent.click(screen.getByText('signin'))
    await waitFor(() =>
      expect(onAuthChange).toHaveBeenLastCalledWith({
        generation: expect.any(Number),
        mode: 'authenticated',
        ownerId: '1',
        purgeOwnerIds: [],
      }),
    )
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
    expect(onAuthChange).toHaveBeenLastCalledWith({
      generation: expect.any(Number),
      mode: 'anonymous',
      ownerId: null,
      purgeOwnerIds: ['1'],
    })
  })

  it('does not resolve signOut before the store transition completes', async () => {
    let releaseStore!: () => void
    const storeTransition = new Promise<void>((resolve) => {
      releaseStore = resolve
    })
    const client = fakeClient({ me: vi.fn(async () => user) })
    const onAuthChange = vi.fn(async (change: AuthPersistenceChange) => {
      if (change.mode === 'anonymous') await storeTransition
    })
    renderWith(client, onAuthChange)
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    fireEvent.click(screen.getByText('signout'))
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('signing-out'),
    )
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
