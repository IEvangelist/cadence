import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
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
import { TrackRail } from './components/TrackRail'
import { TrackInspector } from './components/TrackInspector'
import { ShortcutHelpDialog } from './components/ShortcutHelpDialog'
import { EditorDetailLane } from './components/EditorDetailLane'
import { AiInspector } from './components/AiInspector'
import { MixWorkspace } from './components/MixWorkspace'
import { PluginToolHost } from './components/PluginToolHost'
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
import { ContextualCoachMark } from '../mobile/ContextualCoachMark'
import { MobileHelpSheet } from '../mobile/MobileHelpSheet'
import { MobileNoteControls } from '../mobile/MobileNoteControls'
import { MobileTaskNavigator } from '../mobile/MobileTaskNavigator'
import { MobileTaskSheets } from '../mobile/MobileTaskSheets'
import { SelectedNoteEditorSheet } from '../mobile/SelectedNoteEditorSheet'
import {
  createDefaultCoachMarkStorage,
  markCoachMarkSeen,
  nextCoachMark,
  readSeenCoachMarks,
  type CoachMarkId,
} from '../mobile/coachMarks'
import {
  initialMobileTaskState,
  mobileTaskReducer,
  type MobileTaskId,
} from '../mobile/mobileTaskModel'
import { useMobileStudioLayout } from '../mobile/useMobileStudioLayout'
import {
  StudioCommandProvider,
  StudioFrame,
  StudioInspectorPanels,
  type StudioView,
} from '../studio'
import { useStudioCommandDispatcher } from './commands/useStudioCommandDispatcher'
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsTriggerRef = useRef<HTMLButtonElement>(null)
  const shortcutsReturnFocusRef = useRef<HTMLElement | null>(null)
  const [detailLane, setDetailLane] = useState('velocity')
  const mobileLayout = useMobileStudioLayout()
  const [mobileState, dispatchMobile] = useReducer(
    mobileTaskReducer,
    initialMobileTaskState,
  )
  const coachStorage = useMemo(() => createDefaultCoachMarkStorage(), [])
  const [seenCoachMarks, setSeenCoachMarks] = useState<Set<CoachMarkId>>(() =>
    readSeenCoachMarks(coachStorage),
  )
  const openShortcuts = useCallback((): void => {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const isStableInvoker =
      activeElement !== null &&
      activeElement.isConnected &&
      activeElement !== document.body &&
      activeElement !== document.documentElement &&
      activeElement.matches(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])',
      ) &&
      activeElement.closest('[inert]') === null
    shortcutsReturnFocusRef.current = isStableInvoker
      ? activeElement
      : shortcutsTriggerRef.current
    setShortcutsOpen(true)
  }, [])
  const { project, audioReady, loadDemo } = controller
  const isEmpty = project.tracks.every((track) => track.notes.length === 0)

  const collaboration = useCollaboration(
    {
      project,
      selectedTrackId: controller.selectedTrackId,
      selectedNoteIds: controller.state.selectedNoteIds,
      applyRemoteProject: controller.applyRemoteProject,
      historyCaptureGroup: controller.historyCaptureGroup,
      historyCaptureBoundary: controller.historyCaptureBoundary,
      subscribeProjectTransitions: controller.subscribeProjectTransitions,
    },
    collab,
    collabProviderFactory,
  )
  const setHistoryEnabled = controller.setHistoryEnabled
  useEffect(() => {
    setHistoryEnabled(!collaboration.active)
  }, [collaboration.active, setHistoryEnabled])
  const history = collaboration.active ? collaboration : controller
  const commandActions = useMemo(
    () => ({
      isPlaying: controller.transportState === 'playing',
      togglePlay: controller.togglePlay,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undo: history.undo,
      redo: history.redo,
      openHelp: openShortcuts,
    }),
    [
      controller.togglePlay,
      controller.transportState,
      history.canRedo,
      history.canUndo,
      history.redo,
      history.undo,
      openShortcuts,
    ],
  )
  const commands = useStudioCommandDispatcher(commandActions, plugins)
  const editControls = (
    <div className="composer-edit-actions" aria-label="Edit commands">
      <button
        type="button"
        className="btn btn-sm"
        data-interaction="studio.history.undo"
        aria-keyshortcuts="Control+Z Meta+Z"
        disabled={!history.canUndo}
        onClick={history.undo}
        aria-label="Undo"
        title="Undo"
      >
        ↶
      </button>
      <button
        type="button"
        className="btn btn-sm"
        data-interaction="studio.history.redo"
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        disabled={!history.canRedo}
        onClick={history.redo}
        aria-label="Redo"
        title="Redo"
      >
        ↷
      </button>
      <button
        ref={shortcutsTriggerRef}
        type="button"
        className="btn btn-sm"
        data-interaction="studio.shortcuts.open"
        aria-keyshortcuts="?"
        onClick={openShortcuts}
        aria-label="Shortcuts"
        title="Keyboard shortcuts"
      >
        ?
      </button>
    </div>
  )
  const selectedNote = project.tracks
    .find((track) => track.id === controller.selectedTrackId)
    ?.notes.find((note) => controller.state.selectedNoteIds.includes(note.id))

  // Publish the single live session's status through the contract-owned context so
  // feature panels can read it via useCollaborationStatus() without opening a second
  // useCollaboration() session (which would duplicate the relay/awareness connection).
  const collaborationStatus = selectCollaborationStatus(collaboration, {
    role: collab?.role ?? 'owner',
    canShare,
  })
  const collaborationControls = (
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
  )

  const inspectorPanels = [
    {
      id: 'track',
      label: 'Track',
      content: <TrackInspector controller={controller} />,
    },
    {
      id: 'ai',
      label: 'AI',
      content: <AiInspector assistant={assistant} studio={aiStudio} />,
    },
    {
      id: 'extensions',
      label: 'Extensions',
      content: (
        <>
          <PluginsPanel plugins={plugins} />
          <PluginToolHost panels={plugins.visiblePanels} context={plugins.panelContext} />
        </>
      ),
    },
  ]

  const mixTrackById = new Map(mixer.tracks.map((track) => [track.id, track]))
  const compactRail = (
    <TrackRail
      controller={controller}
      renderTrailing={(track) => {
        const mixTrack = mixTrackById.get(track.id)
        const solo = mixTrack?.solo ?? false
        return (
          <button
            type="button"
            className={`btn btn-sm${solo ? ' is-active' : ''}`}
            data-interaction="studio.track.solo"
            aria-pressed={solo}
            aria-label={`${solo ? 'Unsolo' : 'Solo'} ${track.name}`}
            onClick={() => mixer.toggleSolo(track.id)}
          >
            S
          </button>
        )
      }}
    />
  )

  const mobileCoach = (task: MobileTaskId) => (
    <ContextualCoachMark
      mark={mobileLayout ? nextCoachMark(task, seenCoachMarks) : null}
      onDismiss={(id) =>
        setSeenCoachMarks((seen) =>
          markCoachMarkSeen(coachStorage, seen, id),
        )
      }
    />
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
      <div className="composer-editor-commandbar">{editControls}</div>
      <div className="composer-editor-stack">
        {mobileLayout ? (
          <MobileNoteControls
            mode={mobileState.noteMode}
            hasSelection={Boolean(selectedNote)}
            onModeChange={(mode) => dispatchMobile({ type: 'set-note-mode', mode })}
            onEditSelection={() => {
              if (!selectedNote) return
              dispatchMobile({ type: 'select-note', noteId: selectedNote.id })
              dispatchMobile({ type: 'open-selected-note' })
            }}
          />
        ) : null}
        {mobileCoach('notes')}
        <PianoRoll
          controller={controller}
          previewNotes={assistant.previewNotes}
          mobileNoteMode={mobileLayout ? mobileState.noteMode : undefined}
        />
        <EditorDetailLane
          activeId={detailLane}
          onChange={setDetailLane}
          items={[
            {
              id: 'velocity',
              label: 'Velocity',
              content: (
                <p className="editor-detail-lane__status" role="status">
                  {selectedNote
                    ? `Selected note velocity: ${Math.round(selectedNote.velocity * 127)}`
                    : 'Select a note to edit its velocity.'}
                </p>
              ),
            },
            {
              id: 'automation',
              label: 'Automation',
              content: null,
              disabled: true,
            },
          ]}
        />
      </div>
      {!audioReady && (
        <p className="audio-note" role="note">
          Audio output isn’t available in this environment - editing, saving, and MIDI
          export still work.
        </p>
      )}
    </div>
  )

  const mobileProject = (
    <div className="mobile-studio__stack">
      {mobileCoach('project')}
      <ProjectToolbar
        controller={controller}
        onNewProject={() => setProjectBrowserOpen(true)}
        onOpenProject={() => setProjectBrowserOpen(true)}
      />
      {collaborationControls}
    </div>
  )
  const mobileTracks = (
    <div className="mobile-studio__stack">
      {mobileCoach('tracks')}
      {compactRail}
      <TrackInspector controller={controller} />
    </div>
  )
  const mobileTools = (
    <div className="mobile-studio__stack">
      {mobileCoach('tools')}
      <div className="mobile-studio__view-switch" role="group" aria-label="Workspace view">
        <button
          type="button"
          className="mobile-secondary-button"
          data-interaction="studio.view.write"
          aria-pressed={view === 'write'}
          onClick={() => setView('write')}
        >
          Write
        </button>
        <button
          type="button"
          className="mobile-secondary-button"
          data-interaction="studio.view.mix"
          aria-pressed={view === 'mix'}
          onClick={() => setView('mix')}
        >
          Mix
        </button>
      </div>
      <AiInspector assistant={assistant} studio={aiStudio} />
      <MidiControls controller={controller} />
      <PluginsPanel plugins={plugins} />
      <PluginToolHost panels={plugins.visiblePanels} context={plugins.panelContext} />
      {utilityControls ? (
        <div className="mobile-studio__utilities">{utilityControls}</div>
      ) : null}
    </div>
  )

  const openMobileTask = (task: MobileTaskId) => {
    if (task === 'notes') {
      setView('write')
      dispatchMobile({ type: 'open-task', task })
      dispatchMobile({ type: 'close-sheet' })
      return
    }
    dispatchMobile({ type: 'open-task', task })
  }

  const workspace = mobileLayout ? (
    <section
      className="mobile-studio"
      id="composer-main"
      aria-label="Composer"
      tabIndex={-1}
      data-mobile-studio
    >
      <header className="mobile-studio__transport" aria-label="Persistent transport">
        <TransportBar controller={controller} />
      </header>
      <div className="mobile-studio__workspace">
        {view === 'mix' ? <MixWorkspace mixer={mixer} /> : writeSurface}
      </div>
      <MobileTaskNavigator
        state={mobileState}
        onOpenTask={openMobileTask}
        onOpenHelp={() => dispatchMobile({ type: 'open-help' })}
      />
      <MobileTaskSheets
        openSheet={mobileState.openSheet}
        onClose={() => dispatchMobile({ type: 'close-sheet' })}
        content={{
          project: mobileProject,
          tracks: mobileTracks,
          notes: writeSurface,
          tools: mobileTools,
        }}
      />
      <SelectedNoteEditorSheet
        open={mobileState.openSheet === 'selected-note'}
        note={selectedNote ?? null}
        onClose={() => dispatchMobile({ type: 'close-sheet' })}
        onChange={(changes) => {
          if (selectedNote) {
            controller.updateNote(
              controller.selectedTrackId,
              selectedNote.id,
              changes,
            )
          }
        }}
        onDelete={() => {
          if (selectedNote) {
            controller.removeNote(controller.selectedTrackId, selectedNote.id)
            dispatchMobile({ type: 'clear-note-selection' })
          }
        }}
      />
      <MobileHelpSheet
        open={mobileState.openSheet === 'help'}
        onClose={() => dispatchMobile({ type: 'close-sheet' })}
      />
    </section>
  ) : (
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
      mix={<MixWorkspace mixer={mixer} />}
      inspector={
        <StudioInspectorPanels
          panels={inspectorPanels}
          activePanel={activeInspector}
          onPanelChange={setActiveInspector}
        />
      }
      collaborationControls={collaborationControls}
      utilityControls={utilityControls}
      view={view}
      onViewChange={setView}
      railOpen={!panels.railCollapsed}
      onRailToggle={panels.toggleRail}
      inspectorOpen={inspectorOpen}
      onInspectorToggle={() => setInspectorOpen((open) => !open)}
    />
  )

  return (
    <CollaborationStatusContext.Provider value={collaborationStatus}>
    {guardNavigation ? <StudioNavigationGuard controller={controller} /> : null}
    <StudioCommandProvider
      isPlaying={controller.transportState === 'playing'}
      togglePlay={controller.togglePlay}
    >
      {workspace}
      <ShortcutHelpDialog
        open={shortcutsOpen}
        registry={commands}
        onClose={() => setShortcutsOpen(false)}
        returnFocusRef={shortcutsReturnFocusRef}
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
    {!mobileLayout ? <OnboardingTour /> : null}
    </CollaborationStatusContext.Provider>
  )
}
