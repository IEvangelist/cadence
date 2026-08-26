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
  nextAuthGeneration,
} from './authContext'
import {
  OfflineIdentityStore,
  type OfflineAuthIdentity,
} from './offlineIdentity'
import { backendConfig } from '../platform/backendConfig'
import { authMutationCoordinator } from './authMutationCoordinator'

interface AuthProviderProps {
  children: ReactNode
  /** Injectable client (tests supply a fake). */
  client?: AuthClient
  /** Injectable minimal confirmed-identity cache. */
  offlineIdentityStore?: OfflineIdentityStore
  /** Called whenever live/offline/anonymous persistence ownership changes. */
  onAuthChange?: (change: AuthPersistenceChange) => void | Promise<void>
  /** Bounded server logout/cleanup wait; injectable for deterministic tests. */
  logoutTimeoutMs?: number
}

interface AuthOperation {
  generation: number
  controller: AbortController
  broadcast: boolean
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
  logoutTimeoutMs = 2_000,
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
  const operationRef = useRef<{
    generation: number
    controller: AbortController | null
  }>({ generation: 0, controller: null })
  useEffect(() => {
    onAuthChangeRef.current = onAuthChange
  }, [onAuthChange])

  const beginOperation = useCallback((broadcast = true): AuthOperation => {
    operationRef.current.controller?.abort()
    const operation = {
      generation: nextAuthGeneration(),
      controller: new AbortController(),
      broadcast,
    }
    operationRef.current = operation
    return operation
  }, [])

  const isCurrent = useCallback(
    (operation: AuthOperation): boolean =>
      operationRef.current.generation === operation.generation &&
      operationRef.current.controller === operation.controller &&
      !operation.controller.signal.aborted,
    [],
  )

  const cancelOperation = useCallback(
    (operation: AuthOperation) => {
      if (!isCurrent(operation)) return
      operation.controller.abort()
      operationRef.current = {
        generation: nextAuthGeneration(),
        controller: null,
      }
    },
    [isCurrent],
  )

  const applyChange = useCallback(
    async (
      operation: AuthOperation,
      change: Omit<AuthPersistenceChange, 'generation'>,
      nextUser: Me | null,
      nextOfflineUser: OfflineAuthIdentity | null,
    ): Promise<boolean> => {
      if (!isCurrent(operation)) return false
      setStatus('loading')
      setUser(null)
      setOfflineUser(null)
      try {
        await onAuthChangeRef.current?.({
          ...change,
          generation: operation.generation,
          ...(operation.broadcast ? {} : { broadcast: false }),
        })
      } catch {
        // Authentication is authoritative; local cleanup/reconciliation is best-effort.
      }
      if (!isCurrent(operation)) return false
      setUser(nextUser)
      setOfflineUser(nextOfflineUser)
      setStatus(change.mode)
      return true
    },
    [isCurrent],
  )

  const applyAuthenticated = useCallback(
    async (operation: AuthOperation, next: Me) => {
      if (!isCurrent(operation)) return
      const cached = offlineIdentityStore.read()
      const purgeOwnerIds =
        cached && cached.id !== next.id ? [cached.id] : []
      if (purgeOwnerIds.length > 0) offlineIdentityStore.clear()
      const applied = await applyChange(
        operation,
        { mode: 'authenticated', ownerId: next.id, purgeOwnerIds },
        next,
        null,
      )
      if (applied && isCurrent(operation)) offlineIdentityStore.remember(next)
    },
    [applyChange, isCurrent, offlineIdentityStore],
  )

  const applyAnonymous = useCallback(
    async (operation: AuthOperation, purge = true) => {
      if (!isCurrent(operation)) return
      const cached = offlineIdentityStore.read()
      offlineIdentityStore.clear()
      await applyChange(
        operation,
        {
          mode: 'anonymous',
          ownerId: null,
          purgeOwnerIds: purge && cached ? [cached.id] : [],
        },
        null,
        null,
      )
    },
    [applyChange, isCurrent, offlineIdentityStore],
  )

  const applyOffline = useCallback(async (operation: AuthOperation) => {
    if (!isCurrent(operation)) return
    const cached = offlineIdentityStore.read()
    if (!cached) {
      await applyAnonymous(operation, false)
      return
    }
    await applyChange(
      operation,
      { mode: 'offline', ownerId: cached.id, purgeOwnerIds: [] },
      null,
      cached,
    )
  }, [applyAnonymous, applyChange, isCurrent, offlineIdentityStore])

