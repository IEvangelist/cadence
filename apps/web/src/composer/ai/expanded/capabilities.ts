/**
 * Entitlement → capability mapping for the expanded-AI feature set.
 *
 * Gating is contract-driven: it reads the billing `Entitlements.aiGenerationsPerDay`
 * budget exposed by the composer's published AI seam ({@link AiEntitlementView} in
 * `contract/ai.ts`) — never a parallel tier model. The server catalog ships a
 * generous free budget (`50/day`) and an unlimited paid budget (`-1`), so the
 * budget alone distinguishes the tiers:
 *
 *  - **Any budget** (free 50/day or unlimited) unlocks the idea-starters —
 *    text→motif and groove/humanize.
 *  - **Unlimited budget** (`aiGenerationsPerDay < 0`) additionally unlocks the
 *    heavier "producer" tools — style transfer and auto-mastering.
 *
 * Enforcement is server-authoritative — this map only drives what the UI offers,
 * and it degrades to the safe free budget when entitlements are unknown (`null`)
 * or the payload is malformed (the billing client casts the response, it does not
 * validate it).
 */
import type { Entitlements } from '../../../billing/entitlementsClient'
import type { AiEntitlementView, ExtendedAssistantAction } from '../../contract/ai'
import type { AiFeatureId } from './types'

/** Sentinel used by the billing catalog for an unlimited budget. */
export const UNLIMITED = -1

/** The server's free-tier daily AI budget (mirrors `EntitlementOptions.Free`). */
export const FREE_AI_GENERATIONS_PER_DAY = 50

/** Map each UI feature onto its contract action vocabulary. */
const FEATURE_ACTION: Record<AiFeatureId, ExtendedAssistantAction> = {
  'text-to-motif': 'text-to-motif',
  'style-transfer': 'style-transfer',
  groove: 'groove-humanize',
  'auto-master': 'auto-master',
}

/** Contract actions that require an unlimited budget (the "producer" tools). */
const UNLIMITED_ONLY_ACTIONS: ReadonlySet<ExtendedAssistantAction> = new Set([
  'style-transfer',
  'auto-master',
])

/**
 * The free-tier entitlements used when none are known (anonymous, unresolved, or
 * a malformed payload). Mirrors the server's `EntitlementOptions.Free` so the UI
 * offers the same safe free set the server would grant.
 */
export const FREE_DEFAULT_ENTITLEMENTS: Entitlements = {
  tier: 'Free',
  watermarkExports: true,
  maxProjects: 10,
  aiGenerationsPerDay: FREE_AI_GENERATIONS_PER_DAY,
  advancedFormats: false,
  stemSeparation: false,
  collaborationSeats: 1,
}

/**
 * Read the AI budget defensively. A `null` entitlement, or a payload with a
 * missing/non-numeric `aiGenerationsPerDay` (the server response is cast, not
 * validated), falls back to the free budget rather than locking every feature.
 */
function readBudget(entitlements: Entitlements | null): number {
  const raw = entitlements?.aiGenerationsPerDay
  if (typeof raw !== 'number' || Number.isNaN(raw)) return FREE_AI_GENERATIONS_PER_DAY
  return raw
}

/**
 * The contract's {@link AiEntitlementView}, implemented against the billing
 * `aiGenerationsPerDay` budget. This is the single source of truth for AI gating;
 * everything else in the studio reads through it.
 */
export const aiEntitlementView: AiEntitlementView = {
  canUse(action: ExtendedAssistantAction, entitlements: Entitlements): boolean {
    const budget = readBudget(entitlements)
    if (budget === 0) return false
    if (UNLIMITED_ONLY_ACTIONS.has(action)) return budget < 0
    return true
  },
  remainingGenerations(entitlements: Entitlements, usedToday: number): number {
    const budget = readBudget(entitlements)
    if (budget < 0) return Number.POSITIVE_INFINITY
    return Math.max(0, budget - usedToday)
  },
}

/**
 * True for an unlimited (paid) budget, read through the contract view's
 * `remainingGenerations` (an unlimited budget reports `Infinity`). Defensive by
 * design: a `null` entitlement, or a malformed payload with no numeric budget,
 * resolves to the safe free default (finite, not unlimited).
 */
export function isUnlimited(entitlements: Entitlements | null): boolean {
  return !Number.isFinite(
    aiEntitlementView.remainingGenerations(entitlements ?? FREE_DEFAULT_ENTITLEMENTS, 0),
  )
}

/**
 * The single AI gate. Maps a UI feature onto its {@link ExtendedAssistantAction}
 * and asks the contract {@link AiEntitlementView} — there is no parallel
 * tier/capability model. `null` entitlements (anonymous or unresolved) resolve to
 * the free default so the panel is always useful rather than locked out.
 */
export function canUseFeature(
  feature: AiFeatureId,
  entitlements: Entitlements | null,
): boolean {
  return aiEntitlementView.canUse(
    FEATURE_ACTION[feature],
    entitlements ?? FREE_DEFAULT_ENTITLEMENTS,
  )
}
