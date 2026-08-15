import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import type { ComposerController } from '../composer/hooks/useComposer'

interface StudioNavigationGuardProps {
  controller: Pick<ComposerController, 'isDirty' | 'flushAutosave'>
}

export function StudioNavigationGuard({ controller }: StudioNavigationGuardProps) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      controller.isDirty &&
      currentLocation.pathname === '/' &&
      nextLocation.pathname !== currentLocation.pathname,
  )
  const [error, setError] = useState<string | null>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const attemptedKeyRef = useRef<string | null>(null)

  const flushAndProceed = useCallback(async () => {
    setError(null)
    try {
      await controller.flushAutosave()
      if (blocker.state === 'blocked') blocker.proceed()
    } catch {
      setError('Cadence couldn’t save your latest changes. Retry or discard them to leave Studio.')
    }
  }, [blocker, controller])

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      attemptedKeyRef.current = null
      return
    }
    const key = blocker.location.key
    if (attemptedKeyRef.current === key) return
    attemptedKeyRef.current = key
    void flushAndProceed()
  }, [blocker, flushAndProceed])

  useEffect(() => {
    if (error) retryRef.current?.focus()
  }, [error])

  useEffect(() => {
    const flush = () => {
      if (controller.isDirty) void controller.flushAutosave().catch(() => undefined)
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [controller])

  if (blocker.state !== 'blocked') return null

  if (!error) {
    return (
      <p className="autosave-status" role="status">
        Saving changes…
      </p>
    )
  }

  return (
    <section className="autosave-guard" role="alertdialog" aria-labelledby="autosave-title">
      <h2 id="autosave-title">Your latest changes aren’t saved</h2>
      <p>{error}</p>
      <div className="autosave-guard__actions">
        <button
          ref={retryRef}
          type="button"
          className="btn btn-primary"
          data-interaction="studio.autosave.retry"
          onClick={() => void flushAndProceed()}
        >
          Retry save
        </button>
        <button
          type="button"
          className="btn"
          data-interaction="studio.autosave.discard"
          onClick={() => blocker.proceed()}
        >
          Discard changes
        </button>
      </div>
    </section>
  )
}
