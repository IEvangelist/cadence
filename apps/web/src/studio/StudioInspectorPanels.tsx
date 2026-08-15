import { type KeyboardEvent, type ReactNode, useId } from 'react'

export interface StudioInspectorPanel {
  id: string
  label: string
  content: ReactNode
}

interface StudioInspectorPanelsProps {
  panels: readonly StudioInspectorPanel[]
  activePanel: string
  onPanelChange(panelId: string): void
}

export function StudioInspectorPanels({
  panels,
  activePanel,
  onPanelChange,
}: StudioInspectorPanelsProps) {
  const instanceId = useId()
  const selected = panels.find((panel) => panel.id === activePanel) ?? panels[0]

  if (!selected) return null

  const moveSelection = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void => {
    const direction =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (direction === 0) return

    event.preventDefault()
    const nextIndex = (currentIndex + direction + panels.length) % panels.length
    const next = panels[nextIndex]
    onPanelChange(next.id)
    document.getElementById(`${instanceId}-${next.id}-tab`)?.focus()
  }

  return (
    <section className="studio-inspector-panels" aria-label="Inspector panels">
      <div className="studio-inspector-panels__tabs" role="tablist" aria-label="Inspector">
        {panels.map((panel, index) => {
          const selectedPanel = panel.id === selected.id
          return (
            <button
              key={panel.id}
              type="button"
              className="studio-inspector-panels__tab"
              role="tab"
              id={`${instanceId}-${panel.id}-tab`}
              aria-controls={`${instanceId}-${panel.id}-panel`}
              aria-selected={selectedPanel}
              tabIndex={selectedPanel ? 0 : -1}
              data-interaction="studio.inspector.panel"
              onClick={() => onPanelChange(panel.id)}
              onKeyDown={(event) => moveSelection(event, index)}
            >
              {panel.label}
            </button>
          )
        })}
      </div>
      <div
        className="studio-inspector-panels__panel"
        role="tabpanel"
        id={`${instanceId}-${selected.id}-panel`}
        aria-labelledby={`${instanceId}-${selected.id}-tab`}
      >
        {selected.content}
      </div>
    </section>
  )
}
