/**
 * StemsPage — the standalone stem-separation surface (issue #10, Phase 1).
 *
 * Deliberately its own feature area (`stems/`), separate from the composer core:
 * Phase 1 ships server-side separation, the async job pipeline, and this preview/
 * download UI. Turning a separated stem into an editable mixer track is a Phase 2
 * follow-up and is NOT wired into the composer here.
 *
 * Entitlement-gated on the server (Pro-only); this page mirrors that gate for UX
 * only, showing an upgrade CTA to free users. Brand-token themed (theme/tokens.css)
 * and accessible: a labelled region, a real heading hierarchy, progress announced
 * via aria-live, and errors surfaced with role="alert".
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { FormField } from '../ui/FormField'
import { Icon } from '../ui/Icon'
import { RoutedPage, RouteState } from '../ui/RoutedPage'
import { StemsClient, StemsError, type StemJob } from './stemsClient'
import './stems.css'

interface StemsPageProps {
  /** Whether this build has a configured backend. */
  backendAvailable?: boolean
  /** Whether the visitor is signed in (server still enforces auth). */
  authenticated: boolean
  /** Whether the visitor's entitlements include stem separation (Pro). */
  entitled: boolean
  /** Open the pricing/upgrade view. */
  onUpgrade?: () => void
  /** Close the stems view and return to the app. */
  onClose?: () => void
  /** Injectable client (tests pass a fake); defaults to the real API client. */
  client?: StemsClient
  /** Poll cadence for in-flight jobs, in ms. Small values speed up tests. */
  pollIntervalMs?: number
}

const TERMINAL: ReadonlySet<StemJob['status']> = new Set(['Completed', 'Failed'])

