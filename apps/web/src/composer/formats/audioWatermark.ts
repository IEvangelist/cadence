/**
 * Free-tier audio watermark.
 *
 * A subtle, deterministic spread-spectrum watermark added to free-tier WAV
 * exports at the render → encode boundary. Paid exports pass through
 * byte-identically.
 *
 * Design goals (issue #8):
 *  - **Subtle**: energy sits ~60 dB below full scale, inaudible on normal
 *    material but measurably present.
 *  - **Hard to remove**: the mark is pseudo-noise spread across the whole
 *    spectrum (not a single tone a notch filter could strip), keyed by a fixed
 *    seed so it is reproducible for detection.
 *  - **Deterministic + testable**: {@link watermarkNoise} regenerates the exact
 *    additive sequence, so tests assert the precise energy added for free and a
 *    byte-identical passthrough for paid.
 *  - **Self-contained / rebase-friendly**: this is a pure
 *    `(channels, entitlement) -> channels` post-process with no dependency on
 *    exporter internals, so it drops cleanly onto whatever exporter seam effort
 *    #12 lands. It is wired in exactly one place (see `audioExport.ts`) and gated
 *    solely on the entitlement flag.
 */

/** The watermark specification — the single source of truth for its energy. */
export const WATERMARK_SPEC = {
  /**
   * Peak amplitude of the additive pseudo-noise, in the -1..1 sample range.
   * ~0.0009 ≈ -61 dBFS: subtle but deterministically detectable.
   */
  amplitude: 0.0009,
  /** Fixed PRNG seed so the mark is reproducible for detection. */
  seed: 0x9e3779b9,
} as const

/** Whether a given entitlement set watermarks exports (free = true, paid = false). */
export interface WatermarkGate {
  enabled: boolean
}

const clampSample = (value: number): number => Math.max(-1, Math.min(1, value))

/**
 * Deterministic PRNG (mulberry32). Small, fast, and stable across engines so the
 * watermark is identical wherever it runs — a property the detector relies on.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The exact additive watermark sequence for a buffer of `frameCount` samples,
 * scaled to {@link WATERMARK_SPEC}.amplitude. Exported so detection and tests can
 * reproduce it bit-for-bit.
 */
export function watermarkNoise(frameCount: number): Float32Array {
  const noise = new Float32Array(Math.max(0, frameCount))
  const next = mulberry32(WATERMARK_SPEC.seed)
  for (let i = 0; i < noise.length; i += 1) {
    // Map [0,1) → [-1,1) then scale to the (subtle) watermark amplitude.
    noise[i] = (next() * 2 - 1) * WATERMARK_SPEC.amplitude
  }
  return noise
}

/**
 * Apply the free-tier watermark to rendered channel data.
 *
 * When `gate.enabled` is false (paid), the input channels are returned unchanged
 * — same references — so the downstream encoder produces byte-identical output.
 * When true (free), each channel is returned as a new array with the deterministic
 * watermark added and clamped to the valid sample range.
 */
export function applyAudioWatermark(
  channels: Float32Array[],
  gate: WatermarkGate,
): Float32Array[] {
  if (!gate.enabled) {
    return channels
  }

  const frameCount = channels[0]?.length ?? 0
  const noise = watermarkNoise(frameCount)
  return channels.map((channel) => {
    const out = new Float32Array(channel.length)
    for (let i = 0; i < channel.length; i += 1) {
      out[i] = clampSample(channel[i] + (noise[i] ?? 0))
    }
    return out
  })
}