  const performRefresh = useCallback(async (operation: AuthOperation) => {
    if (!backendConfig.available) {
      await applyAnonymous(operation)
      return
    }
    try {
      const me = await client.me(operation.controller.signal)
      if (!isCurrent(operation)) return
      if (me) await applyAuthenticated(operation, me)
      else await applyAnonymous(operation)
    } catch {
      if (isCurrent(operation)) await applyOffline(operation)
    }
  }, [
    client,
    applyAnonymous,
    applyAuthenticated,
    applyOffline,
    isCurrent,
  ])

  const refresh = useCallback(async () => {
    const operation = beginOperation()
    await performRefresh(operation)
  }, [beginOperation, performRefresh])

  useEffect(
    () =>
      authMutationCoordinator.subscribeInvalidation((transition) => {
        operationRef.current.controller?.abort()
        if (transition.mode !== 'anonymous') {
          const operation = beginOperation(false)
          void performRefresh(operation)
          return
        }
        const generation = nextAuthGeneration()
        operationRef.current = {
          generation,
          controller: null,
        }
        const cached = offlineIdentityStore.read()
        offlineIdentityStore.clear()
        setUser(null)
        setOfflineUser(null)
        setStatus('anonymous')
        void Promise.resolve(
          onAuthChangeRef.current?.({
            generation,
            mode: 'anonymous',
            ownerId: null,
            purgeOwnerIds: cached ? [cached.id] : [],
            broadcast: false,
          }),
        ).catch((error) => {
          console.warn('Cross-tab auth cleanup did not complete.', error)
        })
      }),
    [beginOperation, offlineIdentityStore, performRefresh],
  )

  useEffect(() => {
    if (!backendConfig.available) return
    const operation = beginOperation()
    void (async () => {
      await performRefresh(operation)
      if (!isCurrent(operation)) return
      try {
        const list = await client.providers(operation.controller.signal)
        if (isCurrent(operation)) setProviders(list)
      } catch {
        if (isCurrent(operation)) setProviders([])
      }
    })()
    return () => cancelOperation(operation)
  }, [
    beginOperation,
    cancelOperation,
    client,
    isCurrent,
    performRefresh,
  ])

  const signIn = useCallback(
    async (email: string, password: string) => {
      const operation = beginOperation()
      setError(null)
      try {
        const me = await client.login(
          email,
          password,
          operation.controller.signal,
        )
        if (!isCurrent(operation)) return
        await applyAuthenticated(operation, me)
      } catch (err) {
        if (!isCurrent(operation)) return
        setError(messageFor(err, 'Sign in failed.'))
        throw err
      }
    },
    [applyAuthenticated, beginOperation, client, isCurrent],
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
    const operation = beginOperation()
    setError(null)
    const cached = offlineIdentityStore.read()
    offlineIdentityStore.clear()
    setStatus('signing-out')
    const logoutController = new AbortController()
    const logoutSignal = AbortSignal.any([
      operation.controller.signal,
      logoutController.signal,
    ])
    const logout = client.logout(logoutSignal).then(
      () => ({ kind: 'success' as const }),
      (error: unknown) => ({ kind: 'error' as const, error }),
    )
    // Explicit local sign-out revokes access to cached owner data immediately;
    // the best-effort server request is never allowed to delay that cleanup.
    const cleanup = Promise.resolve()
      .then(() => onAuthChangeRef.current?.({
        generation: operation.generation,
        mode: 'anonymous',
        ownerId: null,
        purgeOwnerIds: cached ? [cached.id] : [],
      }))
      .then(
        () => ({ kind: 'success' as const }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      )
    const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'timeout' }), logoutTimeoutMs)
    })
    const [logoutOutcome, cleanupOutcome] = await Promise.all([
      Promise.race([logout, timeout]),
      Promise.race([cleanup, timeout]),
    ])
    if (logoutOutcome.kind === 'timeout') logoutController.abort()
    if (!isCurrent(operation)) return
    setUser(null)
    setOfflineUser(null)
    setStatus('anonymous')
    if (cleanupOutcome.kind === 'error') {
      console.warn('Local collaboration cleanup did not complete during sign-out.', cleanupOutcome.error)
    }
    if (logoutOutcome.kind === 'error') throw logoutOutcome.error
    if (logoutOutcome.kind === 'timeout') {
      void logout.then((late) => {
        if (
          late.kind === 'error' &&
          !(late.error instanceof DOMException && late.error.name === 'AbortError')
        ) {
          console.warn('The server sign-out request failed after local sign-out.', late.error)
          if (isCurrent(operation)) {
            setError(messageFor(late.error, 'Server sign-out did not complete.'))
          }
        }
      })
    }
  }, [
    beginOperation,
    client,
    isCurrent,
    logoutTimeoutMs,
    offlineIdentityStore,
  ])

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
