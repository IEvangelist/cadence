/**
 * Audio-export entitlement contract for effort #72.
 *
 * Export gating MUST read the existing billing `Entitlements.watermarkExports`
 * flag — do NOT introduce a parallel entitlement/tier model. This mirrors the
 * AI gate ({@link AiEntitlementView} in `contract/ai.ts`): a published view that
 * turns the server-authoritative entitlement set into a single export decision.
 *
 * WAV is the only rendered-audio export (MP3 is intentionally unsupported, and
 * MIDI/MusicXML/project/plugin formats are not audio), so `wav` is currently the
 * sole export action; the seam stays action-shaped so new audio formats can join
 * without a new gating model.
 */
import type { Entitlements } from '../../billing/entitlementsClient'

/** Audio export actions whose output is entitlement-gated for the watermark. */
export type ExportAction = 'wav'

export interface ExportEntitlementView {
  /**
   * Whether an audio export of `action` for this entitlement set carries the
   * free-tier watermark. Free (or any entitlement that does not explicitly clear
   * the flag) → `true`; a resolved paid entitlement with `watermarkExports:
   * false` → `false` (byte-clean export).
   */
  appliesWatermark(action: ExportAction, entitlements: Entitlements): boolean
}
