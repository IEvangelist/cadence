/**
 * AuthBar — the sign-in / account control shown in the app header.
 *
 * Anonymous users get a disclosure panel with local email+password sign-in, a
 * toggle to create an account, a passwordless magic-link request, and buttons
 * for each wired external provider. Signed-in users get their display name, a
 * link to their profile, and sign-out. Every control is labelled for a11y.
 */
import { useId, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
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
  const [registerSent, setRegisterSent] = useState(false)
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
          data-interaction="auth.profile.open"
          aria-pressed={profileActive}
          onClick={onShowProfile}
        >
          Profile
        </button>
        <button
          type="button"
          className="btn btn-sm"
          data-interaction="auth.sign-out"
          onClick={() => void auth.signOut()}
        >
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
        setOpen(false)
        setPassword('')
      } else {
        // Registration no longer signs in — it sends a verification email. Keep the
        // panel open and confirm the email was sent (identically for any address,
        // so this reveals nothing about whether the account already existed).
        await auth.register(email, password, displayName || undefined)
        setRegisterSent(true)
        setPassword('')
      }
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
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-interaction="auth.panel.toggle"
            aria-expanded={open}
            aria-controls={`${formId}-panel`}
          >
            {open ? 'Close' : 'Sign in'}
          </button>
        </Popover.Trigger>

        <Popover.Portal>
          <Popover.Content
            className="auth-panel"
            id={`${formId}-panel`}
            aria-labelledby={`${formId}-title`}
            align="end"
            sideOffset={8}
          >
          <h2 className="auth-panel-title" id={`${formId}-title`}>
            {mode === 'signin' ? 'Sign in to Cadence' : 'Create your account'}
          </h2>

          <form className="auth-form" onSubmit={submitCredentials}>
            {mode === 'register' && (
              <div className="auth-field">
                <label htmlFor={`${formId}-name`}>Display name</label>
                <input
                  id={`${formId}-name`}
                  type="text"
                  data-interaction="auth.registration.display-name"
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
                data-interaction="auth.credentials.email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setRegisterSent(false)
                }}
              />
            </div>

            <div className="auth-field">
              <label htmlFor={`${formId}-password`}>Password</label>
              <input
                id={`${formId}-password`}
                type="password"
                data-interaction="auth.credentials.password"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              data-interaction="auth.credentials.submit"
              disabled={busy}
            >
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            {mode === 'register' && registerSent && (
              <p className="auth-note" role="status">
                Check your email for a link to verify your account and finish
                signing up.
              </p>
            )}
          </form>

          <button
            type="button"
            className="auth-link"
            data-interaction="auth.mode.toggle"
            onClick={() => {
              setRegisterSent(false)
              setMode((value) => (value === 'signin' ? 'register' : 'signin'))
            }}
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
                data-interaction="auth.magic-link.email"
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
            <button
              type="submit"
              className="btn"
              data-interaction="auth.magic-link.submit"
              disabled={busy}
            >
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
                    data-interaction="auth.provider.sign-in"
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
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
