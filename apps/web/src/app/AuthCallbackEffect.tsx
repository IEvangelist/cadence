import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  clearAuthReturnTarget,
  consumeAuthCallback,
  mergeAuthReturnLocation,
  readAuthReturnTarget,
  type RouteLocation,
} from '../auth/authReturnTarget'
import { useAuth } from '../auth/authContext'

interface PendingCallback {
  target: string
  cleanLocation: RouteLocation
}

interface AuthNotice {
  kind: 'success' | 'error'
  message: string
}

export function AuthCallbackEffect() {
  const auth = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const handled = useRef<string | null>(null)
  const [pending, setPending] = useState<PendingCallback | null>(null)
  const [refreshComplete, setRefreshComplete] = useState(false)
  const [notice, setNotice] = useState<AuthNotice | null>(null)

  useEffect(() => {
    const callback = consumeAuthCallback(location)
    if (!callback) return

    const signature = `${location.pathname}${location.search}${location.hash}`
    if (handled.current === signature) return
    handled.current = signature

    const target = readAuthReturnTarget() ?? '/'
    void navigate(callback.cleanLocation, { replace: true })

    if (callback.outcome === 'error') {
      clearAuthReturnTarget()
      queueMicrotask(() => {
        setNotice({
          kind: 'error',
          message:
            callback.reason === 'link-required'
              ? 'Sign in with your existing method first, then connect this provider from your profile.'
              : 'We couldn’t complete sign-in. Please try again.',
        })
      })
      return
    }

    queueMicrotask(() => {
      setPending({ target, cleanLocation: callback.cleanLocation })
      setRefreshComplete(false)
      void auth.refresh().finally(() => setRefreshComplete(true))
    })
  }, [auth, location, navigate])

  useEffect(() => {
    if (!pending || !refreshComplete || auth.status === 'loading') return

    if (auth.status === 'authenticated') {
      clearAuthReturnTarget()
      queueMicrotask(() => setNotice({ kind: 'success', message: 'You’re signed in.' }))
      void navigate(mergeAuthReturnLocation(pending.target, pending.cleanLocation), {
        replace: true,
      })
    } else {
      queueMicrotask(() => {
        setNotice({
          kind: 'error',
          message: 'We couldn’t confirm your session. Please sign in again.',
        })
      })
    }
    queueMicrotask(() => setPending(null))
  }, [auth.status, navigate, pending, refreshComplete])

  if (!notice) return null

  return (
    <div
      className={`auth-callback-notice auth-callback-notice--${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <span>{notice.message}</span>
      <button
        type="button"
        className="btn btn-sm"
        data-interaction="auth.callback.dismiss"
        aria-label="Dismiss authentication status"
        onClick={() => setNotice(null)}
      >
        Dismiss
      </button>
    </div>
  )
}
