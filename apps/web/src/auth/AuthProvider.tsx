/**
 * AuthProvider — owns session state and exposes it through {@link AuthContext}.
 *
 * On mount it reads the current session and the wired providers. Sign-in,
 * registration, and sign-out update local state and notify `onAuthChange`, which
 * the app uses to flip the persistence seam between the local and remote stores
 * (and to sync local-only projects up on sign-in).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthClient, AuthError, type Me } from './authClient'
import {
  AuthContext,
  type AuthContextValue,
  type AuthPersistenceChange,
  type AuthStatus,
} from './authContext'
import {
  OfflineIdentityStore,
  type OfflineAuthIdentity,
} from './offlineIdentity'
import { backendConfig } from '../platform/backendConfig'

interface AuthProviderProps {
  children: ReactNode
  /** Injectable client (tests supply a fake). */
  client?: AuthClient
  /** Injectable minimal confirmed-identity cache. */
  offlineIdentityStore?: OfflineIdentityStore
  /** Called whenever live/offline/anonymous persistence ownership changes. */
  onAuthChange?: (change: AuthPersistenceChange) => void | Promise<void>
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof AuthError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

export function AuthProvider({
  children,
  client: injected,
  offlineIdentityStore: injectedIdentityStore,
  onAuthChange,
}: AuthProviderProps) {
  const [client] = useState<AuthClient>(() => injected ?? new AuthClient())
  const [offlineIdentityStore] = useState(
    () => injectedIdentityStore ?? new OfflineIdentityStore(),
  )
  const [user, setUser] = useState<Me | null>(null)
  const [offlineUser, setOfflineUser] = useState<OfflineAuthIdentity | null>(null)
  const [status, setStatus] = useState<AuthStatus>(
    backendConfig.available ? 'loading' : 'anonymous',
  )
  const [providers, setProviders] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const onAuthChangeRef = useRef(onAuthChange)
  useEffect(() => {
    onAuthChangeRef.current = onAuthChange
  }, [onAuthChange])

  const applyChange = useCallback(
    async (
      change: AuthPersistenceChange,
      nextUser: Me | null,
      nextOfflineUser: OfflineAuthIdentity | null,
    ) => {
      setStatus('loading')
      setUser(null)
      setOfflineUser(null)
      try {
        await onAuthChangeRef.current?.(change)
      } catch {
        // Authentication is authoritative; local cleanup/reconciliation is best-effort.
      }
      setUser(nextUser)
      setOfflineUser(nextOfflineUser)
      setStatus(change.mode)
    },
    [],
  )

  const applyAuthenticated = useCallback(
    async (next: Me) => {
      const cached = offlineIdentityStore.read()
      const purgeOwnerIds =
        cached && cached.id !== next.id ? [cached.id] : []
      if (purgeOwnerIds.length > 0) offlineIdentityStore.clear()
      await applyChange(
        { mode: 'authenticated', ownerId: next.id, purgeOwnerIds },
        next,
        null,
      )
      offlineIdentityStore.remember(next)
    },
    [applyChange, offlineIdentityStore],
  )

  const applyAnonymous = useCallback(
    async (purge = true) => {
      const cached = offlineIdentityStore.read()
      offlineIdentityStore.clear()
      await applyChange(
        {
          mode: 'anonymous',
          ownerId: null,
          purgeOwnerIds: purge && cached ? [cached.id] : [],
        },
        null,
        null,
      )
    },
    [applyChange, offlineIdentityStore],
  )

  const applyOffline = useCallback(async () => {
    const cached = offlineIdentityStore.read()
    if (!cached) {
      await applyAnonymous(false)
      return
    }
    await applyChange(
      { mode: 'offline', ownerId: cached.id, purgeOwnerIds: [] },
      null,
      cached,
    )
  }, [applyAnonymous, applyChange, offlineIdentityStore])

  const refresh = useCallback(async () => {
    if (!backendConfig.available) {
      await applyAnonymous()
      return
    }
    try {
      const me = await client.me()
      if (me) await applyAuthenticated(me)
      else await applyAnonymous()
    } catch {
      await applyOffline()
    }
  }, [client, applyAnonymous, applyAuthenticated, applyOffline])

  useEffect(() => {
    if (!backendConfig.available) return
    let cancelled = false
    void (async () => {
      await refresh()
      try {
        const list = await client.providers()
        if (!cancelled) setProviders(list)
      } catch {
        if (!cancelled) setProviders([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, refresh])

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null)
      try {
        const me = await client.login(email, password)
        await applyAuthenticated(me)
      } catch (err) {
        setError(messageFor(err, 'Sign in failed.'))
        throw err
      }
    },
    [client, applyAuthenticated],
  )

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      setError(null)
      try {
        // Registration is neutral and deferred: the server returns 202 with no
        // cookie and emails a verification link. We must NOT apply a user or flip
        // to authenticated here — the session only begins after the user verifies.
        await client.register(email, password, displayName)
      } catch (err) {
        setError(messageFor(err, 'Registration failed.'))
        throw err
      }
    },
    [client],
  )

  const requestMagicLink = useCallback(
    async (email: string) => {
      setError(null)
      try {
        await client.requestMagicLink(email)
      } catch (err) {
        setError(messageFor(err, 'Could not send the sign-in link.'))
        throw err
      }
    },
    [client],
  )

  const signOut = useCallback(async () => {
    setError(null)
    const cached = offlineIdentityStore.read()
    offlineIdentityStore.clear()
    setStatus('signing-out')
    let logoutError: unknown
    const logout = client.logout().catch((error) => {
      logoutError = error
    })
    // Explicit local sign-out revokes access to cached owner data immediately;
    // the best-effort server request is never allowed to delay that cleanup.
    try {
      await onAuthChangeRef.current?.({
        mode: 'anonymous',
        ownerId: null,
        purgeOwnerIds: cached ? [cached.id] : [],
      })
    } catch {
      // Local identity is already revoked; cleanup is best-effort and bounded.
    }
    await logout
    setUser(null)
    setOfflineUser(null)
    setStatus('anonymous')
    if (logoutError !== undefined) throw logoutError
  }, [client, offlineIdentityStore])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      offlineUser,
      status,
      providers,
      error,
      client,
      register,
      signIn,
      requestMagicLink,
      signOut,
      refresh,
    }),
    [
      user,
      offlineUser,
      status,
      providers,
      error,
      client,
      register,
      signIn,
      requestMagicLink,
      signOut,
      refresh,
    ],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
