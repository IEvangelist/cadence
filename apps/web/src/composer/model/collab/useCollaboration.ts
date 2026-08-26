/**
 * useCollaboration — React glue binding a {@link CollabBinding} (a slice of the
 * composer controller) to a {@link CollabSession} over a network provider.
 *
 * Collaboration is strictly opt-in: when `config` is `null` the hook is inert
 * and never opens a socket, so the entire single-user experience — and every
 * existing test — is unchanged. When a config is supplied (from a share link)
 * it connects, mirrors local edits into the shared Yjs doc, applies converged
 * remote edits back through the controller, and surfaces the presence roster.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { Project } from './../project'
import type { ProjectTransition } from '../../hooks/useComposer'
import {
  type CollabPresence,
  type CollabUser,
  createCollabSession,
} from './collabSession'
import { isProjectDocEmpty } from './crdt'
import { createWebsocketProvider } from './websocketProvider'

/** Server-authoritative role attached to a share link. */
export type CollaborationRole = 'owner' | 'editor' | 'viewer'

/** Everything needed to join a collaborative session, parsed from a share link. */
export interface CollabConfig {
  projectId: string
  /** Stable owner identity used by the relay to scope this collaboration room. */
  roomOwnerId: string
  /**
   * True only after the server has confirmed the current authenticated user.
   * Cached offline identity may hydrate local CRDT state but never enables a
   * relay connection or server mutation.
   */
  networkEnabled: boolean
  role: CollaborationRole
  user: CollabUser
  /** WebSocket relay base URL (e.g. `ws://host/api/collab`). */
  url: string
  /** Opaque share token proving access; the relay validates it server-side. */
  token?: string
  /**
   * Matching owner/project/grant serialized recovery. Used exactly once only
   * when IndexedDB initialization fails, before any relay connection.
   */
  loadSerializedBackup?: () => Promise<Project | null>
}

/** Network transport abstraction so the hook is unit-testable without sockets. */
export interface CollabProvider {
  doc: Y.Doc
  awareness: Awareness
  destroy: () => void
  /** Optional connection-status stream; returns an unsubscribe. */
  onStatus?: (listener: (connected: boolean) => void) => () => void
  /**
   * Optional initial-sync signal; fires once the provider has synchronised with
   * the relay. Its presence tells the hook to defer seeding until after sync so
   * only the first client seeds. Returns an unsubscribe.
   */
  onSynced?: (listener: () => void) => () => void
  /**
   * Optional local CRDT persistence signal. The hook never seeds from the
   * serialized project until this fires, so a persisted Y.Doc wins over a stale
   * localStorage snapshot.
   */
  onPersistenceSynced?: (listener: () => void) => () => void
  /** Optional nonfatal local-persistence lifecycle stream. */
  onPersistenceStatus?: (
    listener: (status: OfflinePersistenceStatus) => void,
  ) => () => void
  /** Full serialized recovery overlay (including non-CRDT mix/automation). */
  onSerializedBackupRecovered?: (
    listener: (project: Project) => void,
  ) => () => void
}

export type CollabProviderFactory = (config: CollabConfig) => CollabProvider

/** The minimal controller surface the hook drives (keeps it decoupled). */
export interface CollabBinding {
  project: Project
  selectedTrackId: string
  selectedNoteIds: string[]
  applyRemoteProject: (project: Project) => void
  recoverCollaborationBackup: (project: Project) => void
  /** Optional single-user action classification reused for Yjs capture grouping. */
  historyCaptureGroup?: string | null
  /** Explicit pointer/field boundary; changes seal the current Yjs capture item. */
  historyCaptureBoundary?: number
  /** Per-dispatch local transitions, preventing React batching from merging commands. */
  subscribeProjectTransitions?: (
    listener: (transition: ProjectTransition) => void,
  ) => () => void
}

export interface CollaborationState {
  active: boolean
  connected: boolean
  canWrite: boolean
  offlinePersistence: OfflinePersistenceStatus | 'inactive'
  presence: CollabPresence[]
  /**
   * Collaborative undo/redo (#156): a `Y.UndoManager` scoped to the shared
   * project root, tracking only THIS client's own local edits. Distinct from
   * — and, while collaboration is active, meant to REPLACE — the single-user
   * history on `ComposerController` (see its `setHistoryEnabled`), so a
   * single click never drives both stacks at once. Always `false`/no-op for
   * viewers and before the initial seed/sync completes.
   */
  canUndo: boolean
  canRedo: boolean
  undo: () => void
  redo: () => void
  stopCapturing: () => void
}

