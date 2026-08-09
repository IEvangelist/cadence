import { type UseComposerOptions, useComposer } from './hooks/useComposer'
import { type UseAssistantOptions, useAssistant } from './hooks/useAssistant'
import { usePlugins } from './plugins/usePlugins'
import { ProjectToolbar } from './components/ProjectToolbar'
import { TransportBar } from './components/TransportBar'
import { TrackPanel } from './components/TrackPanel'
import { AssistantPanel } from './components/AssistantPanel'
import { PluginsPanel } from './components/PluginsPanel'
import { PianoRoll } from './components/PianoRoll'
import './Composer.css'

interface ComposerProps {
  /** Injectable engine/store/project — used by tests; defaults power the app. */
  options?: UseComposerOptions
  /** Injectable AI provider — used by tests/e2e; defaults to the factory. */
  assistantOptions?: UseAssistantOptions
}

/** The flagship composing surface: toolbar, transport, tracks, and piano roll. */
export function Composer({ options, assistantOptions }: ComposerProps = {}) {
  const controller = useComposer(options)
  const assistant = useAssistant(controller, assistantOptions)
  const plugins = usePlugins(controller)
  const { project, audioReady, loadDemo } = controller
  const isEmpty = project.tracks.every((track) => track.notes.length === 0)

  return (
    <section className="composer" aria-label="Composer">
      <ProjectToolbar controller={controller} />
      <TransportBar controller={controller} />

      {isEmpty && (
        <div className="composer-empty">
          <p className="composer-empty-title">Your canvas is empty.</p>
          <p className="composer-empty-hint">
            Click the grid to place a note, or start from a ready-made idea.
          </p>
          <button type="button" className="btn btn-primary" onClick={loadDemo}>
            Load a demo pattern
          </button>
        </div>
      )}

      <div className="composer-body">
        <div className="composer-sidebar">
          <TrackPanel controller={controller} />
          <AssistantPanel assistant={assistant} />
          <PluginsPanel plugins={plugins} />
          {plugins.visiblePanels.map((panel) => (
            <section key={panel.id} className="plugin-surface" aria-label={panel.title}>
              {panel.render(plugins.panelContext)}
            </section>
          ))}
        </div>
        <PianoRoll controller={controller} previewNotes={assistant.previewNotes} />
      </div>

      {!audioReady && (
        <p className="audio-note" role="note">
          Audio output isn’t available in this environment — editing, saving, and MIDI export
          still work.
        </p>
      )}
    </section>
  )
}
