import { describe, expect, it, vi } from 'vitest'

/** Records dispose calls per mocked Tone node class. */
const h = vi.hoisted(() => ({ dispose: vi.fn() }))

vi.mock('tone', () => {
  class Base {
    low = { value: 0 }
    mid = { value: 0 }
    high = { value: 0 }
    wet = { value: 0 }
    feedback = { value: 0 }
    threshold = { value: 0 }
    ratio = { value: 0 }
    dispose = h.dispose
  }
  return {
    EQ3: class extends Base {},
    Reverb: class extends Base {},
    FeedbackDelay: class extends Base {},
    Compressor: class extends Base {},
  }
})

import { MIX_EFFECTS } from './mixEffects'

describe('MIX_EFFECTS', () => {
  it('ships the four mixer inserts, all disabled by default', () => {
    expect(MIX_EFFECTS.map((effect) => effect.id)).toEqual(['eq3', 'reverb', 'delay', 'compressor'])
    for (const effect of MIX_EFFECTS) {
      expect(effect.name).toBeTruthy()
      expect(effect.description).toBeTruthy()
      // Off by default so the out-of-the-box signal path is untouched.
      expect(effect.enabledByDefault).toBe(false)
    }
  })

  it('creates single-node effect nodes (input === output) that dispose cleanly', () => {
    for (const effect of MIX_EFFECTS) {
      h.dispose.mockClear()
      const node = effect.createNode({ tempo: 120 })
      expect(node.input).toBeDefined()
      expect(node.input).toBe(node.output)
      node.dispose()
      expect(h.dispose).toHaveBeenCalledTimes(1)
    }
  })

  it('declares defaults and updates live Tone parameters', () => {
    const reverb = MIX_EFFECTS.find((effect) => effect.id === 'reverb')
    expect(reverb?.parameters?.map((parameter) => parameter.id)).toEqual(['wet'])
    const node = reverb!.createNode({ tempo: 120, params: { wet: 0.4 } })
    node.updateParams?.({ wet: 0.75 })
    expect((node.input as unknown as { wet: { value: number } }).wet.value).toBe(0.75)
  })
})
