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
import { AuthContext, type AuthContextValue, type AuthStatus } from './authContext'

interface AuthProviderProps {
  children: ReactNode
  /** Injectable client (tests supply a fake). */
  client?: AuthClient
  /** Called whenever the authenticated state changes (used to swap stores). */
  onAuthChange?: (authenticated: boolean) => void | Promise<void>
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof AuthError) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

export function AuthProvider({ children, client: injected, onAuthChange }: AuthProviderProps) {
  const [client] = useState<AuthClient>(() => injected ?? new AuthClient())
  const [user, setUser] = useState<Me | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [providers, setProviders] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const onAuthChangeRef = useRef(onAuthChange)
  useEffect(() => {
    onAuthChangeRef.current = onAuthChange
  }, [onAuthChange])

  const applyUser = useCallback(async (next: Me | null) => {
    setStatus('loading')
    try {
      await onAuthChangeRef.current?.(next !== null)
    } catch {
      // Authentication is authoritative; local-to-remote reconciliation is best-effort.
    }
    setUser(next)
    setStatus(next ? 'authenticated' : 'anonymous')
  }, [])

  const refresh = useCallback(async () => {
    try {
      const me = await client.me()
      await applyUser(me)
    } catch {
      await applyUser(null)
    }
  }, [client, applyUser])

  useEffect(() => {
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
        await applyUser(me)
      } catch (err) {
        setError(messageFor(err, 'Sign in failed.'))
        throw err
      }
    },
    [client, applyUser],
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
    try {
      await client.logout()
    } finally {
      await applyUser(null)
    }
  }, [client, applyUser])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
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
    [user, status, providers, error, client, register, signIn, requestMagicLink, signOut, refresh],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
