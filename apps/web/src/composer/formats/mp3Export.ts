/**
 * MP3 audio export — the lossy sibling of `audioExport.ts` (issue #121).
 *
 * It reuses the exact render → watermark → encode split so an MP3 export sounds
 * like a WAV export and carries the same free-tier watermark:
 *
 *  - {@link encodeMp3} is a pure float-PCM → MP3 encoder (CBR) over raw channel
 *    data, so the whole path stays unit-testable without Web Audio.
 *  - {@link renderProjectToMp3} orchestrates "render → watermark → encode",
 *    reusing the shared offline renderer ({@link defaultRenderOffline}) and the
 *    shared watermark ({@link applyAudioWatermark}) from the WAV path.
 *
 * The encoder is a maintained, exact-pinned build of the LAME MP3 encoder
 * (`@breezystack/lamejs`, a pure-JS port — LGPL-3.0). It consumes interleaved
 * PCM-16, mirroring {@link encodeWav}, and runs identically in Node/jsdom and the
 * browser, so the encode is exercised for real in unit tests (no WASM/worker that
 * would force a browser-only path). This module is lazy-imported from the export
 * handler, so LAME only loads when MP3 is actually exported.
 */
import { Mp3Encoder } from '@breezystack/lamejs'
import { type Project } from '../model/project'
import { beatsToSeconds } from '../timing/timing'
import { applyAudioWatermark } from './audioWatermark'
import {
  type OfflineRenderer,
  defaultRenderOffline,
  projectEndBeats,
} from './audioExport'

/** Default constant bitrate (kbps). 192 is a sensible, transparent-enough CBR. */
export const DEFAULT_MP3_BITRATE_KBPS = 192

/** LAME processes audio one MPEG frame (1152 samples/channel) at a time. */
const MP3_FRAME_SAMPLES = 1152

const clampSample = (value: number): number => Math.max(-1, Math.min(1, value))

/** Convert a -1..1 float channel to PCM-16, matching {@link encodeWav}'s scaling. */
function toPcm16(channel: Float32Array): Int16Array {
  const out = new Int16Array(channel.length)
  for (let i = 0; i < channel.length; i += 1) {
    const sample = clampSample(channel[i] ?? 0)
    // Asymmetric scaling for the -1..1 → int16 range (same as the WAV encoder).
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return out
}

/** Concatenate the per-frame MP3 byte chunks into one contiguous buffer. */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const chunk of chunks) total += chunk.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Options for {@link encodeMp3}. */
export interface EncodeMp3Options {
  /** Constant bitrate in kbps. Defaults to {@link DEFAULT_MP3_BITRATE_KBPS}. */
  bitrateKbps?: number
}

/**
 * Encode CBR MP3 bytes from per-channel float samples.
 *
 * Mono and stereo are supported (extra channels are ignored — MP3 is at most
 * stereo). The output is a standard MPEG-1 Layer III stream whose first frame
 * begins with the `0xFF 0xEx` frame sync, so it plays in any browser or player.
 */
export function encodeMp3(
  channels: Float32Array[],
  sampleRate: number,
  options: EncodeMp3Options = {},
): Uint8Array {
  const bitrateKbps = options.bitrateKbps ?? DEFAULT_MP3_BITRATE_KBPS
  const channelCount = Math.min(2, Math.max(1, channels.length))
  const frameCount = channels[0]?.length ?? 0
  const encoder = new Mp3Encoder(channelCount, sampleRate, bitrateKbps)

  const left = toPcm16(channels[0] ?? new Float32Array(0))
  const right =
    channelCount > 1 ? toPcm16(channels[1] ?? new Float32Array(frameCount)) : undefined

  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < frameCount; offset += MP3_FRAME_SAMPLES) {
    const leftBlock = left.subarray(offset, offset + MP3_FRAME_SAMPLES)
    const chunk = right
      ? encoder.encodeBuffer(leftBlock, right.subarray(offset, offset + MP3_FRAME_SAMPLES))
      : encoder.encodeBuffer(leftBlock)
    if (chunk.length > 0) chunks.push(chunk)
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)

  return concatChunks(chunks)
}

/** Options for {@link renderProjectToMp3}. Mirrors `RenderWavOptions`. */
export interface RenderMp3Options {
  sampleRate?: number
  /** Seconds of silence appended so release tails aren't clipped. */
  tailSeconds?: number
  /** Injected offline renderer; defaults to the shared Tone.Offline implementation. */
  renderOffline?: OfflineRenderer
  /**
   * Whether to apply the free-tier audio watermark. Defaults to `true` (the safe
   * default: free unless a paid entitlement explicitly clears it). Paid callers
   * pass `false` for a byte-clean export. Applied to the PCM *before* encoding,
   * exactly like the WAV path.
   */
  watermark?: boolean
  /** Constant bitrate in kbps. Defaults to {@link DEFAULT_MP3_BITRATE_KBPS}. */
  bitrateKbps?: number
}

/**
 * Render a project to MP3 bytes. Returns the encoded file plus the rendered
 * duration so callers/tests can assert length. This consumes the SAME offline
 * render as the WAV path and applies the watermark pre-encode, so free-tier MP3s
 * are watermarked and paid MP3s are clean — full entitlement parity with WAV.
 */
export async function renderProjectToMp3(
  project: Project,
  options: RenderMp3Options = {},
): Promise<{ bytes: Uint8Array; durationSeconds: number; sampleRate: number }> {
  const sampleRate = options.sampleRate ?? 44100
  const tailSeconds = options.tailSeconds ?? 1
  const renderOffline = options.renderOffline ?? defaultRenderOffline
  const durationSeconds =
    beatsToSeconds(projectEndBeats(project), project.tempo) + tailSeconds

  const rendered = await renderOffline(project, durationSeconds, sampleRate)
  // Free-tier watermark is applied at the render → encode boundary, gated purely
  // on the entitlement flag — identical to WAV. Paid exports (watermark:false)
  // pass through to the encoder unchanged.
  const channels = applyAudioWatermark(rendered.channels, {
    enabled: options.watermark ?? true,
  })
  const bytes = encodeMp3(channels, rendered.sampleRate, {
    bitrateKbps: options.bitrateKbps,
  })
  return { bytes, durationSeconds, sampleRate: rendered.sampleRate }
}
