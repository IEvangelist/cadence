/**
 * Post-#9 binding — the read-only projection from effort #9's live collaboration
 * state into the PUBLIC {@link CollaborationStatus}. This is the single,
 * contract-owned selector features consume; it never mutates the session or drives
 * the sync path.
 *
 * It imports #9's real merged types (`CollaborationState`, `CollabPresence`), so it
 * exists only on post-#9 `main` — the "tightening" step of the contract PR. The
 * annotated return types plus the exported proofs below are the compile-time `⊆`
 * guard: the contract owns the public shape and #9 conforms to it. If #9's
 * `CollaborationState` / `CollabPresence` fields drift, this file stops compiling.
 *
 * `<Composer>` already computes everything this needs, so adopting the selector
 * requires NO change to #9:
 *   selectCollaborationStatus(
 *     useCollaboration(binding, collab, collabProviderFactory),
 *     { role: collab?.role ?? 'owner', canShare },
 *   )
 */
import type { CollaborationRole, CollaborationState } from '../model/collab/useCollaboration'
import type { CollabPresence } from '../model/collab/collabSession'
import type { CollaborationStatus, Participant, ShareRole } from './collaboration'

/**
 * Project one entry of #9's presence roster into the PUBLIC {@link Participant}.
 *
 * `id` is the per-connection Yjs `clientId` (stringified) — one user in two tabs
 * yields two participants; group by `userId` for a per-person view. `role` is
 * intentionally omitted in v1: #9 broadcasts only the current user's role (surfaced
 * at {@link CollaborationStatus.role}), and a self-reported peer role would be a
 * display hint only, never an authorization signal.
 */
export function projectParticipant(presence: CollabPresence): Participant {
  return {
    id: String(presence.clientId),
    userId: presence.user.id,
    displayName: presence.user.name,
    color: presence.user.color,
    isSelf: presence.isSelf,
  }
}

/** The current-user context the projection needs beyond #9's live roster. */
export interface CollaborationStatusInput {
  /** The current user's server-authoritative role; `'owner'` when solo/offline. */
  readonly role: ShareRole
  /** The `<Composer canShare>` capability flag. */
  readonly canShare: boolean
}

/**
 * The contract-owned read-only selector. Projects #9's {@link CollaborationState}
 * (returned by `useCollaboration()`) plus the current-user role and share
 * capability into the PUBLIC {@link CollaborationStatus}. Pure and side-effect-free;
 * a solo/offline (`INERT`) state yields `{ isActive: false, participants: [] }`.
 */
export function selectCollaborationStatus(
  state: CollaborationState,
  input: CollaborationStatusInput,
): CollaborationStatus {
  return {
    canShare: input.canShare,
    isActive: state.active,
    role: input.role,
    participants: state.presence.map(projectParticipant),
  }
}

/** Signature of the contract-owned collaboration selector. */
export type SelectCollaborationStatus = typeof selectCollaborationStatus

// --- Compile-time boundary proofs (contract is authoritative; #9 conforms) -----

/** #9's role union and the contract `ShareRole` must be the exact same three literals. */
type RolesAligned = CollaborationRole extends ShareRole
  ? ShareRole extends CollaborationRole
    ? true
    : never
  : never

/** #9's presence entry must carry every field the public projection reads. */
type PresenceProjectable = CollaborationState['presence'][number] extends {
  clientId: number
  user: { id: string; name: string; color: string }
  isSelf: boolean
}
  ? true
  : never

/** The selector's return must be assignable to the contract `CollaborationStatus`. */
type StatusAssignable = ReturnType<SelectCollaborationStatus> extends CollaborationStatus ? true : never

/** Proof that #9's `CollaborationRole` matches the contract `ShareRole`. */
export const rolesAligned: RolesAligned = true
/** Proof that #9's live presence entry projects into the public `Participant`. */
export const presenceProjectsToParticipant: PresenceProjectable = true
/** Proof that the selector conforms to the public `CollaborationStatus` shape. */
export const selectorConformsToContract: StatusAssignable = true
