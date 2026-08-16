import { lazy, Suspense, useState } from 'react'
import type { AssistantController } from '../hooks/useAssistant'
import type { AiStudioController } from '../hooks/useAiStudio'
import { AssistantPanel } from './AssistantPanel'
import './ToolWorkspaces.css'

const LazyAiStudioPanel = lazy(async () => {
  const module = await import('./AiStudioPanel')
  return { default: module.AiStudioPanel }
})

export type AiInspectorView = 'basic' | 'advanced'

interface AiInspectorProps {
  assistant: AssistantController
  studio: AiStudioController
  initialView?: AiInspectorView
}

/**
 * Presentation-only shell for the existing Basic Assistant and Advanced AI
 * Studio controllers. Advanced UI code loads on first use, then remains mounted
 * so switching views does not discard in-progress controls or reports.
 */
export function AiInspector({
  assistant,
  studio,
  initialView = 'basic',
}: AiInspectorProps) {
  const [view, setView] = useState<AiInspectorView>(initialView)
  const [advancedVisited, setAdvancedVisited] = useState(initialView === 'advanced')

  const selectView = (next: AiInspectorView) => {
    setView(next)
    if (next === 'advanced') setAdvancedVisited(true)
  }

  return (
    <section className="ai-inspector" aria-label="AI tools">
      <div className="tool-tabs" role="tablist" aria-label="AI mode">
        <button
          type="button"
          id="ai-inspector-basic-tab"
          className="tool-tab"
          role="tab"
          data-interaction="studio.ai.inspector.tab"
          aria-controls="ai-inspector-basic-panel"
          aria-selected={view === 'basic'}
          onClick={() => selectView('basic')}
        >
          Basic
        </button>
        <button
          type="button"
          id="ai-inspector-advanced-tab"
          className="tool-tab"
          role="tab"
          data-interaction="studio.ai.inspector.tab"
          aria-controls="ai-inspector-advanced-panel"
          aria-selected={view === 'advanced'}
          onClick={() => selectView('advanced')}
        >
          Advanced
        </button>
      </div>

      <div
        id="ai-inspector-basic-panel"
        role="tabpanel"
        aria-labelledby="ai-inspector-basic-tab"
        hidden={view !== 'basic'}
      >
        <AssistantPanel assistant={assistant} />
      </div>

      {advancedVisited ? (
        <div
          id="ai-inspector-advanced-panel"
          role="tabpanel"
          aria-labelledby="ai-inspector-advanced-tab"
          hidden={view !== 'advanced'}
        >
          <Suspense fallback={<p className="tool-panel-loading">Loading advanced AI tools...</p>}>
            <LazyAiStudioPanel studio={studio} />
          </Suspense>
        </div>
      ) : null}
    </section>
  )
}