export type OfflinePersistenceStatus = 'loading' | 'ready' | 'unavailable'

const INERT: CollaborationState = {
  active: false,
  connected: false,
  canWrite: false,
  offlinePersistence: 'inactive',
  presence: [],
  canUndo: false,
  canRedo: false,
  undo: () => {},
  redo: () => {},
  stopCapturing: () => {},
}

export function useCollaboration(
  binding: CollabBinding,
  config: CollabConfig | null,
  providerFactory: CollabProviderFactory = createWebsocketProvider,
): CollaborationState {
  const [presence, setPresence] = useState<CollabPresence[]>([])
  const [connected, setConnected] = useState(false)
  const [offlinePersistence, setOfflinePersistence] =
    useState<CollaborationState['offlinePersistence']>('inactive')
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })

  // Keep a live ref so the connection effect (which must not re-run on every
  // keystroke) always sees the latest controller callbacks/state.
  const bindingRef = useRef(binding)
  useEffect(() => {
    bindingRef.current = binding
  }, [binding])

  const sessionRef = useRef<ReturnType<typeof createCollabSession> | null>(null)
  const lastCaptureGroupRef = useRef<string | null>(null)
  const lastCaptureBoundaryRef = useRef(binding.historyCaptureBoundary ?? 0)
  // Gates the local→doc mirror. A networked joiner must not push its own local
  // project until it has synced and adopted the shared one, or it would seed a
  // duplicate. In-memory/test providers (no onSynced) mirror immediately.
  const mirrorReadyRef = useRef(false)
  const canWrite = config ? config.role !== 'viewer' : false
  const projectId = config?.projectId
  const roomOwnerId = config?.roomOwnerId
  const networkEnabled = config?.networkEnabled
  const role = config?.role
  const url = config?.url
  const token = config?.token
  const userId = config?.user.id
  const userName = config?.user.name
  const userColor = config?.user.color
  const loadSerializedBackup = config?.loadSerializedBackup
  const subscribeProjectTransitions = binding.subscribeProjectTransitions

  const pushTransition = useCallback(
    (
      session: ReturnType<typeof createCollabSession>,
      transition: ProjectTransition,
    ) => {
      if (transition.boundary !== lastCaptureBoundaryRef.current) {
        session.stopCapturing()
        lastCaptureBoundaryRef.current = transition.boundary
        lastCaptureGroupRef.current = null
      }
      if (transition.kind === 'replacement') {
        session.replaceLocalProject(transition.project)
        session.stopCapturing()
        lastCaptureGroupRef.current = null
        return
      }
      if (!transition.group || transition.group !== lastCaptureGroupRef.current) {
        session.stopCapturing()
      }
      session.pushLocalProject(transition.project)
      if (!transition.group) session.stopCapturing()
      lastCaptureGroupRef.current = transition.group
    },
    [],
  )

  // Reset happens via the previous run's cleanup; the hook returns INERT while
  // config is null, so no state writes are needed here (and none should run
  // synchronously inside the effect).
  useEffect(() => {
    if (
      !projectId ||
      !roomOwnerId ||
      networkEnabled == null ||
      !role ||
      !url ||
      userId == null ||
      userName == null ||
      userColor == null
    ) {
      return
    }
    const activeConfig: CollabConfig = {
      projectId,
      roomOwnerId,
      networkEnabled,
      role,
      url,
      token,
      loadSerializedBackup,
      user: { id: userId, name: userName, color: userColor },
    }
    const provider = providerFactory(activeConfig)
    // Real providers defer until local IndexedDB has hydrated. An empty local
    // Y.Doc additionally waits for the relay, while a non-empty persisted doc is
    // immediately safe for continued offline editing.
    const deferSeed =
      typeof provider.onSynced === 'function' ||
      typeof provider.onPersistenceSynced === 'function'
    mirrorReadyRef.current = !deferSeed
    const session = createCollabSession({
      doc: provider.doc,
      awareness: provider.awareness,
      user: activeConfig.user,
      canWrite: role !== 'viewer',
      initialProject: deferSeed ? undefined : bindingRef.current.project,
      onRemoteProject: (project) => bindingRef.current.applyRemoteProject(project),
    })
    sessionRef.current = session

    const offPresence = session.onPresenceChange(setPresence)
    const offUndoStack = session.onUndoStackChange(() =>
      setUndoState({ canUndo: session.canUndo(), canRedo: session.canRedo() }),
    )
    const offStatus = provider.onStatus?.((isConnected) => setConnected(isConnected))
    const offPersistenceStatus = provider.onPersistenceStatus?.(setOfflinePersistence)
    const offSerializedBackup = provider.onSerializedBackupRecovered?.(
      (project) => bindingRef.current.recoverCollaborationBackup(project),
    )
    const offProjectTransitions = subscribeProjectTransitions?.((transition) => {
      if (!mirrorReadyRef.current) return
      pushTransition(session, transition)
    })
    let persistenceSynced = typeof provider.onPersistenceSynced !== 'function'
    let relaySynced = typeof provider.onSynced !== 'function'
    let initialSyncComplete = false
    const completeInitialSync = () => {
      if (initialSyncComplete || !persistenceSynced) return

      // A hydrated local CRDT is authoritative over serialized localStorage and
      // can keep accepting offline edits before the socket reconnects. Only an
      // empty local CRDT needs the relay's state before it may seed.
      if (isProjectDocEmpty(provider.doc)) {
        if (!relaySynced) return
        session.seedIfEmpty(bindingRef.current.project)
      }

      initialSyncComplete = true
      mirrorReadyRef.current = true
      // The manager is created only after hydration/seed/adoption, so none of
      // those setup transactions become undoable.
      session.enableUndo()
    }
    const offPersistenceSynced = provider.onPersistenceSynced?.(() => {
      persistenceSynced = true
      completeInitialSync()
    })
    const offSynced = provider.onSynced?.(() => {
      relaySynced = true
      completeInitialSync()
    })
    completeInitialSync()
    // Push our starting state so a viewer/late editor immediately sees us.
    session.announce()

    return () => {
      offPresence()
      offUndoStack()
      offStatus?.()
      offPersistenceStatus?.()
      offSerializedBackup?.()
      offProjectTransitions?.()
      offPersistenceSynced?.()
      offSynced?.()
      session.destroy()
      provider.destroy()
      sessionRef.current = null
      mirrorReadyRef.current = false
      lastCaptureGroupRef.current = null
      lastCaptureBoundaryRef.current = bindingRef.current.historyCaptureBoundary ?? 0
      setConnected(false)
      setOfflinePersistence('inactive')
      setUndoState({ canUndo: false, canRedo: false })
    }
  }, [
    projectId,
    roomOwnerId,
    networkEnabled,
    url,
    token,
    role,
    userId,
    userName,
    userColor,
    loadSerializedBackup,
    providerFactory,
    pushTransition,
    subscribeProjectTransitions,
  ])

  // Mirror local project edits into the shared doc (echo-safe; viewers no-op).
  // Skipped until the initial sync so a joiner never duplicates the seed.
  useEffect(() => {
    if (subscribeProjectTransitions) return
    if (!mirrorReadyRef.current) return
    const session = sessionRef.current
    if (!session) return
    pushTransition(session, {
      project: binding.project,
      group: binding.historyCaptureGroup ?? null,
      boundary: binding.historyCaptureBoundary ?? 0,
      kind: 'mutation',
    })
  }, [
    binding.historyCaptureBoundary,
    binding.historyCaptureGroup,
    binding.project,
    pushTransition,
    subscribeProjectTransitions,
  ])

  useEffect(() => {
    const boundary = binding.historyCaptureBoundary ?? 0
    if (boundary === lastCaptureBoundaryRef.current) return
    sessionRef.current?.stopCapturing()
    lastCaptureBoundaryRef.current = boundary
    lastCaptureGroupRef.current = null
  }, [binding.historyCaptureBoundary])

  // Publish caret/selection via awareness for remote cursors.
  useEffect(() => {
    sessionRef.current?.setLocalCursor({
      trackId: binding.selectedTrackId || null,
      selectedNoteIds: binding.selectedNoteIds,
    })
  }, [binding.selectedTrackId, binding.selectedNoteIds])

  const undo = useCallback(() => sessionRef.current?.undo(), [])
  const redo = useCallback(() => sessionRef.current?.redo(), [])
  const stopCapturing = useCallback(() => sessionRef.current?.stopCapturing(), [])

  if (!config) return INERT
  return {
    active: true,
    connected,
    canWrite,
    offlinePersistence,
    presence,
    canUndo: undoState.canUndo,
    canRedo: undoState.canRedo,
    undo,
    redo,
    stopCapturing,
  }
}
