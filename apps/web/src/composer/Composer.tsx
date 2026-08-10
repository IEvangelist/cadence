import { type UseComposerOptions, useComposer } from './hooks/useComposer'
import { type UseAssistantOptions, useAssistant } from './hooks/useAssistant'
import { type UseAiStudioOptions, useAiStudio } from './hooks/useAiStudio'
import { useAiStudioEntitlements } from './hooks/useAiStudioEntitlements'
import { usePlugins } from './plugins/usePlugins'
import { ProjectToolbar } from './components/ProjectToolbar'
import { TransportBar } from './components/TransportBar'
import { TrackPanel } from './components/TrackPanel'
import { AssistantPanel } from './components/AssistantPanel'
import { AiStudioPanel } from './components/AiStudioPanel'
import { PluginsPanel } from './components/PluginsPanel'
import { PianoRoll } from './components/PianoRoll'
import { PresenceBar } from './components/PresenceBar'
import { ShareProjectButton } from './components/ShareProjectButton'
import {
  type CollabConfig,
  type CollabProviderFactory,
  useCollaboration,
} from './model/collab/useCollaboration'
import './Composer.css'

interface ComposerProps {
  /** Injectable engine/store/project — used by tests; defaults power the app. */
  options?: UseComposerOptions
  /** Injectable AI provider — used by tests/e2e; defaults to the factory. */
  assistantOptions?: UseAssistantOptions
  /**
   * Opt-in live-collaboration session parsed from a share link. `null`/omitted
   * keeps the composer fully single-user (the default). Supplied by `App` from
   * the signed-in identity + URL.
   */
  collab?: CollabConfig | null
  /** Injectable collaboration transport — used by tests/e2e. */
  collabProviderFactory?: CollabProviderFactory
  /** Whether to surface the owner "Share" affordance (signed-in users). */
  canShare?: boolean
  /** Injectable AI Studio entitlements — used by tests; defaults to context. */
  aiStudioOptions?: UseAiStudioOptions
}

/** The flagship composing surface: toolbar, transport, tracks, and piano roll. */
export function Composer({
  options,
  assistantOptions,
  collab = null,
  collabProviderFactory,
  canShare = false,
  aiStudioOptions,
}: ComposerProps = {}) {
  const controller = useComposer(options)
  const assistant = useAssistant(controller, assistantOptions)
  const resolvedEntitlements = useAiStudioEntitlements()
  const aiStudio = useAiStudio(controller, {
    entitlements: aiStudioOptions?.entitlements ?? resolvedEntitlements,
  })
  const plugins = usePlugins(controller)
  const { project, audioReady, loadDemo } = controller
  const isEmpty = project.tracks.every((track) => track.notes.length === 0)

  const collaboration = useCollaboration(
    {
      project,
      selectedTrackId: controller.selectedTrackId,
      selectedNoteIds: controller.state.selectedNoteIds,
      applyRemoteProject: controller.applyRemoteProject,
    },
    collab,
    collabProviderFactory,
  )

  return (
    <section className="composer" aria-label="Composer">
      <div className="composer-topbar">
        <ProjectToolbar controller={controller} />
        {canShare && <ShareProjectButton projectId={project.id} />}
      </div>
      {collaboration.active && (
        <PresenceBar
          presence={collaboration.presence}
          connected={collaboration.connected}
          canWrite={collaboration.canWrite}
          resolveTrackName={(id) => project.tracks.find((t) => t.id === id)?.name}
        />
      )}
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
          <AiStudioPanel studio={aiStudio} />
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
