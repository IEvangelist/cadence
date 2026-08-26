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
  /** Whether the primary pointing device is coarse. */
  coarsePointer: boolean
  /** Whether the primary pointing device is fine, when supplied by the host. */
  finePointer?: boolean
}

export type KeyboardPlatform = 'mac' | 'other'
export type PrimaryPointer = 'coarse' | 'fine' | 'none'

/**
 * A runtime-only snapshot. These values are deliberately capabilities rather
 * than device names so hybrid and installed experiences remain representable.
 */
export interface PlatformCapabilities {
  keyboardPlatform: KeyboardPlatform
  viewport: ComposerViewport
  /** Whether any available pointing device is coarse. */
  coarsePointer: boolean
  /** Whether any available pointing device is fine. */
  finePointer: boolean
  /** The primary pointing-device precision used for interaction layout. */
  primaryPointer: PrimaryPointer
  isStandalone: boolean
  isOnline: boolean
  hasCacheStorage: boolean
  hasServiceWorker: boolean
}

/** Observable and injectable source used by browser, SSR, and test hosts. */
export interface PlatformCapabilitySource {
  getSnapshot(): PlatformCapabilities
  getServerSnapshot(): PlatformCapabilities
  subscribe(listener: () => void): () => void
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
