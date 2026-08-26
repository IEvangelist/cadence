import { MemoryStorage, type SyncStorage } from '../composer/model/storage'
import type { Me } from './authClient'

const OFFLINE_IDENTITY_KEY = 'cadence.collab.offline-identity.v1'

/** Minimal identity retained only to find this account's local collaboration cache. */
export interface OfflineAuthIdentity {
  id: string
  displayName: string
}

function defaultStorage(): SyncStorage {
  return typeof globalThis !== 'undefined' &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined'
    ? (globalThis as unknown as { localStorage: SyncStorage }).localStorage
    : new MemoryStorage()
}

export class OfflineIdentityStore {
  private readonly storage: SyncStorage

  constructor(storage: SyncStorage = defaultStorage()) {
    this.storage = storage
  }

  read(): OfflineAuthIdentity | null {
    const raw = this.storage.getItem(OFFLINE_IDENTITY_KEY)
    if (!raw) return null
    try {
      const value = JSON.parse(raw) as Partial<OfflineAuthIdentity>
      return typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.displayName === 'string'
        ? { id: value.id, displayName: value.displayName }
        : null
    } catch {
      return null
    }
  }

  remember(user: Pick<Me, 'id' | 'displayName'>): OfflineAuthIdentity {
    const identity = { id: user.id, displayName: user.displayName }
    this.storage.setItem(OFFLINE_IDENTITY_KEY, JSON.stringify(identity))
    return identity
  }

  clear(): void {
    this.storage.removeItem(OFFLINE_IDENTITY_KEY)
  }
}
