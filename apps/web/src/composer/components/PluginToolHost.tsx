import { Suspense, useState } from 'react'
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
  const activePanel =
    panels.find((panel) => panel.id === requestedPanelId) ?? panels[0] ?? null

  if (!activePanel) return null

  const activeTabId = `plugin-tool-tab-${activePanel.id}`
  const activePanelId = `plugin-tool-panel-${activePanel.id}`

  return (
    <section className="plugin-tool-host" aria-label="Extension tools">
      <div className="tool-tabs" role="tablist" aria-label="Extension tools">
        {panels.map((panel) => {
          const selected = panel.id === activePanel.id
          return (
            <button
              key={panel.id}
              type="button"
              id={`plugin-tool-tab-${panel.id}`}
              className="tool-tab"
              role="tab"
              data-interaction="studio.plugins.panel.open"
              aria-controls={`plugin-tool-panel-${panel.id}`}
              aria-selected={selected}
              onClick={() => setRequestedPanelId(panel.id)}
            >
              {panel.title}
            </button>
          )
        })}
      </div>

      <section
        id={activePanelId}
        className="plugin-tool-surface"
        aria-label={activePanel.title}
        aria-labelledby={activeTabId}
      >
        <Suspense fallback={<p className="tool-panel-loading">Loading extension tool...</p>}>
          <PluginToolBody panel={activePanel} context={context} />
        </Suspense>
      </section>
    </section>
  )
}
