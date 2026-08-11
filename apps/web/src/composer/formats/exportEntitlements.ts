/**
 * Entitlement → audio-export policy for the free-tier watermark (effort #72).
 *
 * Gating is contract-driven: it reads the billing `Entitlements.watermarkExports`
 * flag exposed through the composer's published export seam ({@link
 * ExportEntitlementView} in `contract/export.ts`) — never a parallel tier model,
 * mirroring how {@link aiEntitlementView} gates AI on `aiGenerationsPerDay`.
 *
 * Enforcement of *what* a watermark is stays server-authoritative and lives in
 * the pure `audioWatermark` renderer; this view only decides *whether* a given
 * export is watermarked, and it degrades to the safe free default (watermarked)
 * when entitlements are unknown (`null`) or the payload is malformed (the billing
 * client casts the response, it does not validate it).
 */
import type { Entitlements } from '../../billing/entitlementsClient'
import type { ExportAction, ExportEntitlementView } from '../contract/export'

/**
 * The contract's {@link ExportEntitlementView}, implemented against the billing
 * `watermarkExports` flag. Only a resolved entitlement that *explicitly* clears
 * the flag (`watermarkExports === false`) exports clean; anything else — a free
 * tier, or a malformed payload with a missing/non-boolean flag — keeps the
 * watermark, so a bad response can never silently unlock a clean export.
 */
export const exportEntitlementView: ExportEntitlementView = {
  appliesWatermark(_action: ExportAction, entitlements: Entitlements): boolean {
    return entitlements.watermarkExports !== false
  },
}

/**
 * Resolve the watermark decision for a possibly-null entitlement set. Anonymous
 * or unresolved (`null`) entitlements resolve to the safe free default
 * (watermarked), mirroring how the AI gate treats `null` as the free budget.
 * This is the single client-side export gate; the composer consumes its boolean
 * result at the render→encode boundary via the existing `watermarkExports`
 * option, so no composer internals are threaded through.
 *
 * The decision is action-agnostic — it reads only the `watermarkExports` flag —
 * so WAV and MP3 share one gate (full parity: free = watermarked, paid = clean).
 */
export function watermarkExportsFor(entitlements: Entitlements | null): boolean {
  if (!entitlements) return true
  return exportEntitlementView.appliesWatermark('wav', entitlements)
}
