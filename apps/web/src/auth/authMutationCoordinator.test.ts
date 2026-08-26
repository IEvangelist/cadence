import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthMutationCoordinator } from './authMutationCoordinator'

class FakeBroadcastChannel {
  static readonly channels = new Set<FakeBroadcastChannel>()
  private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>()

  constructor() {
    FakeBroadcastChannel.channels.add(this)
  }

  addEventListener(
    _type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.add(listener)
  }

  postMessage(value: unknown): void {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel === this) continue
      channel.listeners.forEach((listener) =>
        listener(new MessageEvent('message', { data: value })),
      )
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.delete(this)
    this.listeners.clear()
  }
}

const originalBroadcastChannel = window.BroadcastChannel

afterEach(() => {
  Object.defineProperty(window, 'BroadcastChannel', {
    configurable: true,
    value: originalBroadcastChannel,
  })
  FakeBroadcastChannel.channels.clear()
})

describe('AuthMutationCoordinator cross-tab invalidation', () => {
  it('broadcasts account transitions and aborts another tab mutation generation', () => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: FakeBroadcastChannel,
    })
    const first = new AuthMutationCoordinator()
    const second = new AuthMutationCoordinator()
    const invalidated = vi.fn()
    second.subscribeInvalidation(invalidated)

    first.transition({
      generation: 1,
      mode: 'authenticated',
      ownerId: 'owner-a',
      purgeOwnerIds: [],
    })
    const captured = second.capture('owner-a')
    expect(captured.isCurrent()).toBe(true)

    first.transition({
      generation: 2,
      mode: 'anonymous',
      ownerId: null,
      purgeOwnerIds: ['owner-a'],
    })

    expect(captured.signal.aborted).toBe(true)
    expect(captured.isCurrent()).toBe(false)
    expect(invalidated).toHaveBeenCalledTimes(2)
    expect(() => second.capture('owner-a')).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    )
    first.dispose()
    second.dispose()
  })

  it('uses storage events when BroadcastChannel is unavailable', () => {
    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
    })
    const coordinator = new AuthMutationCoordinator()
    const publish = (
      mode: 'authenticated' | 'anonymous',
      ownerId: string | null,
    ) =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'cadence.auth-transition-event.v1',
          newValue: JSON.stringify({
            source: 'another-tab',
            mode,
            ownerId,
          }),
        }),
      )

    publish('authenticated', 'owner-a')
    const captured = coordinator.capture('owner-a')
    publish('anonymous', null)

    expect(captured.signal.aborted).toBe(true)
    expect(captured.isCurrent()).toBe(false)
    coordinator.dispose()
  })
})
