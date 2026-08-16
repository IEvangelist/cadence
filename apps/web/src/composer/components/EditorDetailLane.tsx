import type { ReactNode } from 'react'
import './EditorWorkspace.css'

export interface EditorDetailLaneItem {
  id: string
  label: string
  content: ReactNode
  disabled?: boolean
}

interface EditorDetailLaneProps {
  items: readonly EditorDetailLaneItem[]
  activeId: string
  onChange: (id: string) => void
}

export function EditorDetailLane({ items, activeId, onChange }: EditorDetailLaneProps) {
  const active = items.find((item) => item.id === activeId && !item.disabled)
    ?? items.find((item) => !item.disabled)

  return (
    <section className="editor-detail-lane" aria-label="Editor detail">
      <div className="editor-detail-lane__tabs" role="tablist" aria-label="Editor detail lanes">
        {items.map((item) => {
          const selected = active?.id === item.id
          return (
            <button
              key={item.id}
              id={`detail-tab-${item.id}`}
              type="button"
              role="tab"
              className={`btn btn-sm${selected ? ' is-active' : ''}`}
              data-interaction="studio.editor-detail.tab"
              aria-selected={selected}
              aria-controls={`detail-panel-${item.id}`}
              disabled={item.disabled}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
      {active ? (
        <div
          id={`detail-panel-${active.id}`}
          className="editor-detail-lane__panel"
          role="tabpanel"
          aria-labelledby={`detail-tab-${active.id}`}
        >
          {active.content}
        </div>
      ) : null}
    </section>
  )
}
