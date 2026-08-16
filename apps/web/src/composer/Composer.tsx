import { type ReactNode, useState } from 'react'
import { appName, tagline } from '../appInfo'
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
import {
  StudioCommandProvider,
  StudioFrame,
  StudioInspectorPanels,
  type StudioView,
} from '../studio'
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
  /** Account, help, and theme controls composed after the editor in focus order. */
  utilityControls?: ReactNode
}

function StudioIdentity({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`studio-identity${compact ? ' studio-identity--compact' : ''}`}>
      <img className="studio-identity__mark" src="/favicon.svg" alt="" aria-hidden="true" />
      <div>
        <h1>{appName}</h1>
        <p className="studio-identity__tagline">{tagline}</p>
      </div>
    </div>
  )
}

function StudioEntryShell({
  children,
  utilityControls,
}: {
  children: ReactNode
  utilityControls?: ReactNode
}) {
  return (
    <section className="studio-entry">
      <header className="studio-entry__header">
        <StudioIdentity />
        {utilityControls ? (
          <div className="studio-entry__utilities">{utilityControls}</div>
        ) : null}
      </header>
      <div className="studio-entry__content">{children}</div>
    </section>
  )
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
  utilityControls,
}: ComposerProps = {}) {
  const controller = useComposer(options)

  if (controller.hydration.status === 'hydrating') {
    return <StudioEntryShell utilityControls={utilityControls}>
      <section
        className="composer-hydration"
        id="composer-main"
        aria-label="Studio"
        aria-busy="true"
        tabIndex={-1}
      >
        <p role="status">Restoring your project...</p>
      </section>
    </StudioEntryShell>
  }

  if (
    controller.hydration.status === 'ready-without-project' ||
    controller.hydration.status === 'restore-error'
  ) {
    return (
      <StudioEntryShell utilityControls={utilityControls}>
        <StartCenter controller={controller} />
      </StudioEntryShell>
    )
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
      utilityControls={utilityControls}
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
  utilityControls?: ReactNode
}

function ComposerWorkspace({
  controller,
  assistantOptions,
  collab,
  collabProviderFactory,
  canShare,
  aiStudioOptions,
  guardNavigation,
  utilityControls,
}: ComposerWorkspaceProps) {
  const [projectBrowserOpen, setProjectBrowserOpen] = useState(false)
  const [view, setView] = useState<StudioView>('write')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [activeInspector, setActiveInspector] = useState('track')
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

  const inspectorPanels = [
    {
      id: 'track',
      label: 'Track',
      content: <TrackPanel controller={controller} />,
    },
    {
      id: 'assistant',
      label: 'Assistant',
      content: <AssistantPanel assistant={assistant} />,
    },
    {
      id: 'aiStudio',
      label: 'AI Studio',
      content: <AiStudioPanel studio={aiStudio} />,
    },
    {
      id: 'extensions',
      label: 'Extensions',
      content: (
        <>
          <PluginsPanel plugins={plugins} />
          {plugins.visiblePanels.map((panel) => (
            <section key={panel.id} className="plugin-surface" aria-label={panel.title}>
              {panel.render(plugins.panelContext)}
            </section>
          ))}
        </>
      ),
    },
  ]

  const compactRail = (
    <section className="studio-track-rail" aria-label="Tracks">
      <header className="studio-track-rail__header">
        <h2>Tracks</h2>
        <span>{project.tracks.length}</span>
      </header>
      <ul className="studio-track-rail__list">
        {project.tracks.map((track) => {
          const selected = track.id === controller.selectedTrackId
          return (
            <li key={track.id}>
              <button
                type="button"
                className={`studio-track-rail__track${selected ? ' is-selected' : ''}`}
                data-interaction="studio.track.select"
                aria-pressed={selected}
                onClick={() => controller.selectTrack(track.id)}
              >
                <span
                  className="studio-track-rail__swatch"
                  style={{ backgroundColor: track.color }}
                  aria-hidden="true"
                />
                <span>{track.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )

  const writeSurface = (
    <div className="studio-write-surface">
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
      <PianoRoll controller={controller} previewNotes={assistant.previewNotes} />
      {!audioReady && (
        <p className="audio-note" role="note">
          Audio output isn’t available in this environment - editing, saving, and MIDI
          export still work.
        </p>
      )}
    </div>
  )

  return (
    <CollaborationStatusContext.Provider value={collaborationStatus}>
    {guardNavigation ? <StudioNavigationGuard controller={controller} /> : null}
    <StudioCommandProvider
      isPlaying={controller.transportState === 'playing'}
      togglePlay={controller.togglePlay}
    >
      <StudioFrame
        projectControls={
          <div className="studio-project-cluster">
            <StudioIdentity compact />
            <ProjectToolbar
              controller={controller}
              onNewProject={() => setProjectBrowserOpen(true)}
              onOpenProject={() => setProjectBrowserOpen(true)}
            />
          </div>
        }
        transportControls={
          <div className="studio-persistent-transport">
            <TransportBar controller={controller} />
            <MidiControls controller={controller} />
          </div>
        }
        rail={compactRail}
        editor={writeSurface}
        mix={<div className="studio-mix-surface"><MixerPanel mixer={mixer} /></div>}
        inspector={
          <StudioInspectorPanels
            panels={inspectorPanels}
            activePanel={activeInspector}
            onPanelChange={setActiveInspector}
          />
        }
        collaborationControls={
          <>
            {collaboration.active && (
              <PresenceBar
                presence={collaboration.presence}
                connected={collaboration.connected}
                canWrite={collaboration.canWrite}
                resolveTrackName={(id) => project.tracks.find((t) => t.id === id)?.name}
              />
            )}
            {canShare && <ShareProjectButton projectId={project.id} />}
          </>
        }
        utilityControls={utilityControls}
        view={view}
        onViewChange={setView}
        railOpen={!panels.railCollapsed}
        onRailToggle={panels.toggleRail}
        inspectorOpen={inspectorOpen}
        onInspectorToggle={() => setInspectorOpen((open) => !open)}
      />
    </StudioCommandProvider>
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
