import { Suspense, useRef, useState, type KeyboardEvent } from 'react'
import type { PanelContribution, PanelRenderContext } from '../plugins'
import './ToolWorkspaces.css'

interface PluginToolHostProps {
  panels: readonly PanelContribution[]
  context: PanelRenderContext
}

function PluginToolBody({
  panel,
  context,
}: {
  panel: PanelContribution
  context: PanelRenderContext
}) {
  return panel.render(context)
}

/**
 * Mounts one visible plugin panel at a time. Visibility filtering remains owned
 * by usePlugins; inactive tools are intentionally unmounted and non-focusable.
 */
export function PluginToolHost({ panels, context }: PluginToolHostProps) {
  const [requestedPanelId, setRequestedPanelId] = useState<string | null>(null)
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const activePanel =
    panels.find((panel) => panel.id === requestedPanelId) ?? panels[0] ?? null

  if (!activePanel) return null

  const activeTabId = `plugin-tool-tab-${activePanel.id}`
  const activePanelId = 'plugin-tool-panel'

  const selectPanel = (panelId: string) => {
    setRequestedPanelId(panelId)
    tabRefs.current[panelId]?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % panels.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + panels.length) % panels.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = panels.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    selectPanel(panels[nextIndex].id)
  }

  return (
    <section className="plugin-tool-host" aria-label="Extension tools">
      <div className="tool-tabs" role="tablist" aria-label="Extension tools">
        {panels.map((panel, index) => {
          const selected = panel.id === activePanel.id
          return (
            <button
              key={panel.id}
              type="button"
              id={`plugin-tool-tab-${panel.id}`}
              className="tool-tab"
              role="tab"
              data-interaction="studio.plugins.panel.open"
              aria-controls={activePanelId}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectPanel(panel.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(element) => {
                tabRefs.current[panel.id] = element
              }}
            >
              {panel.title}
            </button>
          )
        })}
      </div>

      <section
        id={activePanelId}
        role="tabpanel"
        className="plugin-tool-surface"
        aria-labelledby={activeTabId}
      >
        <section aria-label={activePanel.title}>
          <Suspense fallback={<p className="tool-panel-loading">Loading extension tool...</p>}>
            <PluginToolBody panel={activePanel} context={context} />
          </Suspense>
        </section>
      </section>
    </section>
  )
}
