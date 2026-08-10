import { describe, expect, it } from 'vitest'
import type { Entitlements } from '../../../billing/entitlementsClient'
import type { ExtendedAssistantAction } from '../../contract/ai'
import {
  FREE_AI_GENERATIONS_PER_DAY,
  UNLIMITED,
  aiEntitlementView,
  canUseFeature,
  isUnlimited,
} from './capabilities'

/**
 * Build entitlements for a tier. The AI budget mirrors the server catalog by
 * default (free → 50/day, paid → unlimited) but can be overridden to exercise
 * the budget-based gating directly.
 */
function entitlements(
  tier: string,
  aiGenerationsPerDay = tier.trim().toLowerCase() === 'free' ? FREE_AI_GENERATIONS_PER_DAY : UNLIMITED,
): Entitlements {
  const isFree = tier.trim().toLowerCase() === 'free'
  return {
    tier,
    watermarkExports: isFree,
    maxProjects: isFree ? 10 : UNLIMITED,
    aiGenerationsPerDay,
    advancedFormats: !isFree,
    stemSeparation: !isFree,
    collaborationSeats: isFree ? 1 : 5,
  }
}

const ALL_FEATURES = ['text-to-motif', 'groove', 'style-transfer', 'auto-master'] as const

describe('canUseFeature', () => {
  it('treats null entitlements as the free budget', () => {
    expect(canUseFeature('text-to-motif', null)).toBe(true)
    expect(canUseFeature('groove', null)).toBe(true)
    expect(canUseFeature('style-transfer', null)).toBe(false)
    expect(canUseFeature('auto-master', null)).toBe(false)
  })

  it('unlocks only the starter features on the free budget', () => {
    const free = entitlements('Free')
    expect(canUseFeature('text-to-motif', free)).toBe(true)
    expect(canUseFeature('groove', free)).toBe(true)
    expect(canUseFeature('style-transfer', free)).toBe(false)
    expect(canUseFeature('auto-master', free)).toBe(false)
  })

  it('unlocks all features on an unlimited (paid) budget', () => {
    const pro = entitlements('Pro')
    for (const feature of ALL_FEATURES) expect(canUseFeature(feature, pro)).toBe(true)
  })

  it('locks every feature when the budget is exhausted (0/day)', () => {
    const spent = entitlements('Free', 0)
    for (const feature of ALL_FEATURES) expect(canUseFeature(feature, spent)).toBe(false)
  })

  it('degrades to the free budget when the payload is malformed', () => {
    // The billing client casts the server response without validating it, so a
    // malformed payload can arrive with no numeric budget. This must resolve to
    // the safe free default instead of throwing during render.
    const missingBudget = {} as unknown as Entitlements
    expect(canUseFeature('text-to-motif', missingBudget)).toBe(true)
    expect(canUseFeature('auto-master', missingBudget)).toBe(false)

    const nonNumericBudget = { tier: 'Pro', aiGenerationsPerDay: 'lots' } as unknown as Entitlements
    expect(canUseFeature('style-transfer', nonNumericBudget)).toBe(false)
  })
})

describe('isUnlimited', () => {
  it('is false for null and the free budget', () => {
    expect(isUnlimited(null)).toBe(false)
    expect(isUnlimited(entitlements('Free'))).toBe(false)
  })

  it('is true for any unlimited-budget tier (e.g. Pro, Studio)', () => {
    expect(isUnlimited(entitlements('Pro'))).toBe(true)
    expect(isUnlimited(entitlements('Studio'))).toBe(true)
  })

  it('is false for a finite budget or a malformed payload', () => {
    expect(isUnlimited(entitlements('Free', 999))).toBe(false)
    const nonNumericBudget = { tier: 'Pro', aiGenerationsPerDay: 'lots' } as unknown as Entitlements
    expect(isUnlimited(nonNumericBudget)).toBe(false)
  })
})

describe('aiEntitlementView', () => {
  const base: ExtendedAssistantAction[] = ['continue', 'generate', 'harmonize']
  const starters: ExtendedAssistantAction[] = ['text-to-motif', 'groove-humanize']
  const producers: ExtendedAssistantAction[] = ['style-transfer', 'auto-master']

  it('allows base and starter actions on any non-zero budget', () => {
    const free = entitlements('Free')
    for (const action of [...base, ...starters]) {
      expect(aiEntitlementView.canUse(action, free)).toBe(true)
    }
  })

  it('reserves producer actions for an unlimited budget', () => {
    const free = entitlements('Free')
    const pro = entitlements('Pro')
    for (const action of producers) {
      expect(aiEntitlementView.canUse(action, free)).toBe(false)
      expect(aiEntitlementView.canUse(action, pro)).toBe(true)
    }
  })

  it('blocks everything when the budget is exhausted', () => {
    const spent = entitlements('Free', 0)
    for (const action of [...base, ...starters, ...producers]) {
      expect(aiEntitlementView.canUse(action, spent)).toBe(false)
    }
  })

  it('computes remaining generations against a finite budget', () => {
    const free = entitlements('Free', 50)
    expect(aiEntitlementView.remainingGenerations(free, 10)).toBe(40)
    expect(aiEntitlementView.remainingGenerations(free, 50)).toBe(0)
    // Never negative, even when over budget.
    expect(aiEntitlementView.remainingGenerations(free, 80)).toBe(0)
  })

  it('reports an unlimited budget as infinite remaining generations', () => {
    const pro = entitlements('Pro')
    expect(aiEntitlementView.remainingGenerations(pro, 1000)).toBe(Number.POSITIVE_INFINITY)
  })
})
