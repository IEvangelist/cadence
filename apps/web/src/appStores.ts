/**
 * App-level singletons that wire the composer's persistence seam to auth state.
 *
 * A single {@link SyncingProjectStore} is shared by the composer for the whole
 * session. It reads the mutable `authFlag` on every call to choose anonymous,
 * confirmed-remote, or cached-offline behavior. {@link handleAuthChange} also
 * clears old owner-scoped collaboration data before account transitions and,
 * on sign-in, pushes ordinary local-only projects up to the server.
 */
import { createProjectStore } from './composer/model/storage'
import { RemoteProjectStore } from './composer/model/remoteStore'
import { SyncingProjectStore, type AuthFlag } from './composer/model/syncingStore'
import type { AuthPersistenceChange } from './auth/authContext'

const authFlag: AuthFlag = {
  current: false,
  mode: 'anonymous',
  ownerId: null,
  generation: 0,
}
const localStore = createProjectStore()
const remoteStore = new RemoteProjectStore()

/** The single persistence store handed to the composer. */
export const projectStore = new SyncingProjectStore(localStore, remoteStore, authFlag)

/** Apply confirmed/offline auth ownership, including account-scoped cleanup. */
export async function handleAuthChange(
  change: AuthPersistenceChange,
): Promise<void> {
  if (change.generation < authFlag.generation) return
  const wasAuthenticated = authFlag.current
  // Deny every owner-scoped view while cleanup/reconciliation is in flight.
  authFlag.generation = change.generation
  authFlag.current = false
  authFlag.mode = 'anonymous'
  authFlag.ownerId = null
  await Promise.resolve()
  await Promise.all(
    [...new Set(change.purgeOwnerIds)].map((ownerId) =>
      projectStore.clearOwnerCollaborationData(ownerId),
    ),
  )
  if (authFlag.generation !== change.generation) return
  await projectStore.retryPendingCollaborationData(
    change.ownerId ?? undefined,
  )
  if (authFlag.generation !== change.generation) return

  authFlag.current = change.mode === 'authenticated'
  authFlag.mode = change.mode
  authFlag.ownerId = change.ownerId
  if (change.mode === 'authenticated' && !wasAuthenticated) {
    try {
      await projectStore.syncLocalToRemote()
    } catch {
      // Best-effort: a sync failure must not block a successful sign-in.
    }
  }
}
