import {
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FormField } from '../ui/FormField'
import { AuthDialogAdapter } from './AuthDialogAdapter'
import {
  clearAuthReturnTarget,
  readAuthReturnTarget,
  routeLocationToString,
  safeAuthReturnTarget,
  saveAuthReturnTarget,
} from './authReturnTarget'
import { useAuth } from './authContext'
import {
  AuthDialogContext,
  type AuthDialogContextValue,
  type OpenAuthOptions,
} from './authDialogContext'
import { backendConfig } from '../platform/backendConfig'

interface AuthDialogProviderProps {
  children: ReactNode
}

export function AuthDialogProvider({ children }: AuthDialogProviderProps) {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const launcherRef = useRef<HTMLElement | null>(null)
  const attemptRef = useRef(0)
  const [options, setOptions] = useState<OpenAuthOptions | null>(null)
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [registerSent, setRegisterSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const formId = useId()

  const closeAuth = useCallback(() => {
    attemptRef.current += 1
    const dismissTo = options?.dismissTo
    setOptions(null)
    setBusy(false)
    clearAuthReturnTarget()
    if (dismissTo) {
      void navigate(safeAuthReturnTarget(dismissTo), { replace: true })
    }
    window.requestAnimationFrame(() => launcherRef.current?.focus())
  }, [navigate, options?.dismissTo])

  const openAuth = useCallback(
    (next: OpenAuthOptions = {}) => {
      if (!backendConfig.available) return
      attemptRef.current += 1
      setBusy(false)
      launcherRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      setOptions({
        returnTarget:
          next.returnTarget ??
          readAuthReturnTarget() ??
          routeLocationToString({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          }),
        dismissTo: next.dismissTo,
      })
    },
    [location.hash, location.pathname, location.search],
  )

  const completeLocalSignIn = useCallback(() => {
    attemptRef.current += 1
    const target = safeAuthReturnTarget(options?.returnTarget)
    launcherRef.current = null
    setOptions(null)
    clearAuthReturnTarget()
    void navigate(target, { replace: true })
    let attempts = 0
    const focusHeading = () => {
      const heading = document.querySelector<HTMLElement>('[data-route-heading]')
      if (heading) {
        heading.focus()
        return
      }
      attempts += 1
      if (attempts < 5) window.requestAnimationFrame(focusHeading)
    }
    window.requestAnimationFrame(focusHeading)
  }, [navigate, options?.returnTarget])

  const submitCredentials = async (event: React.FormEvent) => {
    event.preventDefault()
    const attempt = attemptRef.current
    setBusy(true)
    try {
      if (mode === 'signin') {
        await auth.signIn(email, password)
        if (attempt !== attemptRef.current) return
        setPassword('')
        completeLocalSignIn()
      } else {
        await auth.register(email, password, displayName || undefined)
        if (attempt !== attemptRef.current) return
        setRegisterSent(true)
        setPassword('')
      }
    } catch {
      // AuthProvider exposes the typed user-facing error.
    } finally {
      if (attempt === attemptRef.current) setBusy(false)
    }
  }

  const submitMagicLink = async (event: React.FormEvent) => {
    event.preventDefault()
    const attempt = attemptRef.current
    setBusy(true)
    try {
      await auth.requestMagicLink(magicEmail)
      if (attempt !== attemptRef.current) return
      setMagicSent(true)
    } catch {
      // AuthProvider exposes the typed user-facing error.
    } finally {
      if (attempt === attemptRef.current) setBusy(false)
    }
  }

  const context = useMemo<AuthDialogContextValue>(
    () => ({ openAuth, closeAuth, open: options !== null }),
    [closeAuth, openAuth, options],
  )

  return (
    <AuthDialogContext value={context}>
      {children}
      {backendConfig.available ? <AuthDialogAdapter
        open={options !== null}
        title={mode === 'signin' ? 'Sign in to Cadence' : 'Create your account'}
        description="Sign in, request a magic link, or create an account to continue."
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeAuth()
        }}
      >
        <form className="auth-form" onSubmit={submitCredentials}>
          {mode === 'register' ? (
            <FormField label="Display name" htmlFor={`${formId}-name`}>
              <input
                id={`${formId}-name`}
                type="text"
                data-interaction="auth.registration.display-name"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormField>
          ) : null}

          <FormField label="Email" htmlFor={`${formId}-email`}>
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
          </FormField>

          <FormField label="Password" htmlFor={`${formId}-password`}>
            <input
              id={`${formId}-password`}
              type="password"
              data-interaction="auth.credentials.password"
              required
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>

          <button
            type="submit"
            className="btn btn-primary"
            data-interaction="auth.credentials.submit"
            disabled={busy}
          >
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          {mode === 'register' && registerSent ? (
            <p className="auth-note" role="status">
              Check your email for a link to verify your account and finish signing up.
            </p>
          ) : null}
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
          <FormField label="Or get a magic sign-in link" htmlFor={`${formId}-magic`}>
            <input
              id={`${formId}-magic`}
              type="email"
              data-interaction="auth.magic-link.email"
              required
              autoComplete="email"
              value={magicEmail}
              onChange={(event) => {
                setMagicEmail(event.target.value)
                setMagicSent(false)
              }}
            />
          </FormField>
          <button
            type="submit"
            className="btn"
            data-interaction="auth.magic-link.submit"
            disabled={busy}
          >
            Email me a link
          </button>
          {magicSent ? (
            <p className="auth-note" role="status">
              If that address has an account, a sign-in link is on its way.
            </p>
          ) : null}
        </form>

        {auth.providers.length > 0 ? (
          <div className="auth-providers">
            <p className="auth-providers-label">Or continue with</p>
            <div className="auth-providers-buttons">
              {auth.providers.map((provider) => (
                <a
                  key={provider}
                  className="btn btn-sm"
                  data-interaction="auth.provider.sign-in"
                  href={auth.client.externalSignInUrl(provider)}
                  onClick={() => saveAuthReturnTarget(options?.returnTarget ?? '/')}
                >
                  {provider}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {auth.error ? (
          <p className="auth-error" role="alert">
            {auth.error}
          </p>
        ) : null}
      </AuthDialogAdapter> : null}
    </AuthDialogContext>
  )
}
