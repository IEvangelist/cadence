import { type ReactNode, useId } from 'react'
import './routed-page.css'

interface RoutedPageProps {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
  width?: 'content' | 'wide'
  actions?: ReactNode
}

export function RoutedPage({
  title,
  description,
  children,
  className,
  width = 'wide',
  actions,
}: RoutedPageProps) {
  const headingId = useId()
  const classes = ['route-page', `route-page--${width}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes} aria-labelledby={headingId}>
      <header className="route-page__header">
        <div className="route-page__heading">
          <h2 id={headingId} tabIndex={-1} data-route-heading>
            {title}
          </h2>
          {description ? <div className="route-page__description">{description}</div> : null}
        </div>
        {actions ? <div className="route-page__actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

type RouteStateKind = 'loading' | 'empty' | 'error' | 'success' | 'info'

interface RouteStateProps {
  kind: RouteStateKind
  label: string
  title?: string
  message?: ReactNode
  action?: ReactNode
}

export function RouteState({
  kind,
  label,
  title,
  message,
  action,
}: RouteStateProps) {
  const role = kind === 'error' ? 'alert' : 'status'

  return (
    <div className={`route-state route-state--${kind}`} role={role} aria-label={label}>
      {kind === 'loading' ? (
        <div className="route-state__skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {title ? <h3 className="route-state__title">{title}</h3> : null}
      {message ? <div className="route-state__message">{message}</div> : null}
      {action}
    </div>
  )
}

interface RoutedPageSkeletonProps {
  label: string
  width?: 'content' | 'wide'
}

export function RoutedPageSkeleton({ label, width = 'wide' }: RoutedPageSkeletonProps) {
  const headingId = useId()

  return (
    <section
      className={`route-page route-page--${width} route-page-skeleton`}
      aria-labelledby={headingId}
      aria-busy="true"
    >
      <h2 id={headingId} className="visually-hidden">
        {label}
      </h2>
      <div className="route-page-skeleton__header" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="route-page-skeleton__body" aria-hidden="true">
        <span />
        <span />
      </div>
      <p className="visually-hidden" role="status">
        {label}
      </p>
    </section>
  )
}
