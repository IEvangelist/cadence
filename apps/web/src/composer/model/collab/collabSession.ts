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
import { LOCAL_ORIGIN, isProjectDocEmpty, readProject, reconcileDoc, seedProjectDoc } from './crdt'

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
  /** Tear down observers and clear local awareness. */
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

  // Seed only when we may write and the doc is empty; a late viewer/editor that
  // joins an existing doc must not clobber it.
  if (canWrite && initialProject && isProjectDocEmpty(doc)) {
    seedProjectDoc(doc, initialProject)
  }

  const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
    // Ignore our own writes; everything else is a converged remote change.
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

  return {
    localOrigin: LOCAL_ORIGIN,
    pushLocalProject(project: Project) {
      if (!canWrite) return
      reconcileDoc(doc, project, LOCAL_ORIGIN)
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
    destroy() {
      doc.off('update', handleDocUpdate)
      awareness.off('change', handleAwareness)
      presenceListeners.clear()
      // Removing our awareness entry signals "left" to peers.
      awareness.setLocalState(null)
    },
  }
}
