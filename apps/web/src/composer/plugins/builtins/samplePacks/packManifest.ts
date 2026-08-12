/**
 * Sample-pack manifests + CDN resolution (issue #143 — option 3 of #113).
 *
 * Options 1 & 2 (#113) shipped the reusable Sampler architecture: a `Tone.Sampler`
 * voice fed by anchor-note `ToneAudioBuffer`s keyed by note name, lazy-loaded and
 * code-split. Option 3 keeps the repo light by *not* committing large audio and
 * instead lets an operator serve multisample packs from a **CDN / object store**,
 * fetched on demand the first time a sampled instrument plays.
 *
 * This module is the pure, Web-Audio-free description of that seam:
 *  - a {@link SamplePackManifest} names a pack, carries the procedural {@link PackSpec}
 *    (always present, so there is always an offline fallback), and *optionally* a
 *    {@link RemotePackSource} describing where its WAV files live under a CDN;
 *  - {@link samplePackCdnBaseUrl} reads the configurable CDN base from Vite env,
 *    mirroring how the rest of `apps/web` reads config (e.g. `remoteStore.ts`
 *    reads `VITE_API_BASE_URL`);
 *  - {@link resolveRemoteUrls} turns a manifest + base URL into note-keyed absolute
 *    URLs, or `null` when there is nothing remote to fetch.
 *
 * Licensing discipline (#108/#113): the shipped default is the **CC0 procedural
 * own-work pack** — no third-party audio is bundled or committed. A remote pack
 * fetched at runtime is the operator's own content; when no CDN is configured the
 * behavior is byte-identical to the procedural pack, so tests/e2e stay deterministic
 * offline and `THIRD-PARTY-NOTICES.md` stays unchanged.
 *
 * It is imported only by the lazy, code-split `pianoPacks.ts`, so none of this
 * loads until a sampled instrument is actually selected.
 */
import type { SampleTimbre } from './renderSample'

/**
 * The anchor notes each pack provides. The `Sampler` repitches between them, so a
 * handful spanning the range keeps a pack tiny yet playable across the keyboard.
 * The procedural renderer and any remote pack use these same note names as keys.
 */
export const ANCHOR_MIDI_NOTES = [36, 48, 60, 72, 84] // C2, C3, C4, C5, C6

/** A named, renderable pack: a timbre plus the sampler envelope/level it plays at. */
export interface PackSpec {
  timbre: SampleTimbre
  /** Output level in dB. */
  level: number
  /** Sampler attack in seconds. */
  attack: number
  /** Sampler release in seconds. */
  release: number
}

/**
 * A remote (CDN-hosted) source for a pack's samples.
 *
 * `files` is the note-name → file-name map the option-3 issue calls for: its keys
 * must match the pack's anchor note names (e.g. `C4`) so decoded buffers line up
 * with the `Sampler`, and its values are file names resolved under `basePath`.
 */
export interface RemotePackSource {
  /** Path segment appended to the CDN base URL, e.g. `grand-piano`. */
  basePath: string
  /** Map of note name (e.g. `C4`) → file name (e.g. `C4.wav`) under `basePath`. */
  files: Record<string, string>
}

/**
 * A pack the sampled-instrument lane can load: sampler params + procedural spec
 * (always), plus an optional remote source used only when a CDN is configured.
 */
export interface SamplePackManifest {
  /** Stable id, matching the instrument contribution id. */
  id: string
  /** Human-readable pack name. */
  name: string
  /** Procedural spec — the always-available CC0 own-work fallback. */
  spec: PackSpec
  /** Optional CDN source; when present *and* a CDN is configured, buffers are fetched. */
  remote?: RemotePackSource
}

/** A warm acoustic grand: strong fundamental over quickly-tapering partials, a
 * long ringing decay, a touch of string inharmonicity, and a hammer transient. */
const GRAND_PIANO: PackSpec = {
  timbre: {
    partials: [1, 0.62, 0.42, 0.26, 0.18, 0.12, 0.08, 0.05],
    decay: 2.1,
    brightness: 0.85,
    inharmonicity: 0.0004,
    hammer: 0.22,
  },
  level: -6,
  attack: 0.002,
  release: 0.5,
}

/** A mellow tine electric piano: a bell-like partial mix, shorter ring, and a
 * softer strike — distinct from the acoustic grand while sharing the renderer. */
const ELECTRIC_PIANO: PackSpec = {
  timbre: {
    partials: [1, 0.18, 0.65, 0.12, 0.3, 0.08],
    decay: 1.5,
    brightness: 0.7,
    inharmonicity: 0.0009,
    hammer: 0.12,
  },
  level: -8,
  attack: 0.002,
  release: 0.4,
}

/** Anchor note names (`C2`…`C6`) → `<name>.wav`, the convention a hosted pack follows. */
const ANCHOR_WAV_FILES: Record<string, string> = {
  C2: 'C2.wav',
  C3: 'C3.wav',
  C4: 'C4.wav',
  C5: 'C5.wav',
  C6: 'C6.wav',
}

/**
 * The two flagship sampled keys, now remote-capable. Each keeps its procedural
 * spec (the shipped CC0 default) and adds a remote descriptor so that, *when a CDN
 * is configured*, its anchor WAVs are fetched from `${CDN}/<basePath>/<file>`.
 * With no CDN configured they resolve to the procedural pack — byte-identical to
 * before — so the catalog does not grow and offline behavior is unchanged.
 */
export const GRAND_PIANO_MANIFEST: SamplePackManifest = {
  id: 'sampled-grand-piano',
  name: 'Grand Piano (Sampled)',
  spec: GRAND_PIANO,
  remote: { basePath: 'grand-piano', files: ANCHOR_WAV_FILES },
}

export const ELECTRIC_PIANO_MANIFEST: SamplePackManifest = {
  id: 'sampled-electric-piano',
  name: 'Electric Piano (Sampled)',
  spec: ELECTRIC_PIANO,
  remote: { basePath: 'electric-piano', files: ANCHOR_WAV_FILES },
}

/**
 * The configurable CDN base URL for on-demand sample packs, read from Vite env
 * (`VITE_SAMPLE_PACK_CDN`) exactly like the API base URL elsewhere. Trailing
 * slashes are trimmed; unset/whitespace yields `''`, which downstream treats as
 * "no CDN — use the procedural pack".
 */
export function samplePackCdnBaseUrl(): string {
  const configured = import.meta.env?.VITE_SAMPLE_PACK_CDN as string | undefined
  return (configured ?? '').trim().replace(/\/+$/, '')
}

/**
 * Resolve a manifest's remote files into note-keyed absolute URLs under `baseUrl`,
 * or `null` when there is nothing remote to fetch — i.e. the manifest has no remote
 * source, or no CDN base is configured. A `null` result is the signal to fall back
 * to the procedural pack.
 */
export function resolveRemoteUrls(
  manifest: SamplePackManifest,
  baseUrl: string,
): Record<string, string> | null {
  if (!manifest.remote || !baseUrl) return null
  const { basePath, files } = manifest.remote
  const prefix = basePath ? `${baseUrl}/${basePath}` : baseUrl
  const urls: Record<string, string> = {}
  for (const [note, file] of Object.entries(files)) {
    urls[note] = `${prefix}/${file}`
  }
  return urls
}
