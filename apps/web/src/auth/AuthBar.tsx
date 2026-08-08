/**
 * AuthBar — the sign-in / account control shown in the app header.
 *
 * Anonymous users get a disclosure panel with local email+password sign-in, a
 * toggle to create an account, a passwordless magic-link request, and buttons
 * for each wired external provider. Signed-in users get their display name, a
 * link to their profile, and sign-out. Every control is labelled for a11y.
 */
import { useId, useState } from 'react'
import { useAuth } from './authContext'

interface AuthBarProps {
  /** Open the profile view. */
  onShowProfile: () => void
  /** Whether the profile view is currently open (for aria-pressed). */
  profileActive: boolean
}

type Mode = 'signin' | 'register'

export function AuthBar({ onShowProfile, profileActive }: AuthBarProps) {
  const auth = useAuth()
  const formId = useId()

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [busy, setBusy] = useState(false)

  if (auth.status === 'loading') {
    return <div className="authbar" aria-hidden="true" />
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
          aria-pressed={profileActive}
          onClick={onShowProfile}
        >
          Profile
        </button>
        <button type="button" className="btn btn-sm" onClick={() => void auth.signOut()}>
          Sign out
        </button>
      </div>
    )
  }

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signin') {
        await auth.signIn(email, password)
      } else {
        await auth.register(email, password, displayName || undefined)
      }
      setOpen(false)
      setPassword('')
    } catch {
      // The error is surfaced via auth.error below.
    } finally {
      setBusy(false)
    }
  }

  const submitMagicLink = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await auth.requestMagicLink(magicEmail)
      setMagicSent(true)
    } catch {
      // Surfaced via auth.error.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="authbar">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        aria-expanded={open}
        aria-controls={`${formId}-panel`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Close' : 'Sign in'}
      </button>

      {open && (
        <div className="auth-panel" id={`${formId}-panel`}>
          <h2 className="auth-panel-title">
            {mode === 'signin' ? 'Sign in to Cadence' : 'Create your account'}
          </h2>

          <form className="auth-form" onSubmit={submitCredentials}>
            {mode === 'register' && (
              <div className="auth-field">
                <label htmlFor={`${formId}-name`}>Display name</label>
                <input
                  id={`${formId}-name`}
                  type="text"
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            )}

            <div className="auth-field">
              <label htmlFor={`${formId}-email`}>Email</label>
              <input
                id={`${formId}-email`}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="auth-field">
              <label htmlFor={`${formId}-password`}>Password</label>
              <input
                id={`${formId}-password`}
                type="password"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <button
            type="button"
            className="auth-link"
            onClick={() => setMode((value) => (value === 'signin' ? 'register' : 'signin'))}
          >
            {mode === 'signin'
              ? 'New here? Create an account'
              : 'Already have an account? Sign in'}
          </button>

          <form className="auth-form auth-magic" onSubmit={submitMagicLink}>
            <div className="auth-field">
              <label htmlFor={`${formId}-magic`}>Or get a magic sign-in link</label>
              <input
                id={`${formId}-magic`}
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={magicEmail}
                onChange={(event) => {
                  setMagicEmail(event.target.value)
                  setMagicSent(false)
                }}
              />
            </div>
            <button type="submit" className="btn" disabled={busy}>
              Email me a link
            </button>
            {magicSent && (
              <p className="auth-note" role="status">
                If that address has an account, a sign-in link is on its way.
              </p>
            )}
          </form>

          {auth.providers.length > 0 && (
            <div className="auth-providers">
              <p className="auth-providers-label">Or continue with</p>
              <div className="auth-providers-buttons">
                {auth.providers.map((provider) => (
                  <a
                    key={provider}
                    className="btn btn-sm"
                    href={auth.client.externalSignInUrl(provider)}
                  >
                    {provider}
                  </a>
                ))}
              </div>
            </div>
          )}

          {auth.error && (
            <p className="auth-error" role="alert">
              {auth.error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
