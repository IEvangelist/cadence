import { type ReactNode, useId } from 'react'
import './StudioFrame.css'

export type StudioView = 'write' | 'mix'

export interface StudioFrameProps {
  projectControls: ReactNode
  transportControls: ReactNode
  rail: ReactNode
  editor: ReactNode
  mix: ReactNode
  inspector?: ReactNode
  collaborationControls?: ReactNode
  utilityControls?: ReactNode
  view: StudioView
  onViewChange(view: StudioView): void
  railOpen?: boolean
  inspectorOpen?: boolean
  onInspectorToggle?(): void
  inspectorLabel?: string
}

/**
 * Fixed-height Studio workbench. The frame owns geometry and visibility while
 * feature lanes own the controls rendered into each slot.
 */
export function StudioFrame({
  projectControls,
  transportControls,
  rail,
  editor,
  inspector,
  mix,
  collaborationControls,
  utilityControls,
  view,
  onViewChange,
  railOpen = true,
  inspectorOpen = false,
  onInspectorToggle,
  inspectorLabel = 'Inspector',
}: StudioFrameProps) {
  const inspectorId = useId()
  const hasInspector = Boolean(inspector && inspectorOpen)
  const workSurface = view === 'mix' ? mix : editor
  const className = [
    'studio-frame',
    railOpen ? 'studio-frame--rail-open' : '',
    hasInspector ? 'studio-frame--inspector-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section
      className={className}
      aria-label="Studio workbench"
      data-studio-workbench
      data-studio-view={view}
    >
      <header className="studio-frame__app-bar" aria-label="Project and transport">
        <div className="studio-frame__project" data-studio-cluster="project">
          {projectControls}
        </div>
        <div className="studio-frame__transport" data-studio-cluster="transport">
          {transportControls}
        </div>
      </header>

      {railOpen ? (
        <aside className="studio-frame__rail" aria-label="Track rail" data-studio-scroll="rail">
          {rail}
        </aside>
      ) : null}

      <section
        className="studio-frame__editor"
        id="studio-editor"
        aria-label={view === 'mix' ? 'Mix workspace' : 'Write workspace'}
        data-studio-scroll="editor"
      >
        {workSurface}
      </section>

      {/* Painted in the app bar but kept after the editor in DOM focus order. */}
      <div className="studio-frame__utilities">
        <div className="studio-frame__view-switch" role="group" aria-label="Workspace view">
          <button
            type="button"
            className="studio-frame__view-button"
            data-interaction="studio.view.write"
            aria-pressed={view === 'write'}
            onClick={() => onViewChange('write')}
          >
            Write
          </button>
          <button
            type="button"
            className="studio-frame__view-button"
            data-interaction="studio.view.mix"
            aria-pressed={view === 'mix'}
            onClick={() => onViewChange('mix')}
          >
            Mix
          </button>
        </div>

        {inspector && onInspectorToggle ? (
          <button
            type="button"
            className="studio-frame__utility-button"
            data-interaction="studio.inspector.toggle"
            aria-controls={hasInspector ? inspectorId : undefined}
            aria-expanded={hasInspector}
            onClick={onInspectorToggle}
          >
            {inspectorLabel}
          </button>
        ) : null}

        {collaborationControls ? (
          <div className="studio-frame__collaboration" data-studio-cluster="collaboration">
            {collaborationControls}
          </div>
        ) : null}
        {utilityControls ? (
          <div className="studio-frame__utility-cluster" data-studio-cluster="utility">
            {utilityControls}
          </div>
        ) : null}
      </div>

      {hasInspector ? (
        <aside
          className="studio-frame__inspector"
          id={inspectorId}
          aria-label={inspectorLabel}
          data-studio-scroll="inspector"
        >
          {inspector}
        </aside>
      ) : null}
    </section>
  )
}
