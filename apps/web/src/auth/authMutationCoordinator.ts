import type { AuthPersistenceChange } from './authContext'

export const EXPECTED_OWNER_HEADER = 'X-Cadence-Expected-Owner'
const CHANNEL_NAME = 'cadence.auth-transitions.v1'
const STORAGE_KEY = 'cadence.auth-transition-event.v1'

export interface AuthMutationContext {
  readonly ownerId: string
  readonly cacheKey: string
  readonly signal: AbortSignal
  isCurrent(): boolean
}

export type AuthMutationContextFactory = () => AuthMutationContext
export interface ExternalAuthTransition {
  mode: AuthPersistenceChange['mode']
  ownerId: string | null
}

interface TransitionMessage {
  source: string
  mode: AuthPersistenceChange['mode']
  ownerId: string | null
}

export class AuthMutationCoordinator {
  private readonly source = globalThis.crypto?.randomUUID?.() ??
    Math.random().toString(36).slice(2)
  private epoch = 0
  private mode: AuthPersistenceChange['mode'] = 'anonymous'
  private ownerId: string | null = null
  private controller = new AbortController()
  private readonly listeners = new Set<
    (transition: ExternalAuthTransition) => void
  >()
  private readonly channel?: BroadcastChannel
  private readonly storageListener?: (event: StorageEvent) => void

  constructor(enableBroadcast = true) {
    if (!enableBroadcast || typeof window === 'undefined') return
    if (typeof window.BroadcastChannel === 'function') {
      this.channel = new window.BroadcastChannel(CHANNEL_NAME)
      this.channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        this.receive(event.data)
      })
    } else {
      this.storageListener = (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return
        try {
          this.receive(JSON.parse(event.newValue))
        } catch {
          // Ignore malformed cross-tab input.
        }
      }
      window.addEventListener('storage', this.storageListener)
    }
  }

  transition(change: AuthPersistenceChange, broadcast = true): void {
    this.apply(change.mode, change.ownerId, false)
    if (!broadcast) return
    const message: TransitionMessage = {
      source: this.source,
      mode: change.mode,
      ownerId: change.ownerId,
    }
    if (this.channel) {
      this.channel.postMessage(message)
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(message))
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Storage can be unavailable; this tab is still invalidated locally.
    }
  }

  capture(expectedOwnerId?: string | null): AuthMutationContext {
    if (this.mode !== 'authenticated' || !this.ownerId) {
      throw new DOMException(
        'Authenticated mutation context is unavailable.',
        'AbortError',
      )
    }
    if (expectedOwnerId && expectedOwnerId !== this.ownerId) {
      throw new DOMException('Authenticated owner changed.', 'AbortError')
    }
    const ownerId = this.ownerId
    const epoch = this.epoch
    const controller = this.controller
    return {
      ownerId,
      cacheKey: `${encodeURIComponent(ownerId)}:${epoch}`,
      signal: controller.signal,
      isCurrent: () =>
        !controller.signal.aborted &&
        this.epoch === epoch &&
        this.mode === 'authenticated' &&
        this.ownerId === ownerId,
    }
  }

  subscribeInvalidation(
    listener: (transition: ExternalAuthTransition) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Apply a transport-delivered transition; public for deterministic adapters/tests. */
  acceptExternalTransition(transition: ExternalAuthTransition): void {
    this.apply(transition.mode, transition.ownerId, true)
  }

  dispose(): void {
    this.controller.abort()
    this.channel?.close()
    if (this.storageListener && typeof window !== 'undefined') {
      window.removeEventListener('storage', this.storageListener)
    }
    this.listeners.clear()
  }

  private apply(
    mode: AuthPersistenceChange['mode'],
    ownerId: string | null,
    notify: boolean,
  ): void {
    this.controller.abort()
    this.controller = new AbortController()
    this.epoch += 1
    this.mode = mode
    this.ownerId = ownerId
    if (notify) {
      const transition = { mode, ownerId }
      this.listeners.forEach((listener) => listener(transition))
    }
  }

  private receive(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const candidate = value as Partial<TransitionMessage>
    if (
      candidate.source === this.source ||
      (candidate.mode !== 'authenticated' &&
        candidate.mode !== 'offline' &&
        candidate.mode !== 'anonymous') ||
      (candidate.ownerId !== null && typeof candidate.ownerId !== 'string')
    ) {
      return
    }
    this.acceptExternalTransition({
      mode: candidate.mode,
      ownerId: candidate.ownerId,
    })
  }
}

export const authMutationCoordinator = new AuthMutationCoordinator()

export const captureAuthMutation: AuthMutationContextFactory = () =>
  authMutationCoordinator.capture()
