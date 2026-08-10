/**
 * Collaboration contract seam for the single shared live composer session (effort #9).
 *
 * PUBLIC vs INTERNAL — the boundary features build against:
 *   - PUBLIC (features #41/#42/#43/#45 MAY depend): `ShareRole`, `Participant`,
 *     `CollaborationStatus`, and the read-only `selectCollaborationStatus()` selector
 *     (owned by this contract module in collaborationSelector.ts; a pure projection
 *     over #9's live state, added during the post-#9 rebase — see docs/composer-api.md).
 *   - INTERNAL (#9 plumbing — features MUST NOT depend/drive): the Yjs sync path
 *     (`ComposerController.applyRemoteProject`, the `sync-remote` reducer action, the
 *     `<Composer collabProviderFactory>` prop) and #9's live-state hook
 *     `useCollaboration(): CollaborationState` with roster entries `CollabPresence`
 *     (apps/web/src/composer/model/collab/). See {@link ComposerCollaborationInternals}.
 *
 * The PUBLIC `CollaborationStatus` is a read-only projection over #9's internal
 * `CollaborationState`; it never mutates the session or drives the sync path.
 */
import type { Project } from '../model/project'

export type ShareRole = 'owner' | 'editor' | 'viewer'

/**
 * A single live participant in a collaboration room — a read-only projection of one
 * entry of #9's internal `CollabPresence` roster.
 *
 * `id` is a PER-CONNECTION presence handle (the stringified Yjs awareness `clientId`):
 * one user open in two tabs appears as TWO participants. Use it as a stable React key
 * and cursor-mapping handle; group by {@link Participant.userId} for a per-person view.
 */
export interface Participant {
  /** Per-connection presence handle (stringified Yjs `clientId`). NOT per-user — multi-tab ⇒ multiple entries. */
  readonly id: string
  /** Stable auth identity of the user behind this connection (#9 `user.id`). Group by this for a per-person roster. */
  readonly userId: string
  /** Human-readable display name (#9 `user.name`). */
  readonly displayName: string
  /** Presence color (#9 `user.color`). */
  readonly color: string
  /** True for the local connection — lets features highlight "you" without plumbing auth identity. */
  readonly isSelf: boolean
  /**
   * The participant's server-side role, when known. OPTIONAL: in v1 #9's awareness
   * broadcasts only the CURRENT user's role (surfaced at {@link CollaborationStatus.role}),
   * so peer entries omit it. When present it is a DISPLAY hint only and MUST NOT gate
   * behavior — write access is enforced server-side by #9's relay, never by this field.
   */
  readonly role?: ShareRole
}

/**
 * PUBLIC — read-only collaboration status; the ONLY collaboration surface features
 * may depend on. A projection of #9's internal `CollaborationState`; it never mutates
 * the live session or drives the sync path.
 *
 * Produced by the contract-owned read-only selector `selectCollaborationStatus`
 * (see collaborationSelector.ts, added in the post-#9 rebase and implemented over
 * #9's `useCollaboration()`). Mapping from #9's internal state:
 *   - `canShare`     ← the `<Composer canShare>` capability prop
 *   - `isActive`     ← `CollaborationState.active`
 *   - `role`         ← the current user's server-authoritative role
 *   - `participants` ← `CollaborationState.presence` projected to `Participant[]`
 * #9's internal `connected` / `canWrite` fields are NOT part of the public surface.
 *
 * Solo/offline sessions report `{ isActive: false, role: 'owner', participants: [] }`.
 */
export interface CollaborationStatus {
  /** Whether the current user may open or share a live room (mirrors `<Composer canShare>`). */
  readonly canShare: boolean
  /** Whether a live collaboration room is currently connected. */
  readonly isActive: boolean
  /** The current user's server-authoritative role; `'owner'` when solo/offline. */
  readonly role: ShareRole
  /** Live participant roster (read-only). Empty when not collaborating. */
  readonly participants: readonly Participant[]
}

/**
 * INTERNAL classification marker for effort #9's collaboration plumbing.
 *
 * These live on #9's runtime (controller / reducer / `<Composer>` props / live-state
 * hook), NOT in `ComposerPublicApi`. They are enumerated here purely to formalize the
 * public/internal boundary; `contract/conformance.ts` asserts they never leak into the
 * public surface. Features MUST NOT call them:
 *   - `ComposerController.applyRemoteProject(project)` — applies a remote Yjs snapshot
 *   - `ComposerAction` variant `'sync-remote'` — reducer action backing the above
 *   - `<Composer collabProviderFactory>` — provider wiring
 *   - `useCollaboration(): CollaborationState` + `CollabPresence` — #9's live-state hook and
 *     roster (apps/web/src/composer/model/collab/), the source the public projection derives from
 */
export interface ComposerCollaborationInternals {
  /** @internal Applies a remote project snapshot into the store. Do not call from features. */
  applyRemoteProject(project: Project): void
}
