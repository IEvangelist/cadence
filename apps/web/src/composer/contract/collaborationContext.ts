import { createContext, useContext } from 'react'
import type { CollaborationStatus } from './collaboration'

/**
 * The solo/offline default — identical to {@link selectCollaborationStatus} over #9's
 * `INERT` state: no live session, `owner` role, empty roster, no share capability. Used
 * as the context default so {@link useCollaborationStatus} is safe to call outside a
 * `<Composer>` (single-user renders, tests, isolated panels).
 */
const SOLO_STATUS: CollaborationStatus = {
  canShare: false,
  isActive: false,
  role: 'owner',
  participants: [],
}

/**
 * Single-source channel for the PUBLIC {@link CollaborationStatus}.
 *
 * `<Composer>` computes the status ONCE — via {@link selectCollaborationStatus} over its
 * single `useCollaboration()` instance — and publishes it through this context; features
 * read it with {@link useCollaborationStatus}. Publishing via context (rather than each
 * consumer calling `useCollaboration()` itself) is what guarantees exactly ONE live
 * relay/awareness session: a second `useCollaboration()` call would open a duplicate
 * connection and make the local user appear twice in presence.
 */
export const CollaborationStatusContext = createContext<CollaborationStatus>(SOLO_STATUS)

/**
 * Read the current PUBLIC {@link CollaborationStatus}. Zero-arg and single-source:
 * returns the value published by the nearest `<Composer>`, or the solo default when
 * rendered outside one. Never instantiates a collaboration session, so any feature
 * panel (#41/#44/#45) can call it freely. Features depend ONLY on this + the
 * `CollaborationStatus` shape — never on #9's internal sync path.
 */
export function useCollaborationStatus(): CollaborationStatus {
  return useContext(CollaborationStatusContext)
}
