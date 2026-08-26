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
import type {
  EffectContext,
  EffectContribution,
  EffectNode,
  EffectParameterDescriptor,
} from '../types'

/** Wrap a single Tone node whose input and output are the node itself. */
function single(
  node: Tone.ToneAudioNode,
  updateParams?: (params: Readonly<Record<string, number>>) => void,
): EffectNode {
  return {
    input: node,
    output: node,
    ...(updateParams ? { updateParams } : {}),
    dispose: () => {
      node.dispose()
    },
  }
}

const value = (context: EffectContext, id: string, fallback: number): number =>
  context.params?.[id] ?? fallback

const EQ_PARAMETERS = [
  { type: 'number', id: 'low', name: 'Low', defaultValue: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
  { type: 'number', id: 'mid', name: 'Mid', defaultValue: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
  { type: 'number', id: 'high', name: 'High', defaultValue: 0, min: -12, max: 12, step: 0.5, unit: 'dB' },
] as const satisfies readonly EffectParameterDescriptor[]

const REVERB_PARAMETERS = [
  { type: 'number', id: 'wet', name: 'Wet', defaultValue: 0.32, min: 0, max: 1, step: 0.01 },
] as const satisfies readonly EffectParameterDescriptor[]

const DELAY_PARAMETERS = [
  { type: 'number', id: 'feedback', name: 'Feedback', defaultValue: 0.32, min: 0, max: 0.9, step: 0.01 },
  { type: 'number', id: 'wet', name: 'Wet', defaultValue: 0.28, min: 0, max: 1, step: 0.01 },
] as const satisfies readonly EffectParameterDescriptor[]

const COMPRESSOR_PARAMETERS = [
  { type: 'number', id: 'threshold', name: 'Threshold', defaultValue: -24, min: -60, max: 0, step: 0.5, unit: 'dB' },
  { type: 'number', id: 'ratio', name: 'Ratio', defaultValue: 3, min: 1, max: 20, step: 0.5, unit: ':1' },
] as const satisfies readonly EffectParameterDescriptor[]

function createParametricEq(context: EffectContext): EffectNode {
  const node = new Tone.EQ3({
    low: value(context, 'low', 0),
    mid: value(context, 'mid', 0),
    high: value(context, 'high', 0),
  })
  return single(node, (params) => {
    node.low.value = params.low ?? 0
    node.mid.value = params.mid ?? 0
    node.high.value = params.high ?? 0
  })
}

function createStudioReverb(context: EffectContext): EffectNode {
  const node = new Tone.Reverb({
    decay: 2.4,
    preDelay: 0.01,
    wet: value(context, 'wet', 0.32),
  })
  return single(node, (params) => {
    node.wet.value = params.wet ?? 0.32
  })
}

function createTempoDelay(context: EffectContext): EffectNode {
  // Eighth-note delay resolves against the transport tempo the engine sets.
  const node = new Tone.FeedbackDelay({
    delayTime: '8n',
    feedback: value(context, 'feedback', 0.32),
    wet: value(context, 'wet', 0.28),
  })
  return single(node, (params) => {
    node.feedback.value = params.feedback ?? 0.32
    node.wet.value = params.wet ?? 0.28
  })
}

function createGlueCompressor(context: EffectContext): EffectNode {
  const node = new Tone.Compressor({
    threshold: value(context, 'threshold', -24),
    ratio: value(context, 'ratio', 3),
    attack: 0.003,
    release: 0.25,
  })
  return single(node, (params) => {
    node.threshold.value = params.threshold ?? -24
    node.ratio.value = params.ratio ?? 3
  })
}

/** The built-in mixer insert palette (all off until inserted on a track). */
export const MIX_EFFECTS: EffectContribution[] = [
  {
    id: 'eq3',
    name: 'Parametric EQ',
    description: 'Three-band EQ (low / mid / high) for shaping a track’s tone.',
    enabledByDefault: false,
    parameters: EQ_PARAMETERS,
    createNode: createParametricEq,
  },
  {
    id: 'reverb',
    name: 'Studio Reverb',
    description: 'A lush algorithmic reverb for adding space and depth.',
    enabledByDefault: false,
    parameters: REVERB_PARAMETERS,
    createNode: createStudioReverb,
  },
  {
    id: 'delay',
    name: 'Tempo Delay',
    description: 'A tempo-synced feedback delay for echoes and rhythmic width.',
    enabledByDefault: false,
    parameters: DELAY_PARAMETERS,
    createNode: createTempoDelay,
  },
  {
    id: 'compressor',
    name: 'Glue Compressor',
    description: 'A gentle compressor that evens out dynamics and glues a track together.',
    enabledByDefault: false,
    parameters: COMPRESSOR_PARAMETERS,
    createNode: createGlueCompressor,
  },
]
