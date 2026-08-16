import { useRef, type KeyboardEvent, type ReactNode } from 'react'
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
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const enabledItems = items.filter((item) => !item.disabled)
  const moveFocus = (
    event: KeyboardEvent<HTMLButtonElement>,
    itemId: string,
  ): void => {
    const currentIndex = enabledItems.findIndex((item) => item.id === itemId)
    if (currentIndex < 0) return
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabledItems.length
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length
    }
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = enabledItems.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const next = enabledItems[nextIndex]
    onChange(next.id)
    tabRefs.current.get(next.id)?.focus()
  }

  return (
    <section className="editor-detail-lane" aria-label="Editor detail">
      <div className="editor-detail-lane__tabs" role="tablist" aria-label="Editor detail lanes">
        {items.map((item) => {
          const selected = active?.id === item.id
          return (
            <button
              key={item.id}
              ref={(element) => {
                if (element) tabRefs.current.set(item.id, element)
                else tabRefs.current.delete(item.id)
              }}
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
              onKeyDown={(event) => moveFocus(event, item.id)}
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
