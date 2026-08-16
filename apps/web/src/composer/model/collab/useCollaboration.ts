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
import {
  type CollabPresence,
  type CollabUser,
  createCollabSession,
} from './collabSession'
import { createWebsocketProvider } from './websocketProvider'

/** Server-authoritative role attached to a share link. */
export type CollaborationRole = 'owner' | 'editor' | 'viewer'

/** Everything needed to join a collaborative session, parsed from a share link. */
export interface CollabConfig {
  projectId: string
  role: CollaborationRole
  user: CollabUser
  /** WebSocket relay base URL (e.g. `ws://host/api/collab`). */
  url: string
  /** Opaque share token proving access; the relay validates it server-side. */
  token?: string
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
}

export type CollabProviderFactory = (config: CollabConfig) => CollabProvider

/** The minimal controller surface the hook drives (keeps it decoupled). */
export interface CollabBinding {
  project: Project
  selectedTrackId: string
  selectedNoteIds: string[]
  applyRemoteProject: (project: Project) => void
}

export interface CollaborationState {
  active: boolean
  connected: boolean
  canWrite: boolean
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
}

const INERT: CollaborationState = {
  active: false,
  connected: false,
  canWrite: false,
  presence: [],
  canUndo: false,
  canRedo: false,
  undo: () => {},
  redo: () => {},
}

export function useCollaboration(
  binding: CollabBinding,
  config: CollabConfig | null,
  providerFactory: CollabProviderFactory = createWebsocketProvider,
): CollaborationState {
  const [presence, setPresence] = useState<CollabPresence[]>([])
  const [connected, setConnected] = useState(false)
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false })

  // Keep a live ref so the connection effect (which must not re-run on every
  // keystroke) always sees the latest controller callbacks/state.
  const bindingRef = useRef(binding)
  useEffect(() => {
    bindingRef.current = binding
  }, [binding])

  const sessionRef = useRef<ReturnType<typeof createCollabSession> | null>(null)
  // Gates the local→doc mirror. A networked joiner must not push its own local
  // project until it has synced and adopted the shared one, or it would seed a
  // duplicate. In-memory/test providers (no onSynced) mirror immediately.
  const mirrorReadyRef = useRef(false)
  const canWrite = config ? config.role !== 'viewer' : false
  const projectId = config?.projectId
  const role = config?.role
  const url = config?.url
  const token = config?.token
  const userId = config?.user.id
  const userName = config?.user.name
  const userColor = config?.user.color

  // Reset happens via the previous run's cleanup; the hook returns INERT while
  // config is null, so no state writes are needed here (and none should run
  // synchronously inside the effect).
  useEffect(() => {
    if (
      !projectId ||
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
      role,
      url,
      token,
      user: { id: userId, name: userName, color: userColor },
    }
    const provider = providerFactory(activeConfig)
    // A real network provider seeds after its initial sync (see onSynced below)
    // so only the first client — the one that finds an empty server doc — seeds,
    // and late joiners adopt the shared project instead of duplicating it.
    // In-memory/test providers expose no onSynced and seed synchronously here.
    const deferSeed = typeof provider.onSynced === 'function'
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
    const offSynced = provider.onSynced?.(() => {
      // First client seeds the empty doc; joiners no-op and adopt via sync.
      session.seedIfEmpty(bindingRef.current.project)
      // Now it is safe to mirror subsequent local edits into the shared doc.
      mirrorReadyRef.current = true
      // Enable collaborative undo only now — AFTER the seed/adoption above —
      // so that seeding or adopting the shared project is never itself
      // undoable (#156).
      session.enableUndo()
    })
    if (!deferSeed) {
      // In-memory/test providers seeded synchronously above (no `onSynced`
      // to defer to), so it is already safe to enable undo here.
      session.enableUndo()
    }
    // Push our starting state so a viewer/late editor immediately sees us.
    session.announce()

    return () => {
      offPresence()
      offUndoStack()
      offStatus?.()
      offSynced?.()
      session.destroy()
      provider.destroy()
      sessionRef.current = null
      mirrorReadyRef.current = false
      setConnected(false)
      setUndoState({ canUndo: false, canRedo: false })
    }
  }, [
    projectId,
    url,
    token,
    role,
    userId,
    userName,
    userColor,
    providerFactory,
  ])

  // Mirror local project edits into the shared doc (echo-safe; viewers no-op).
  // Skipped until the initial sync so a joiner never duplicates the seed.
  useEffect(() => {
    if (!mirrorReadyRef.current) return
    sessionRef.current?.pushLocalProject(binding.project)
  }, [binding.project])

  // Publish caret/selection via awareness for remote cursors.
  useEffect(() => {
    sessionRef.current?.setLocalCursor({
      trackId: binding.selectedTrackId || null,
      selectedNoteIds: binding.selectedNoteIds,
    })
  }, [binding.selectedTrackId, binding.selectedNoteIds])

  const undo = useCallback(() => sessionRef.current?.undo(), [])
  const redo = useCallback(() => sessionRef.current?.redo(), [])

  if (!config) return INERT
  return {
    active: true,
    connected,
    canWrite,
    presence,
    canUndo: undoState.canUndo,
    canRedo: undoState.canRedo,
    undo,
    redo,
  }
}
