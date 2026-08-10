/**
 * Platform, PWA, viewport, and offline contracts for effort #43.
 *
 * The offline cache is a ProjectStore decorator. `pendingSync` mirrors
 * SyncingProjectStore.syncLocalToRemote semantics.
 */
import type { ProjectStore } from '../model/storage'

export type ViewportKind = 'mobile' | 'tablet' | 'desktop'

export interface ComposerViewport {
  kind: ViewportKind
  width: number
  height: number
  coarsePointer: boolean
}

export type OfflineStatus = 'online' | 'offline' | 'syncing'

export interface OfflineCacheState {
  status: OfflineStatus
  pendingSync: number
  lastSyncedAt?: number
}

export type PwaInstallState = 'unsupported' | 'available' | 'installed'

export interface PwaController {
  installState: PwaInstallState
  promptInstall(): Promise<boolean>
}

export type OfflineProjectStore = ProjectStore
