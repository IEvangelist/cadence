/**
 * Auth context + `useAuth` hook.
 *
 * Kept separate from the provider component so the module exports no React
 * components (satisfies react-refresh's only-export-components rule and keeps the
 * hook fast-refresh friendly).
 */
import { createContext, useContext } from 'react'
import { type AuthClient, type Me } from './authClient'
import type { OfflineAuthIdentity } from './offlineIdentity'

let authGeneration = 0

/** Process-wide monotonic auth ordering, including StrictMode remounts. */
export function nextAuthGeneration(): number {
  authGeneration += 1
  return authGeneration
}

export type AuthStatus =
  | 'loading'
  | 'verification-pending'
  | 'authenticated'
  | 'signing-out'
  | 'offline'
  | 'anonymous'

export interface AuthPersistenceChange {
  generation: number
  mode: 'authenticated' | 'offline' | 'anonymous'
  ownerId: string | null
  purgeOwnerIds: string[]
  /** False only when applying an already-broadcast cross-tab invalidation. */
  broadcast?: boolean
}

export interface AuthContextValue {
  /** The signed-in user, or null when anonymous. */
  user: Me | null
  /**
   * Last server-confirmed identity, available only when session verification
   * failed because the API is unreachable. It locates local collaboration data
   * and never authorizes network or API access.
   */
  offlineUser: OfflineAuthIdentity | null
  /** Coarse auth lifecycle state for rendering. */
  status: AuthStatus
  /** External OAuth providers the server has wired. */
  providers: string[]
  /** The most recent auth error message, if any. */
  error: string | null
  /** The underlying client (used for external sign-in URLs and profile calls). */
  client: AuthClient
  /** Register a local account. Resolves once the verification email is queued;
   *  the account is activated by the emailed link, not by this call — so it does
   *  NOT sign the browser in and never reveals whether the email already existed. */
  register: (email: string, password: string, displayName?: string) => Promise<void>
  /** Sign in with a local account. */
  signIn: (email: string, password: string) => Promise<void>
  /** Request a passwordless magic-link email. */
  requestMagicLink: (email: string) => Promise<void>
  /** Sign out the current session. */
  signOut: () => Promise<void>
  /** Re-read the session from the server. */
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** Access the auth context; throws if used outside an {@link AuthProvider}. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider.')
  }
  return context
}