function isActive(job: StemJob): boolean {
  return !TERMINAL.has(job.status)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

export function StemsPage({
  backendAvailable = true,
  authenticated,
  entitled,
  onUpgrade,
  onClose,
  client,
  pollIntervalMs = 2000,
}: StemsPageProps) {
  const fileInputId = useId()
  const resolvedClient = useMemo(() => client ?? new StemsClient(), [client])

  const [file, setFile] = useState<File | null>(null)
  const [jobs, setJobs] = useState<StemJob[]>([])
  const [jobsStatus, setJobsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canSeparate = backendAvailable && authenticated && entitled

  const upsertJob = useCallback((job: StemJob) => {
    setJobs((previous) => {
      const next = previous.filter((existing) => existing.id !== job.id)
      return [job, ...next]
    })
  }, [])

  // Load existing jobs once the visitor is entitled.
  useEffect(() => {
    if (!canSeparate) return
    let cancelled = false
    void (async () => {
      setJobsStatus('loading')
      try {
        const summaries = await resolvedClient.listJobs()
        const details = await Promise.all(summaries.map((s) => resolvedClient.getJob(s.id)))
        if (!cancelled) {
          setJobs(details)
          setJobsStatus('ready')
        }
      } catch {
        if (!cancelled) setJobsStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canSeparate, loadAttempt, resolvedClient])

  // Poll in-flight jobs until they reach a terminal state.
  const activeIds = jobs.filter(isActive).map((job) => job.id).join(',')
  useEffect(() => {
    if (activeIds.length === 0) return
    const ids = activeIds.split(',')
    const timer = setInterval(() => {
      void (async () => {
        for (const id of ids) {
          try {
            upsertJob(await resolvedClient.getJob(id))
          } catch {
            // Transient read failures are retried on the next tick.
          }
        }
      })()
    }, pollIntervalMs)
    return () => clearInterval(timer)
  }, [activeIds, pollIntervalMs, resolvedClient, upsertJob])

  const separate = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      upsertJob(await resolvedClient.createJob(file))
      setFile(null)
    } catch (caught) {
      const message =
        caught instanceof StemsError
          ? caught.message
          : 'We couldn’t start that separation. Please try again.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <RoutedPage
      title="Stem separation"
      description="Upload a mix and split it into isolated stems: bass, drums, vocals, guitar, keys, synth, and everything else."
      className="stems"
      actions={
        onClose ? (
          <button
            type="button"
            className="btn"
            data-interaction="stems.close"
            onClick={onClose}
          >
            Back to composer
          </button>
        ) : null
      }
    >

      {!backendAvailable ? (
        <RouteState
          kind="info"
          label="Stem separation unavailable"
          title="Stems need a Cadence backend"
          message="The public static composer does not upload audio. Anonymous composing, local projects, and on-device AI remain available."
        />
      ) : !authenticated ? (
        <RouteState
          kind="info"
          label="Sign in required"
          title="Sign in to separate stems"
          message="Your mixes and generated stems stay connected to your account."
        />
      ) : !entitled ? (
        <RouteState
          kind="info"
          label="Pro plan required"
          title="Stem separation is a Pro feature"
          message="Upgrade to Pro to split your mixes into isolated, downloadable stems."
          action={
            onUpgrade ? (
              <button
                type="button"
                className="btn btn-primary"
                data-interaction="stems.upgrade"
                onClick={onUpgrade}
              >
                See Pro plans
              </button>
            ) : null
          }
        />
      ) : (
        <>
          <form
            className="stems-uploader"
            onSubmit={(event) => {
              event.preventDefault()
              void separate()
            }}
          >
            <FormField
              label="Choose a mix to separate"
              htmlFor={fileInputId}
              hint="Choose an audio file supported by your browser."
            >
              {(controlProps) => (
                <input
                  {...controlProps}
                  id={fileInputId}
                  className="stems-file"
                  type="file"
                  data-interaction="stems.upload.file"
                  accept="audio/*"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null)
                    setError(null)
                  }}
                />
              )}
            </FormField>
            <button
              type="submit"
              className="btn btn-primary"
              data-interaction="stems.separate"
              disabled={!file || busy}
            >
              {busy ? 'Uploading…' : 'Separate stems'}
            </button>
          </form>

          {error && (
            <RouteState kind="error" label={error} message={error} />
          )}

          <div aria-live="polite" className="stems-jobs">
            {jobsStatus === 'loading' ? (
              <RouteState kind="loading" label="Loading your previous separations" />
            ) : null}
            {jobsStatus === 'error' ? (
              <RouteState
                kind="error"
                label="Previous separations could not be loaded"
                title="Your separations are unavailable"
                message="We couldn’t load your previous separations. The source files and retained stems have not been changed."
                action={
                  <button
                    type="button"
                    className="btn"
                    data-interaction="stems.retry"
                    onClick={() => {
                      setJobsStatus('loading')
                      setLoadAttempt((attempt) => attempt + 1)
                    }}
                  >
                    Retry
                  </button>
                }
              />
            ) : null}
            {jobsStatus === 'ready' && jobs.length === 0 ? (
              <RouteState
                kind="empty"
                label="No separations yet"
                title="No separations yet"
                message="Upload a mix above to create your first set of stems."
              />
            ) : null}
            {jobsStatus !== 'loading' && jobs.length > 0 ? (
              <ul className="stems-job-list" role="list">
                {jobs.map((job) => (
                  <li key={job.id} className="stems-job">
                    <div className="stems-job-head">
                      <h3 className="stems-job-name">{job.originalFileName}</h3>
                      <span className={`stems-status stems-status-${job.status.toLowerCase()}`}>
                        {job.status}
                      </span>
                    </div>
                    {isActive(job) && (
                      <p role="status" className="stems-progress">
                        {job.status === 'Queued'
                          ? 'Queued for separation…'
                          : 'Separating stems…'}
                      </p>
                    )}
                    {job.status === 'Failed' && (
                      <p role="alert" className="stems-error">
                        {job.errorMessage ?? 'Separation failed. Please try another file.'}
                      </p>
                    )}
                    {job.status === 'Completed' && job.stems.length > 0 && (
                      <ul className="stems-outputs" role="list">
                        {job.stems.map((stem) => {
                          const href = resolvedClient.downloadUrl(stem)
                          return (
                            <li key={stem.label} className="stems-output">
                              <span className="stems-output-label">{stem.label}</span>
                              <audio
                                className="stems-audio"
                                controls
                                data-interaction="stems.preview"
                                preload="none"
                                src={href}
                                aria-label={`${stem.label} stem preview`}
                              />
                              <a
                                className="stems-download"
                                data-interaction="stems.download"
                                href={href}
                                download={`${job.originalFileName}-${stem.label}.wav`}
                              >
                                <Icon icon={Download} size={16} /> Download {stem.label} (
                                {formatBytes(stem.sizeBytes)})
                              </a>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}
    </RoutedPage>
  )
}
