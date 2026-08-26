/**
 * AuthBar — the sign-in / account control shown in the app header.
 *
 * Anonymous users get a Dialog launcher. Signed-in users get their display name,
 * a link to their profile, and sign-out. Every control is labelled for a11y.
 */
import { useAuth } from './authContext'
import { backendConfig } from '../platform/backendConfig'

interface AuthBarProps {
  /** Open the shared sign-in Dialog. */
  onShowSignIn: () => void
  /** Open the profile view. */
  onShowProfile: () => void
  /** Whether the profile view is currently open (for aria-pressed). */
  profileActive: boolean
  /** Whether logout and the project-store transition are still pending. */
  signingOut: boolean
  /** Sign out and apply route-specific navigation. */
  onSignOut: () => void | Promise<void>
}

export function AuthBar({
  onShowSignIn,
  onShowProfile,
  profileActive,
  signingOut,
  onSignOut,
}: AuthBarProps) {
  const auth = useAuth()

  if (!backendConfig.available) {
    return (
      <p className="authbar auth-note" role="status">
        Local-only mode. Accounts and cloud sync are not connected.
      </p>
    )
  }

  if (auth.status === 'loading') {
    return <div className="authbar authbar--loading" aria-hidden="true" />
  }

  if (auth.status === 'authenticated' && auth.user) {
    return (
      <div className="authbar">
        <span className="authbar-greeting">
          Signed in as <strong>{auth.user.displayName}</strong>
        </span>
        <button
          type="button"
          className="btn btn-sm"
          data-interaction="auth.profile.open"
          aria-pressed={profileActive}
          disabled={signingOut}
          onClick={onShowProfile}
        >
          Profile
        </button>
        <button
          type="button"
          className="btn btn-sm"
          data-interaction="auth.sign-out"
          disabled={signingOut}
          onClick={() => void onSignOut()}
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    )
  }

  return (
    <div className="authbar">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        data-interaction="auth.panel.toggle"
        onClick={onShowSignIn}
      >
        Sign in
      </button>
    </div>
  )
}
