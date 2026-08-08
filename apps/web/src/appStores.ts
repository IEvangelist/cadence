/**
 * App-level singletons that wire the composer's persistence seam to auth state.
 *
 * A single {@link SyncingProjectStore} is shared by the composer for the whole
 * session. It reads the mutable `authFlag` on every call to decide whether to
 * use the browser-local store (signed out, offline-first) or the remote server
 * store (signed in). {@link handleAuthChange} flips that flag and, on the
 * transition to signed-in, pushes any local-only projects up to the server.
 */
import { createProjectStore } from './composer/model/storage'
import { RemoteProjectStore } from './composer/model/remoteStore'
import { SyncingProjectStore, type AuthFlag } from './composer/model/syncingStore'

const authFlag: AuthFlag = { current: false }
const localStore = createProjectStore()
const remoteStore = new RemoteProjectStore()

/** The single persistence store handed to the composer. */
export const projectStore = new SyncingProjectStore(localStore, remoteStore, authFlag)

/** Flip the active backend when auth changes; sync local→remote on sign-in. */
export async function handleAuthChange(authenticated: boolean): Promise<void> {
  const wasAuthenticated = authFlag.current
  authFlag.current = authenticated
  if (authenticated && !wasAuthenticated) {
    try {
      await projectStore.syncLocalToRemote()
    } catch {
      // Best-effort: a sync failure must not block a successful sign-in.
    }
  }
}
