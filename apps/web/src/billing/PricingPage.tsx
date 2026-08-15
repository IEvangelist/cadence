/**
 * PricingPage — the in-app plan & upgrade surface (issue #8).
 *
 * Lives in its own feature area (`billing/`), deliberately outside the composer
 * core so it never collides with the exporter/plugin work in effort #12. It reads
 * the caller's server-authoritative entitlements, reflects the current tier, and
 * drives the hosted Stripe Checkout (upgrade) and Customer Portal (manage/cancel)
 * flows. This is the in-app pricing view, not the marketing landing (#13).
 *
 * Brand-token themed (see theme/tokens.css) and accessible: a labelled region,
 * a real heading hierarchy, and plans marked up as a list with the current plan
 * conveyed via aria-current rather than colour alone.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { EntitlementsClient, type Entitlements } from './entitlementsClient'
import './pricing.css'

interface PricingPageProps {
  /** Close the pricing view and return to the app. */
  onClose?: () => void
  /** Injectable client (tests pass a fake); defaults to the real API client. */
  client?: EntitlementsClient
  /** Injectable navigation (defaults to a full-page redirect) for testability. */
  redirect?: (url: string) => void
}

type PlanId = 'Free' | 'Pro'

interface PlanCopy {
  id: PlanId
  name: string
  price: string
  cadence: string
  tagline: string
  features: string[]
}

const PLANS: PlanCopy[] = [
  {
    id: 'Free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    tagline: 'Everything you need to start writing music today.',
    features: [
      'Up to 10 saved projects',
      'Full composer, piano roll & playback',
      'MIDI, MusicXML & project exports',
      'WAV export with a subtle Cadence watermark',
      '50 AI generations per day',
    ],
  },
  {
    id: 'Pro',
    name: 'Pro',
    price: '$12',
    cadence: 'per month',
    tagline: 'Remove the limits and the watermark.',
    features: [
      'Unlimited projects',
      'Clean, watermark-free WAV exports',
      'Unlimited AI generations',
      'Advanced formats & stem separation (soon)',
      'Up to 5 collaboration seats',
    ],
  },
]

export function PricingPage({ onClose, client, redirect }: PricingPageProps) {
  const headingId = useId()
  const resolvedClient = useMemo(() => client ?? new EntitlementsClient(), [client])
  const navigate = useMemo(
    () => redirect ?? ((url: string) => window.location.assign(url)),
    [redirect],
  )

  const [entitlements, setEntitlements] = useState<Entitlements | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState<'checkout' | 'portal' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await resolvedClient.getEntitlements()
        if (!cancelled) {
          setEntitlements(loaded)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [resolvedClient])

  const currentTier = entitlements?.tier ?? 'Free'
  const isPro = currentTier === 'Pro'

  const upgrade = async () => {
    setBusy('checkout')
    setActionError(null)
    try {
      navigate(await resolvedClient.startCheckout())
    } catch {
      setActionError('We couldn’t start checkout. Please try again.')
      setBusy(null)
    }
  }

  const manage = async () => {
    setBusy('portal')
    setActionError(null)
    try {
      navigate(await resolvedClient.openPortal())
    } catch {
      setActionError('We couldn’t open the billing portal. Please try again.')
      setBusy(null)
    }
  }

  return (
    <section className="pricing" aria-labelledby={headingId}>
      <div className="pricing-head">
        <div>
          <h2 id={headingId}>Plans &amp; pricing</h2>
          <p className="pricing-sub">
            Start free. Upgrade when you’re ready for clean exports and no limits.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="pricing-btn"
            data-interaction="pricing.close"
            onClick={onClose}
          >
            Back to composer
          </button>
        )}
      </div>

      {status === 'loading' && (
        <p role="status" className="pricing-status">
          Loading your plan…
        </p>
      )}
      {status === 'error' && (
        <p role="alert" className="pricing-error">
          We couldn’t load your plan. You can still review the options below.
        </p>
      )}

      {status === 'ready' && entitlements && (
        <p className="pricing-current" role="status">
          You’re on the <strong>{currentTier}</strong> plan.
          {isPro
            ? ' Your exports are watermark-free.'
            : ' Free exports include a subtle watermark.'}
        </p>
      )}

      <ul className="pricing-plans" role="list">
        {PLANS.map((plan) => {
          const current = plan.id === currentTier
          return (
            <li
              key={plan.id}
              className={`pricing-plan${current ? ' is-current' : ''}${plan.id === 'Pro' ? ' is-featured' : ''}`}
              aria-current={current ? 'true' : undefined}
            >
              <div className="pricing-plan-head">
                <h3>{plan.name}</h3>
                {current && <span className="pricing-badge">Current plan</span>}
              </div>
              <p className="pricing-price">
                <span className="pricing-amount">{plan.price}</span>{' '}
                <span className="pricing-cadence">{plan.cadence}</span>
              </p>
              <p className="pricing-tagline">{plan.tagline}</p>
              <ul className="pricing-features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>

              <div className="pricing-actions">
                {plan.id === 'Pro' && !isPro && (
                  <button
                    type="button"
                    className="pricing-btn pricing-btn-primary"
                    data-interaction="pricing.upgrade"
                    onClick={upgrade}
                    disabled={busy !== null}
                  >
                    {busy === 'checkout' ? 'Starting checkout…' : 'Upgrade to Pro'}
                  </button>
                )}
                {plan.id === 'Pro' && isPro && (
                  <button
                    type="button"
                    className="pricing-btn"
                    data-interaction="pricing.manage"
                    onClick={manage}
                    disabled={busy !== null}
                  >
                    {busy === 'portal' ? 'Opening…' : 'Manage billing'}
                  </button>
                )}
                {plan.id === 'Free' && !isPro && (
                  <span className="pricing-note">Your current plan</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {actionError && (
        <p role="alert" className="pricing-error">
          {actionError}
        </p>
      )}
    </section>
  )
}
