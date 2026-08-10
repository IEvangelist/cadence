/**
 * Collaboration contract seam for the single shared live composer session.
 *
 * Implemented by effort #9 with Yjs CRDT + y-websocket. Persistence still flows
 * through the existing ProjectStore seam so offline/local projects keep working.
 *
 * PUBLIC vs INTERNAL: feature efforts (#41/#42/#43/#45) build ONLY against the
 * read-only {@link CollaborationStatus} surface (capability + presence). The
 * provider/session interfaces and the controller's `applyRemoteProject` sync
 * path are INTERNAL #9 plumbing — see {@link ComposerCollaborationInternals}.
 */
import type { Project } from '../model/project'

export type ShareRole = 'owner' | 'editor' | 'viewer'

export interface Participant {
  readonly id: string
  readonly userId?: string
  readonly displayName: string
  readonly color: string
  readonly role: ShareRole
}

export interface PresenceCursor {
  readonly trackId: string | null
  readonly beat: number
  readonly pitch?: number
}

export interface PresenceState {
  readonly self: Participant
  readonly peers: readonly Participant[]
  readonly cursors: Readonly<Record<string, PresenceCursor>>
}

export type PresenceListener = (state: PresenceState) => void
export type ProjectChangeListener = (project: Project) => void

/**
 * INTERNAL — the live provider/session seam that effort #9 implements and wires
 * via `<Composer collabProviderFactory>`. Features MUST NOT depend on these
 * directly; consume {@link CollaborationStatus} instead.
 */
export interface CollaborationSession {
  readonly projectId: string
  readonly role: ShareRole
  readonly connected: boolean
  getPresence(): PresenceState
  subscribePresence(listener: PresenceListener): () => void
  updateCursor(cursor: PresenceCursor): void
  subscribeProject(listener: ProjectChangeListener): () => void
  subscribeConnection(listener: (connected: boolean) => void): () => void
  dispose(): void
}

export interface CollaborationRoomOptions {
  projectId: string
  self: { displayName: string; color: string; userId?: string }
  role?: ShareRole
  signal?: AbortSignal
}

export interface CollaborationProvider {
  readonly id: string
  isEnabled(): boolean
  connect(options: CollaborationRoomOptions): Promise<CollaborationSession>
}

export interface ShareGrant {
  role: ShareRole
  projectId: string
  token?: string
}

/**
 * PUBLIC — read-only collaboration status that features may observe to render
 * share / presence affordances. This is the ONLY collaboration surface features
 * should depend on; it never mutates the live session or drives the sync path.
 *
 * Derived from the internal {@link CollaborationSession} by effort #9 and exposed
 * to features as plain, immutable state (e.g. via a hook selector or `<Composer>`
 * render prop). Solo/offline sessions report `isActive: false`, `role: 'owner'`,
 * and an empty `participants` list.
 */
export interface CollaborationStatus {
  /** Whether the current user may open or share a live room (mirrors `<Composer canShare>`). */
  readonly canShare: boolean
  /** Whether a live collaboration room is currently connected. */
  readonly isActive: boolean
  /** The current user's role in the active room; `'owner'` when solo/offline. */
  readonly role: ShareRole
  /** Live participant roster (read-only). Empty when not collaborating. */
  readonly participants: readonly Participant[]
}

/**
 * INTERNAL classification marker for effort #9's collaboration sync plumbing.
 *
 * These members live on the runtime (controller / reducer / `<Composer>` props),
 * NOT in `ComposerPublicApi`. They are enumerated here purely to formalize the
 * public/internal boundary; `contract/conformance.ts` asserts they never leak
 * into the public surface. Features MUST NOT call them:
 *   - `ComposerController.applyRemoteProject(project)` — applies a remote Yjs snapshot
 *   - `ComposerAction` variant `'sync-remote'` — reducer action backing the above
 *   - `<Composer collabProviderFactory>` — provider wiring
 */
export interface ComposerCollaborationInternals {
  /** @internal Applies a remote project snapshot into the store. Do not call from features. */
  applyRemoteProject(project: Project): void
}
