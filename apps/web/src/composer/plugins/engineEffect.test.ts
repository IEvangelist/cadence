import { describe, expect, it, vi } from 'vitest'

/** Minimal Tone mock: only the nodes the engine constructs in this test. */
const h = vi.hoisted(() => ({
  transport: {
    bpm: { value: 120 },
    loop: false,
    loopStart: 0 as unknown,
    loopEnd: 0 as unknown,
    seconds: 0,
    position: 0 as unknown,
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  },
}))

vi.mock('tone', () => {
  class Gain {
    gain = { value: 0.9 }
    toDestination() {
      return this
    }
    connect() {
      return this
    }
    disconnect() {
      return this
    }
    dispose = vi.fn()
  }
  class Panner {
    pan = { value: 0 }
    connect() {
      return this
    }
    disconnect() {
      return this
    }
    dispose = vi.fn()
  }
  class Limiter {
    threshold = { value: -1 }
    connect() {
      return this
    }
    disconnect() {
      return this
    }
    dispose = vi.fn()
  }
  return {
    Gain,
    Panner,
    Limiter,
    getTransport: () => h.transport,
    start: () => Promise.resolve(),
    now: () => 0,
  }
})

const { ToneAudioEngine } = await import('../audio/engine')
const { defaultPluginHost } = await import('./defaultHost')
import type { EffectNode } from './types'

describe('a plugin-contributed effect through the engine seam', () => {
  it('inserts an enabled effect into the master chain when the engine is built', () => {
    const output = { connect: vi.fn() }
    const dispose = vi.fn()
    const node = { input: { connect: vi.fn() }, output, dispose } as unknown as EffectNode
    const createNode = vi.fn(() => node)

    defaultPluginHost.use({
      manifest: { id: 'test.fx', name: 'Test FX', version: '1.0.0' },
      contributes: {
        effects: [
          {
            id: 'test-fx',
            name: 'Test FX',
            description: 'A stub effect for the seam test.',
            enabledByDefault: true,
            createNode,
          },
        ],
      },
    })

    const engine = new ToneAudioEngine()

    // The engine built the node and wired its output onward through the chain.
    expect(createNode).toHaveBeenCalledTimes(1)
    expect(createNode).toHaveBeenCalledWith({ tempo: expect.any(Number) })
    expect(output.connect).toHaveBeenCalledTimes(1)

    // Disposing the engine disposes the effect node.
    engine.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('does not build any effect node when none are enabled by default', () => {
    const createNode = vi.fn(() => ({}) as unknown as EffectNode)
    defaultPluginHost.use({
      manifest: { id: 'test.fx.off', name: 'Off FX', version: '1.0.0' },
      contributes: {
        effects: [
          {
            id: 'test-fx-off',
            name: 'Off FX',
            description: 'A disabled stub effect.',
            enabledByDefault: false,
            createNode,
          },
        ],
      },
    })

    new ToneAudioEngine()
    expect(createNode).not.toHaveBeenCalled()
  })
})
