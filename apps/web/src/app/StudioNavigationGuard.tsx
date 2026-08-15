import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import type { ComposerController } from '../composer/hooks/useComposer'

interface StudioNavigationGuardProps {
  controller: Pick<ComposerController, 'isDirty' | 'isFlushing' | 'flushAutosave'>
}

export function StudioNavigationGuard({ controller }: StudioNavigationGuardProps) {
  const { isDirty, isFlushing, flushAutosave } = controller
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      currentLocation.pathname === '/' &&
      nextLocation.pathname !== currentLocation.pathname,
  )
  const [error, setError] = useState<string | null>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  const attemptedKeyRef = useRef<string | null>(null)
  const generationRef = useRef(0)
  const saveAttemptRef = useRef<Promise<void> | null>(null)

  const saveOnce = useCallback(() => {
    if (saveAttemptRef.current) return saveAttemptRef.current
    const attempt = flushAutosave().finally(() => {
      if (saveAttemptRef.current === attempt) saveAttemptRef.current = null
    })
    saveAttemptRef.current = attempt
    return attempt
  }, [flushAutosave])

  const flushAndProceed = useCallback(async (generation: number) => {
    setError(null)
    try {
      await saveOnce()
      if (generation === generationRef.current && blocker.state === 'blocked') {
        blocker.proceed()
      }
    } catch {
      if (generation === generationRef.current) {
        setError(
          'Cadence couldn’t save your latest changes. Retry or discard them to leave Studio.',
        )
      }
    }
  }, [blocker, saveOnce])

  useEffect(() => {
    if (blocker.state !== 'blocked') {
      attemptedKeyRef.current = null
      return
    }
    const key = blocker.location.key
    if (attemptedKeyRef.current === key) return
    attemptedKeyRef.current = key
    generationRef.current += 1
    void flushAndProceed(generationRef.current)
  }, [blocker, flushAndProceed])

  useEffect(() => {
    if (error) retryRef.current?.focus()
  }, [error])

  useEffect(() => {
    if (!isDirty && !isFlushing) return
    // Browsers cannot await pagehide cleanup. beforeunload is the only full-page
    // boundary here: confirming it is an explicit discard. Durable crash/unload
    // recovery belongs to the start-center hydration work in #154.
    const confirmUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmUnload)
    return () => window.removeEventListener('beforeunload', confirmUnload)
  }, [isDirty, isFlushing])

  useEffect(() => {
    const bestEffortFlush = () => {
      if (isDirty && !isFlushing) {
        void flushAutosave().catch(() => undefined)
      }
    }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') bestEffortFlush()
    }
    window.addEventListener('pagehide', bestEffortFlush)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', bestEffortFlush)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [flushAutosave, isDirty, isFlushing])

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
          onClick={() => {
            generationRef.current += 1
            void flushAndProceed(generationRef.current)
          }}
        >
          Retry save
        </button>
        <button
          type="button"
          className="btn"
          data-interaction="studio.autosave.discard"
          onClick={() => {
            generationRef.current += 1
            blocker.proceed()
          }}
        >
          Discard changes
        </button>
      </div>
    </section>
  )
}
