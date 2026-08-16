/**
 * CollabSession — binds a Yjs document + awareness to the composer's project
 * model. It is deliberately transport-agnostic: it owns no WebSocket, only the
 * shared {@link Y.Doc} and {@link Awareness}. A network provider (y-websocket)
 * is wired in by {@link useCollaboration}; unit tests drive it with two docs and
 * an in-memory relay. This keeps the convergence/sanitize/presence logic pure
 * and fully testable without Web Audio or sockets.
 */
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { Project } from './../project'
import {
  LOCAL_ORIGIN,
  getProjectMap,
  isProjectDocEmpty,
  readProject,
  reconcileDoc,
  seedProjectDoc,
} from './crdt'

const REPLACEMENT_ORIGIN = Symbol('cadence-collab-replacement')

/** A collaborator identity surfaced in the presence UI. */
export interface CollabUser {
  id: string
  name: string
  color: string
}

/** A collaborator's live caret: which track and notes they have selected. */
export interface CollabCursor {
  trackId: string | null
  selectedNoteIds: string[]
}

/** One entry in the presence roster (including self). */
export interface CollabPresence {
  clientId: number
  user: CollabUser
  cursor: CollabCursor | null
  isSelf: boolean
}

export interface CollabSessionOptions {
  doc: Y.Doc
  awareness: Awareness
  user: CollabUser
  /**
   * Whether this client may mutate the shared doc. Viewers get `false`: their
   * {@link CollabSession.pushLocalProject} is a no-op so the client never emits
   * write frames. This is defense-in-depth only — the relay independently
   * rejects viewer writes server-side.
   */
  canWrite: boolean
  /** Called whenever the doc converges to a new project (already sanitized). */
  onRemoteProject: (project: Project) => void
  /** Seed the shared doc from this project when it is still empty. */
  initialProject?: Project
}

export interface CollabSession {
  /** The origin symbol stamped on this session's local writes. */
  readonly localOrigin: symbol
  /** Reconcile the shared doc to `project` (echo-safe; no-op for viewers). */
  pushLocalProject: (project: Project) => void
  /** Replace the shared project without making the replacement itself undoable. */
  replaceLocalProject: (project: Project) => void
  /**
   * Seed the shared doc from `project` only if it is still empty. Used by the
   * networked hook after the initial sync so exactly one client (the one that
   * finds an empty server doc) seeds and late joiners adopt the shared project
   * instead of duplicating it. No-op for viewers or an already-seeded doc.
   */
  seedIfEmpty: (project: Project) => void
  /** Publish this client's caret via awareness. */
  setLocalCursor: (cursor: CollabCursor | null) => void
  /** Re-broadcast local awareness state (used after a peer connects). */
  announce: () => void
  /** Current presence roster snapshot. */
  presence: () => CollabPresence[]
  /** Subscribe to roster changes. Returns an unsubscribe. */
  onPresenceChange: (listener: (present: CollabPresence[]) => void) => () => void

  /**
   * Create the collaborative undo/redo stack (#156): a `Y.UndoManager` scoped
   * to this doc's project root, tracking only `LOCAL_ORIGIN` transactions (so
   * remote peers' edits are never undone by this client). Callers MUST invoke
   * this only AFTER the initial seed/adoption has happened — content written
   * to the scope before the manager exists is not tracked, which is exactly
   * how "seeding/adopting the shared project must not itself be undoable" is
   * satisfied, with no extra guard logic required. No-op for viewers (who
   * never write, so there is nothing of theirs to undo) and idempotent if
   * already enabled.
   */
  enableUndo: () => void
  /**
   * Undo this client's most recent tracked local edit. No-op for viewers or
   * before {@link enableUndo} has been called (or once its stack is empty).
   */
  undo: () => void
  /** Redo the most recently undone local edit. Same no-op conditions as {@link undo}. */
  redo: () => void
  /** Whether there is a local edit available to undo. Always `false` for viewers. */
  canUndo: () => boolean
  /** Whether there is an undone local edit available to redo. Always `false` for viewers. */
  canRedo: () => boolean
  /**
   * Force the NEXT local edit to start a fresh undo entry rather than merging
   * with whatever was just captured — the collaborative counterpart of
   * `history.ts`'s `stopCapturing`, for callers that want an explicit boundary
   * between a continuous gesture (pointer drag / slider) and the discrete
   * command that follows it, instead of relying solely on the undo manager's
   * own capture-timeout window. No-op before {@link enableUndo} or for viewers.
   */
  stopCapturing: () => void
  /**
   * Subscribe to undo/redo stack changes (used to mirror `canUndo`/`canRedo`
   * into React state). Invoked once immediately with the current snapshot,
   * like {@link onPresenceChange}. Returns an unsubscribe.
   */
  onUndoStackChange: (listener: () => void) => () => void
  /** Tear down observers, the undo manager, and clear local awareness. */
  destroy: () => void
}

