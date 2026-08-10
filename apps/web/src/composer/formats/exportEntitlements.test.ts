import { describe, expect, it } from 'vitest'
import type { Entitlements } from '../../billing/entitlementsClient'
import type { ExportAction } from '../contract/export'
import { exportEntitlementView, watermarkExportsFor } from './exportEntitlements'

/**
 * Build entitlements for a tier. `watermarkExports` mirrors the server catalog by
 * default (free → watermarked, paid → clean) but can be overridden to exercise
 * the flag-based gating directly.
 */
function entitlements(
  tier: string,
  watermarkExports = tier.trim().toLowerCase() === 'free',
): Entitlements {
  const isFree = tier.trim().toLowerCase() === 'free'
  return {
    tier,
    watermarkExports,
    maxProjects: isFree ? 10 : -1,
    aiGenerationsPerDay: isFree ? 50 : -1,
    advancedFormats: !isFree,
    stemSeparation: !isFree,
    collaborationSeats: isFree ? 1 : 5,
  }
}

describe('watermarkExportsFor', () => {
  it('treats null entitlements as the free (watermarked) default', () => {
    expect(watermarkExportsFor(null)).toBe(true)
  })

  it('watermarks free exports and clears paid exports', () => {
    expect(watermarkExportsFor(entitlements('Free'))).toBe(true)
    expect(watermarkExportsFor(entitlements('Pro'))).toBe(false)
  })

  it('degrades to watermarked when the payload is malformed', () => {
    // The billing client casts the server response without validating it, so a
    // malformed payload can arrive with no `watermarkExports` field. This must
    // resolve to the safe free default (watermarked) instead of exporting clean.
    const missingFlag = {} as unknown as Entitlements
    expect(watermarkExportsFor(missingFlag)).toBe(true)

    const nonBooleanFlag = { tier: 'Pro', watermarkExports: 'nope' } as unknown as Entitlements
    expect(watermarkExportsFor(nonBooleanFlag)).toBe(true)
  })

  it('clears the watermark only for an explicit paid false', () => {
    expect(watermarkExportsFor(entitlements('Studio', false))).toBe(false)
    expect(watermarkExportsFor(entitlements('Free', true))).toBe(true)
  })
})

describe('exportEntitlementView', () => {
  const action: ExportAction = 'wav'

  it('applies the watermark for the free tier', () => {
    expect(exportEntitlementView.appliesWatermark(action, entitlements('Free'))).toBe(true)
  })

  it('skips the watermark for a paid tier', () => {
    expect(exportEntitlementView.appliesWatermark(action, entitlements('Pro'))).toBe(false)
  })

  it('keeps the watermark when the flag is missing or non-boolean', () => {
    const missingFlag = {} as unknown as Entitlements
    expect(exportEntitlementView.appliesWatermark(action, missingFlag)).toBe(true)

    const nonBooleanFlag = { watermarkExports: 1 } as unknown as Entitlements
    expect(exportEntitlementView.appliesWatermark(action, nonBooleanFlag)).toBe(true)
  })
})
