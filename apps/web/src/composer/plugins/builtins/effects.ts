/**
 * Built-in audio effects, expressed as Plugin SDK contributions.
 *
 * Ships one simple master-bus effect — a gentle high-cut filter — that is
 * **disabled by default**, so the out-of-the-box signal path is unchanged. It
 * exists to prove the effect extension point end-to-end; a plugin can contribute
 * its own effects the same way, and one with `enabledByDefault: true` is inserted
 * into the master chain when the engine is built.
 *
 * `tone` is imported at module scope but no node is constructed until an effect
 * is actually created, so importing this module stays side-effect free.
 */
import * as Tone from 'tone'
import type { EffectContribution, EffectNode } from '../types'

function createSoftener(): EffectNode {
  const filter = new Tone.Filter(8000, 'lowpass')
  return {
    input: filter,
    output: filter,
    dispose: () => filter.dispose(),
  }
}

/** The single built-in effect (off by default). */
export const BUILTIN_EFFECTS: EffectContribution[] = [
  {
    id: 'softener',
    name: 'High-Cut Softener',
    description: 'A gentle low-pass filter that tames harsh highs on the master bus.',
    enabledByDefault: false,
    createNode: createSoftener,
  },
]
