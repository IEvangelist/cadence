/**
 * On-demand remote pack loader (issue #143 — option 3 of #113).
 *
 * This is the *transport + fallback* half of on-demand packs, kept deliberately
 * free of Web Audio so it can be unit-tested with mocked `fetch`/decode. It sits
 * behind the same code-split boundary as the rest of the sampled lane: it is
 * imported only by the lazy `pianoPacks.ts`, which is itself reached through
 * `await import('./samplePacks/pianoPacks')`, so a project that never selects a
 * sampled instrument loads zero added bytes.
 *
 * Two pieces:
 *  - {@link fetchRemoteBuffers} fetches every file for a pack and decodes each into
 *    a `ToneAudioBuffer` keyed by note name (decoding is injected so the actual
 *    Web-Audio binding lives in `pianoPacks.ts`);
 *  - {@link resolvePackBuffers} makes the graceful-fallback decision: use the CDN
 *    when one is configured and every file loads, otherwise fall back to the
 *    procedural CC0 pack and never throw into the audio path (preserving the #97
 *    RMS>0 guarantee). The build/render/remote strategies are injected so the
 *    decision is testable without Web Audio.
 */
import type { ToneAudioBuffer } from 'tone'
import type { SampledInstrument } from './renderSample'
import { resolveRemoteUrls, type SamplePackManifest } from './packManifest'

/** A note-keyed map of decoded audio buffers, as a `Tone.Sampler` consumes. */
export type NoteBuffers = Record<string, ToneAudioBuffer>

/** The subset of `fetch` this loader needs (string URL in, `Response` out). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Decode fetched bytes into a `ToneAudioBuffer` (the one Web-Audio-bound step). */
export type DecodeAudio = (data: ArrayBuffer) => Promise<ToneAudioBuffer>

/** Injected transport for {@link fetchRemoteBuffers}. */
export interface RemoteFetchDeps {
  fetch: FetchLike
  decode: DecodeAudio
}

/**
 * Fetch and decode every file in `urls` into a note-keyed buffer map. Files are
 * fetched in parallel; a non-OK response or a decode failure rejects the whole
 * load so the caller can fall back to the procedural pack rather than play a
 * partially-loaded instrument.
 */
export async function fetchRemoteBuffers(
  urls: Record<string, string>,
  deps: RemoteFetchDeps,
): Promise<NoteBuffers> {
  const entries = await Promise.all(
    Object.entries(urls).map(async ([note, url]) => {
      const response = await deps.fetch(url)
      if (!response.ok) {
        throw new Error(`sample "${note}" fetch failed (${response.status}) from ${url}`)
      }
      const data = await response.arrayBuffer()
      return [note, await deps.decode(data)] as const
    }),
  )
  return Object.fromEntries(entries)
}

/**
 * The concrete strategies {@link resolvePackBuffers} chooses between. Injecting
 * them keeps the fallback decision pure and unit-testable: the real
 * implementations (fetch+decode, procedural render, `Sampler` build) live in the
 * Web-Audio-bound `pianoPacks.ts`.
 */
export interface PackBuildSources {
  /** Fetch+decode the remote pack (rejects on any failure). */
  loadRemote: (urls: Record<string, string>) => Promise<NoteBuffers>
  /** Render the procedural CC0 fallback buffers. */
  renderProcedural: () => NoteBuffers
  /** Build the playable {@link SampledInstrument} from a buffer map. */
  build: (buffers: NoteBuffers) => SampledInstrument
  /** Optional dev-only sink for the "fell back" warning. */
  warn?: (manifest: SamplePackManifest, error: unknown) => void
}

/**
 * Resolve the buffers for a pack and build its instrument, preferring the CDN and
 * falling back to the procedural pack.
 *
 * The remote path is attempted only when the manifest has a remote source *and* a
 * CDN base is configured (via {@link resolveRemoteUrls}); otherwise the procedural
 * pack is built directly with no fetch. Any fetch/decode error is swallowed (after
 * an optional dev warning) and the procedural pack is used, so selecting a pack can
 * never throw into the audio callback.
 */
export async function resolvePackBuffers(
  manifest: SamplePackManifest,
  baseUrl: string,
  sources: PackBuildSources,
): Promise<SampledInstrument> {
  const urls = resolveRemoteUrls(manifest, baseUrl)
  if (urls) {
    try {
      return sources.build(await sources.loadRemote(urls))
    } catch (error) {
      sources.warn?.(manifest, error)
    }
  }
  return sources.build(sources.renderProcedural())
}
