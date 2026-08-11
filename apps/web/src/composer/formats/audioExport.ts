/**
 * Audio export — render a project to a downloadable WAV.
 *
 * Split into two concerns so the whole path stays unit-testable without Web
 * Audio:
 *
 *  - {@link encodeWav} is a pure PCM-16 RIFF/WAVE encoder over raw channel data.
 *  - {@link renderProjectToWav} orchestrates "render → encode". The actual
 *    offline render is injected (`renderOffline`); the default binds to
 *    `Tone.Offline` (see `audio/offlineRender.ts`), while tests pass a tiny mock
 *    so the round-trip runs under jsdom/CI.
 *
 * WAV is the lossless option; MP3 export is a sibling module (`mp3Export.ts`)
 * that reuses this same render → watermark → encode split (see
 * {@link defaultRenderOffline}, which both formats share).
 */
import { type Project } from '../model/project'
import { beatsToSeconds } from '../timing/timing'
import { applyAudioWatermark } from './audioWatermark'

/** Rendered audio: one Float32Array of samples (-1..1) per channel. */
export interface RenderedAudio {
  sampleRate: number
  /** Non-empty array of equal-length channels. */
  channels: Float32Array[]
}

/** Signature of an offline renderer (injected so it can be mocked in tests). */
export type OfflineRenderer = (
  project: Project,
  durationSeconds: number,
  sampleRate: number,
) => Promise<RenderedAudio>

const clampSample = (value: number): number => Math.max(-1, Math.min(1, value))

/**
 * Encode interleaved PCM-16 WAV bytes from per-channel float samples.
 *
 * The header is a standard 44-byte RIFF/WAVE `fmt `/`data` layout, so the output
 * plays in any browser, DAW, or media player.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = Math.max(1, channels.length)
  const frameCount = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = channelCount * bytesPerSample
  const dataSize = frameCount * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, channelCount, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clampSample(channels[channel]?.[frame] ?? 0)
      // Asymmetric scaling for the -1..1 → int16 range.
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += bytesPerSample
    }
  }

  return new Uint8Array(buffer)
}

/** The last sounding beat in the project (0 when there are no notes). */
export function projectEndBeats(project: Project): number {
  let end = 0
  for (const track of project.tracks) {
    for (const note of track.notes) {
      end = Math.max(end, note.start + note.duration)
    }
  }
  return Math.max(end, project.lengthBeats)
}

/** Options for {@link renderProjectToWav}. */
export interface RenderWavOptions {
  sampleRate?: number
  /** Seconds of silence appended so release tails aren't clipped. */
  tailSeconds?: number
  /** Injected offline renderer; defaults to the Tone.Offline implementation. */
  renderOffline?: OfflineRenderer
  /**
   * Whether to apply the free-tier audio watermark. Defaults to `true` (the safe
   * default: free unless a paid entitlement explicitly clears it). Paid callers
   * pass `false` for a byte-clean export.
   */
  watermark?: boolean
}

/**
 * Render a project to WAV bytes. Returns the encoded file plus the rendered
 * duration so callers/tests can assert length.
 */
export async function renderProjectToWav(
  project: Project,
  options: RenderWavOptions = {},
): Promise<{ bytes: Uint8Array; durationSeconds: number; sampleRate: number }> {
  const sampleRate = options.sampleRate ?? 44100
  const tailSeconds = options.tailSeconds ?? 1
  const renderOffline = options.renderOffline ?? defaultRenderOffline
  const durationSeconds =
    beatsToSeconds(projectEndBeats(project), project.tempo) + tailSeconds

  const rendered = await renderOffline(project, durationSeconds, sampleRate)
  // Free-tier watermark is a self-contained post-process applied at the
  // render → encode boundary, gated purely on the entitlement flag. Paid
  // exports (watermark:false) pass through byte-identically.
  const channels = applyAudioWatermark(rendered.channels, {
    enabled: options.watermark ?? true,
  })
  const bytes = encodeWav(channels, rendered.sampleRate)
  return { bytes, durationSeconds, sampleRate: rendered.sampleRate }
}

let cachedRenderer: OfflineRenderer | null = null

/**
 * Lazily import the real Tone.Offline renderer so its Web-Audio dependency never
 * loads under jsdom/tests (where a mock renderer is injected instead). Shared by
 * both the WAV and MP3 exporters so they render identically.
 */
export async function defaultRenderOffline(
  project: Project,
  durationSeconds: number,
  sampleRate: number,
): Promise<RenderedAudio> {
  if (!cachedRenderer) {
    const module = await import('../audio/offlineRender')
    cachedRenderer = module.renderProjectOffline
  }
  return cachedRenderer(project, durationSeconds, sampleRate)
}
