import { describe, expect, it, vi } from 'vitest'

/** Shared spies the mocked Tone nodes report to. */
const h = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), dispose: vi.fn() }))

vi.mock('tone', () => {
  class Node {
    gain = { value: 1 }
    pan = { value: 0 }
    threshold = { value: 0 }
    connect = h.connect
    disconnect = h.disconnect
    dispose = h.dispose
  }
  return {
    Gain: class extends Node {},
    Panner: class extends Node {},
    Limiter: class extends Node {},
  }
})

import { createMixerGraph, dbToGain } from './mixerGraph'
import type { EffectNode } from '../plugins/types'

describe('dbToGain', () => {
  it('maps 0 dB to unity gain', () => {
    expect(dbToGain(0)).toBe(1)
  })

  it('maps ±6 dB symmetrically around unity', () => {
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    expect(dbToGain(6)).toBeCloseTo(1.995, 3)
  })
})

describe('createMixerGraph', () => {
  it('exposes a master output', () => {
    const graph = createMixerGraph()
    expect(graph.output).toBeDefined()
    graph.dispose()
  })

  it('returns a stable input per track id', () => {
    const graph = createMixerGraph()
    const first = graph.channelInput('a')
    const second = graph.channelInput('a')
    expect(first).toBe(second)
    graph.dispose()
  })

  it('drives every channel + master control without throwing', () => {
    const graph = createMixerGraph()
    graph.channelInput('a')
    graph.ensureChannel('b')

    graph.setTrackGain('a', -6)
    graph.setTrackPan('a', 0.4)
    graph.setChannelAudible('a', false)
    graph.setChannelAudible('a', true)

    graph.setMasterGain(-3)
    graph.setLimiter(true, -2) // enable → rewire master
    graph.setLimiter(true, -4) // still enabled → threshold only
    graph.setLimiter(false, -1) // disable → rewire master

    graph.disposeChannel('b')
    graph.disposeChannel('missing') // no-op
    graph.dispose()
  })

  it('disposes replaced insert nodes when the chain changes', () => {
    const graph = createMixerGraph()
    graph.channelInput('a')
    const insert = {
      input: { connect: vi.fn() },
      output: { connect: vi.fn() },
      dispose: vi.fn(),
    }
    graph.setTrackInserts('a', [insert as unknown as EffectNode])
    // Replacing the chain disposes the previous insert node.
    graph.setTrackInserts('a', [])
    expect(insert.dispose).toHaveBeenCalledTimes(1)
    expect(insert.output.connect).toHaveBeenCalled()
    graph.dispose()
  })
})
