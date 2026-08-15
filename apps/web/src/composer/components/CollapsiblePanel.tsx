import { useId, type ReactNode } from 'react'

interface CollapsiblePanelProps {
  /** Stable id used to persist open state via {@link usePanelLayout} (e.g. "mixer"). */
  id: string
  /** Visible disclosure label; also serves as the panel's accessible heading. */
  title: string
  /** Whether the panel body is expanded. */
  open: boolean
  /** Toggle handler; receives the panel {@link id}. */
  onToggle: (id: string) => void
  children: ReactNode
}

/**
 * A collapsible side-rail section (#98 compact composer UX). The disclosure is an
 * `<h2>` so the composer's heading ladder reads H1 (Cadence) → H2 (panel) → H3
 * (panel body), fixing the previous H1→H3 jump. Collapsed bodies use `hidden`, so
 * they leave the accessibility tree entirely and keep the rail compact.
 *
 * Panels are independently collapsible (not exclusive tabs): several can be open
 * at once, which the plugins/extensions flows rely on.
 */
export function CollapsiblePanel({ id, title, open, onToggle, children }: CollapsiblePanelProps) {
  const bodyId = useId()

  return (
    <div className={`rail-item${open ? ' is-open' : ''}`}>
      <h2 className="rail-item__heading">
        <button
          type="button"
          className="rail-item__toggle"
          data-interaction="studio.panel.toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onToggle(id)}
        >
          <span className="rail-item__chevron" aria-hidden="true" />
          <span className="rail-item__title">{title}</span>
        </button>
      </h2>
      <div id={bodyId} className="rail-item__body" hidden={!open}>
        {children}
      </div>
    </div>
  )
}
