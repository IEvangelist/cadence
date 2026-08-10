import { describe, expect, it, vi } from 'vitest'

/** Records dispose calls per mocked Tone node class. */
const h = vi.hoisted(() => ({ dispose: vi.fn() }))

vi.mock('tone', () => {
  class Base {
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
})
