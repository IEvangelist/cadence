/**
 * Built-in mixer insert effects, expressed as Plugin SDK contributions.
 *
 * These are the palette the #44 mixer offers as per-track inserts: a parametric
 * EQ, a studio reverb, a tempo-synced delay, and a glue compressor. Each is a
 * plain {@link EffectContribution}, so a third-party plugin can contribute more
 * inserts the same way. All ship `enabledByDefault: false` — they are opt-in
 * inserts and never touch the default master chain, so the out-of-the-box signal
 * path is unchanged.
 *
 * `tone` is imported at module scope but no node is constructed until an insert
 * is actually added, so importing this module stays side-effect free.
 */
import * as Tone from 'tone'
import type { EffectContribution, EffectNode } from '../types'

/** Wrap a single Tone node whose input and output are the node itself. */
function single(node: Tone.ToneAudioNode): EffectNode {
  return {
    input: node,
    output: node,
    dispose: () => {
      node.dispose()
    },
  }
}

function createParametricEq(): EffectNode {
  // Flat by default (0 dB per band) — transparent until a preset/automation moves it.
  return single(new Tone.EQ3({ low: 0, mid: 0, high: 0 }))
}

function createStudioReverb(): EffectNode {
  return single(new Tone.Reverb({ decay: 2.4, preDelay: 0.01, wet: 0.32 }))
}

function createTempoDelay(): EffectNode {
  // Eighth-note delay resolves against the transport tempo the engine sets.
  return single(new Tone.FeedbackDelay({ delayTime: '8n', feedback: 0.32, wet: 0.28 }))
}

function createGlueCompressor(): EffectNode {
  return single(
    new Tone.Compressor({ threshold: -24, ratio: 3, attack: 0.003, release: 0.25 }),
  )
}

/** The built-in mixer insert palette (all off until inserted on a track). */
export const MIX_EFFECTS: EffectContribution[] = [
  {
    id: 'eq3',
    name: 'Parametric EQ',
    description: 'Three-band EQ (low / mid / high) for shaping a track’s tone.',
    enabledByDefault: false,
    createNode: createParametricEq,
  },
  {
    id: 'reverb',
    name: 'Studio Reverb',
    description: 'A lush algorithmic reverb for adding space and depth.',
    enabledByDefault: false,
    createNode: createStudioReverb,
  },
  {
    id: 'delay',
    name: 'Tempo Delay',
    description: 'A tempo-synced feedback delay for echoes and rhythmic width.',
    enabledByDefault: false,
    createNode: createTempoDelay,
  },
  {
    id: 'compressor',
    name: 'Glue Compressor',
    description: 'A gentle compressor that evens out dynamics and glues a track together.',
    enabledByDefault: false,
    createNode: createGlueCompressor,
  },
]
