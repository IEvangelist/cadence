/**
 * Auth context + `useAuth` hook.
 *
 * Kept separate from the provider component so the module exports no React
 * components (satisfies react-refresh's only-export-components rule and keeps the
 * hook fast-refresh friendly).
 */
import { createContext, useContext } from 'react'
import { type AuthClient, type Me } from './authClient'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  /** The signed-in user, or null when anonymous. */
  user: Me | null
  /** Coarse auth lifecycle state for rendering. */
  status: AuthStatus
  /** External OAuth providers the server has wired. */
  providers: string[]
  /** The most recent auth error message, if any. */
  error: string | null
  /** The underlying client (used for external sign-in URLs and profile calls). */
  client: AuthClient
  /** Register a local account and sign in. */
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
