import { useState } from 'react'
import { type UseComposerOptions, useComposer } from './hooks/useComposer'
import type { ComposerController } from './hooks/useComposer'
import { type UseAssistantOptions, useAssistant } from './hooks/useAssistant'
import { type UseAiStudioOptions, useAiStudio } from './hooks/useAiStudio'
import { useAiStudioEntitlements } from './hooks/useAiStudioEntitlements'
import { useMixer } from './hooks/useMixer'
import { usePanelLayout } from './hooks/usePanelLayout'
import { usePlugins } from './plugins/usePlugins'
import { ProjectToolbar } from './components/ProjectToolbar'
import { MidiControls } from './components/MidiControls'
import { TransportBar } from './components/TransportBar'
import { TrackPanel } from './components/TrackPanel'
import { AssistantPanel } from './components/AssistantPanel'
import { AiStudioPanel } from './components/AiStudioPanel'
import { MixerPanel } from './components/MixerPanel'
import { PluginsPanel } from './components/PluginsPanel'
import { CollapsiblePanel } from './components/CollapsiblePanel'
import { PianoRoll } from './components/PianoRoll'
import { PresenceBar } from './components/PresenceBar'
import { ShareProjectButton } from './components/ShareProjectButton'
import { StartCenter } from './components/StartCenter'
import { ProjectBrowser } from './components/ProjectBrowser'
import { ProjectReplacementDialog } from './components/ProjectReplacementDialog'
import {
  type CollabConfig,
  type CollabProviderFactory,
  useCollaboration,
} from './model/collab/useCollaboration'
import { CollaborationStatusContext } from './contract/collaborationContext'
import { selectCollaborationStatus } from './contract/collaborationSelector'
import { StudioNavigationGuard } from '../app/StudioNavigationGuard'
import { OnboardingTour } from '../onboarding/OnboardingTour'
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
  /** Await project persistence before the Studio route unmounts. */
  guardNavigation?: boolean
}

/** The flagship composing surface: toolbar, transport, tracks, and piano roll. */
export function Composer({
  options,
  assistantOptions,
  collab = null,
  collabProviderFactory,
  canShare = false,
  aiStudioOptions,
  guardNavigation = false,
}: ComposerProps = {}) {
  const controller = useComposer(options)

  if (controller.hydration.status === 'hydrating') {
    return (
      <section
        className="composer-hydration"
        id="composer-main"
        aria-label="Studio"
        aria-busy="true"
        tabIndex={-1}
      >
        <p role="status">Restoring your project...</p>
      </section>
    )
  }

  if (
    controller.hydration.status === 'ready-without-project' ||
    controller.hydration.status === 'restore-error'
  ) {
    return <StartCenter controller={controller} />
  }

  return (
    <ComposerWorkspace
      controller={controller}
      assistantOptions={assistantOptions}
      collab={collab}
      collabProviderFactory={collabProviderFactory}
      canShare={canShare}
      aiStudioOptions={aiStudioOptions}
      guardNavigation={guardNavigation}
    />
  )
}

interface ComposerWorkspaceProps {
  controller: ComposerController
  assistantOptions?: UseAssistantOptions
  collab: CollabConfig | null
  collabProviderFactory?: CollabProviderFactory
  canShare: boolean
  aiStudioOptions?: UseAiStudioOptions
  guardNavigation: boolean
}

function ComposerWorkspace({
  controller,
  assistantOptions,
  collab,
  collabProviderFactory,
  canShare,
  aiStudioOptions,
  guardNavigation,
}: ComposerWorkspaceProps) {
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false)
  const assistant = useAssistant(controller, assistantOptions)
  const resolvedEntitlements = useAiStudioEntitlements()
  const aiStudio = useAiStudio(controller, {
    entitlements: aiStudioOptions?.entitlements ?? resolvedEntitlements,
  })
  const plugins = usePlugins(controller)
  const mixer = useMixer(controller)
  const panels = usePanelLayout()
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

  // Publish the single live session's status through the contract-owned context so
  // feature panels can read it via useCollaborationStatus() without opening a second
  // useCollaboration() session (which would duplicate the relay/awareness connection).
  const collaborationStatus = selectCollaborationStatus(collaboration, {
    role: collab?.role ?? 'owner',
    canShare,
  })

  return (
    <CollaborationStatusContext.Provider value={collaborationStatus}>
    {guardNavigation ? <StudioNavigationGuard controller={controller} /> : null}
    <section className="composer" aria-label="Composer" id="composer-main" tabIndex={-1}>
      <div className="composer-topbar">
        <ProjectToolbar
          controller={controller}
          onNewProject={() => setProjectBrowserOpen(true)}
          onOpenProject={() => setProjectBrowserOpen(true)}
        />
        <MidiControls controller={controller} />
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
          <button
            type="button"
            className="btn btn-primary"
            data-interaction="studio.empty.load-demo"
            onClick={loadDemo}
          >
            Load a demo pattern
          </button>
        </div>
      )}

      <div className="composer-body">
        <aside className="composer-sidebar" aria-label="Panels">
          <CollapsiblePanel
            id="tracks"
            title="Tracks"
            open={panels.isOpen('tracks')}
            onToggle={panels.toggle}
          >
            <TrackPanel controller={controller} />
          </CollapsiblePanel>
          <CollapsiblePanel
            id="assistant"
            title="AI Assistant"
            open={panels.isOpen('assistant')}
            onToggle={panels.toggle}
          >
            <AssistantPanel assistant={assistant} />
          </CollapsiblePanel>
          <CollapsiblePanel
            id="aiStudio"
            title="AI Studio"
            open={panels.isOpen('aiStudio')}
            onToggle={panels.toggle}
          >
            <AiStudioPanel studio={aiStudio} />
          </CollapsiblePanel>
          <CollapsiblePanel
            id="mixer"
            title="Mixer"
            open={panels.isOpen('mixer')}
            onToggle={panels.toggle}
          >
            <MixerPanel mixer={mixer} />
          </CollapsiblePanel>
          <CollapsiblePanel
            id="extensions"
            title="Extensions"
            open={panels.isOpen('extensions')}
            onToggle={panels.toggle}
          >
            <PluginsPanel plugins={plugins} />
          </CollapsiblePanel>
          {plugins.visiblePanels.map((panel) => (
            <section key={panel.id} className="plugin-surface" aria-label={panel.title}>
              {panel.render(plugins.panelContext)}
            </section>
          ))}
        </aside>
        <PianoRoll controller={controller} previewNotes={assistant.previewNotes} />
      </div>

      {!audioReady && (
        <p className="audio-note" role="note">
          Audio output isn’t available in this environment — editing, saving, and MIDI export
          still work.
        </p>
      )}
    </section>
    <ProjectBrowser
      controller={controller}
      open={projectBrowserOpen}
      onOpenChange={setProjectBrowserOpen}
    />
    <ProjectReplacementDialog
      controller={controller}
      onReplaced={() => setProjectBrowserOpen(false)}
    />
    <OnboardingTour />
    </CollaborationStatusContext.Provider>
  )
}
