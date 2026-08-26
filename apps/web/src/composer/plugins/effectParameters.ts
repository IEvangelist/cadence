import type {
  EffectContext,
  EffectContribution,
  EffectNumberParameterDescriptor,
  EffectNode,
  EffectParameterDescriptor,
} from './types'
import { sanitizeMixParams } from '../model/mix'

const SAFE_PARAMETER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const RESERVED_PARAMETER_IDS = new Set(['__proto__', 'prototype', 'constructor'])

export function isEffectParameterDescriptor(
  value: unknown,
): value is EffectNumberParameterDescriptor {
  if (value === null || typeof value !== 'object') return false
  const descriptor = value as Partial<EffectNumberParameterDescriptor>
  return (
    descriptor.type === 'number' &&
    typeof descriptor.id === 'string' &&
    SAFE_PARAMETER_ID.test(descriptor.id) &&
    !RESERVED_PARAMETER_IDS.has(descriptor.id) &&
    typeof descriptor.name === 'string' &&
    descriptor.name.trim().length > 0 &&
    typeof descriptor.defaultValue === 'number' &&
    Number.isFinite(descriptor.defaultValue) &&
    typeof descriptor.min === 'number' &&
    Number.isFinite(descriptor.min) &&
    typeof descriptor.max === 'number' &&
    Number.isFinite(descriptor.max) &&
    descriptor.min <= descriptor.max &&
    typeof descriptor.step === 'number' &&
    Number.isFinite(descriptor.step) &&
    descriptor.step > 0 &&
    (descriptor.unit === undefined || typeof descriptor.unit === 'string')
  )
}

/** Return valid, uniquely keyed descriptors safe to render and persist. */
export function effectParameterDescriptors(
  effect: Pick<EffectContribution, 'parameters'> | undefined,
): readonly EffectParameterDescriptor[] {
  const descriptors: EffectParameterDescriptor[] = []
  const ids = new Set<string>()
  for (const candidate of effect?.parameters ?? []) {
    if (!isEffectParameterDescriptor(candidate) || ids.has(candidate.id)) continue
    ids.add(candidate.id)
    descriptors.push(candidate)
  }
  return descriptors
}

/** Clamp a parameter value, falling back to the descriptor default for invalid input. */
export function sanitizeEffectParameterValue(
  descriptor: EffectParameterDescriptor,
  value: unknown,
): number {
  const fallback = Math.min(
    descriptor.max,
    Math.max(descriptor.min, descriptor.defaultValue),
  )
  const candidate =
    typeof value === 'number' && Number.isFinite(value) ? value : fallback
  const clamped = Math.min(descriptor.max, Math.max(descriptor.min, candidate))
  const stepped =
    descriptor.min +
    Math.round((clamped - descriptor.min) / descriptor.step) * descriptor.step
  return Number(
    Math.min(descriptor.max, Math.max(descriptor.min, stepped)).toPrecision(12),
  )
}

/** Build the persisted defaults for a newly inserted effect. */
export function defaultEffectParams(
  effect: Pick<EffectContribution, 'parameters'> | undefined,
): Record<string, number> {
  return Object.fromEntries(
    effectParameterDescriptors(effect).map((descriptor) => [
      descriptor.id,
      sanitizeEffectParameterValue(descriptor, descriptor.defaultValue),
    ]),
  )
}

/**
 * Resolve a complete parameter snapshot for a live node. Unknown persisted keys
 * are intentionally preserved so plugins can evolve without destructive loads.
 */
export function sanitizeEffectParams(
  effect: Pick<EffectContribution, 'parameters'> | undefined,
  value: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const params = sanitizeMixParams(value)
  for (const descriptor of effectParameterDescriptors(effect)) {
    params[descriptor.id] = sanitizeEffectParameterValue(descriptor, params[descriptor.id])
  }
  return params
}

/**
 * The only Plugin SDK factory wrapper used by the audio engine. It guarantees
 * factories receive the same complete, descriptor-normalized snapshot as live
 * node updates.
 */
export function createEffectNode(
  effect: EffectContribution,
  context: EffectContext,
): EffectNode {
  return effect.createNode({
    ...context,
    params: sanitizeEffectParams(effect, context.params),
  })
}