function readPresence(awareness: Awareness): CollabPresence[] {
  const present: CollabPresence[] = []
  awareness.getStates().forEach((state, clientId) => {
    const user = state.user as CollabUser | undefined
    if (!user) return
    present.push({
      clientId,
      user,
      cursor: (state.cursor as CollabCursor | undefined) ?? null,
      isSelf: clientId === awareness.clientID,
    })
  })
  return present
}

export function createCollabSession(options: CollabSessionOptions): CollabSession {
  const { doc, awareness, user, canWrite, onRemoteProject, initialProject } = options

  const presenceListeners = new Set<(present: CollabPresence[]) => void>()
  const undoStackListeners = new Set<() => void>()
  // Created lazily by `enableUndo` — never automatically, so seeding/adopting
  // the shared project ahead of it is never itself undoable (see the
  // `enableUndo` doc comment on the interface above).
  let undoManager: Y.UndoManager | undefined

  // Seed only when we may write and the doc is empty; a late viewer/editor that
  // joins an existing doc must not clobber it.
  if (canWrite && initialProject && isProjectDocEmpty(doc)) {
    seedProjectDoc(doc, initialProject)
  }

  const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
    // Ignore our own writes; everything else is a converged remote change.
    // This also covers this client's OWN undo/redo transactions: `Y.UndoManager`
    // stamps those with itself (not `LOCAL_ORIGIN`) as the origin, so an undo
    // naturally falls through to `onRemoteProject` — the same path a genuine
    // remote peer's edit takes — with no extra wiring required.
    if (origin === LOCAL_ORIGIN) return
    onRemoteProject(readProject(doc))
  }
  doc.on('update', handleDocUpdate)

  const emitPresence = () => {
    const snapshot = readPresence(awareness)
    presenceListeners.forEach((listener) => listener(snapshot))
  }
  const handleAwareness = () => emitPresence()
  awareness.on('change', handleAwareness)

  awareness.setLocalStateField('user', user)

  const notifyUndoStack = () => undoStackListeners.forEach((listener) => listener())

  return {
    localOrigin: LOCAL_ORIGIN,
    pushLocalProject(project: Project) {
      if (!canWrite) return
      reconcileDoc(doc, project, LOCAL_ORIGIN)
    },
    replaceLocalProject(project: Project) {
      if (!canWrite) return
      undoManager?.clear()
      undoManager?.stopCapturing()
      reconcileDoc(doc, project, REPLACEMENT_ORIGIN)
    },
    seedIfEmpty(project: Project) {
      if (!canWrite) return
      if (isProjectDocEmpty(doc)) seedProjectDoc(doc, project)
    },
    setLocalCursor(cursor: CollabCursor | null) {
      awareness.setLocalStateField('cursor', cursor)
    },
    announce() {
      awareness.setLocalStateField('user', user)
      emitPresence()
    },
    presence() {
      return readPresence(awareness)
    },
    onPresenceChange(listener) {
      presenceListeners.add(listener)
      listener(readPresence(awareness))
      return () => presenceListeners.delete(listener)
    },
    enableUndo() {
      if (!canWrite || undoManager) return
      undoManager = new Y.UndoManager(getProjectMap(doc), {
        trackedOrigins: new Set([LOCAL_ORIGIN]),
      })
      undoManager.on('stack-item-added', notifyUndoStack)
      undoManager.on('stack-item-popped', notifyUndoStack)
      undoManager.on('stack-cleared', notifyUndoStack)
      notifyUndoStack()
    },
    undo() {
      undoManager?.undo()
    },
    redo() {
      undoManager?.redo()
    },
    canUndo() {
      return undoManager?.canUndo() ?? false
    },
    canRedo() {
      return undoManager?.canRedo() ?? false
    },
    stopCapturing() {
      undoManager?.stopCapturing()
    },
    onUndoStackChange(listener) {
      undoStackListeners.add(listener)
      listener()
      return () => undoStackListeners.delete(listener)
    },
    destroy() {
      doc.off('update', handleDocUpdate)
      awareness.off('change', handleAwareness)
      presenceListeners.clear()
      undoStackListeners.clear()
      undoManager?.destroy()
      undoManager = undefined
      // Removing our awareness entry signals "left" to peers.
      awareness.setLocalState(null)
    },
  }
}
