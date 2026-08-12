/**
 * Sampled-instrument packs (issue #113 options 1&2, extended by #143 option 3) —
 * the **lazy-loaded**, Web-Audio-bound bridge between pack buffers and a Tone.js
 * `Sampler`.
 *
 * This module is imported **dynamically** (see `plugins/builtins/samplerVoices.ts`),
 * exactly like the LAME MP3 encoder in `formats/mp3Export.ts`: it is code-split
 * into its own chunk and only fetched when a sampled instrument is actually
 * selected, so the base bundle carries none of it. It is the only sampled-lane
 * module that touches Web Audio (it builds/decodes `ToneAudioBuffer`s and a
 * `Sampler`), so — like `audio/offlineRender.ts` — it is excluded from jsdom unit
 * coverage and exercised in the browser; the pure renderer, the manifest/CDN
 * resolution (`packManifest.ts`), and the fetch/fallback logic (`remoteLoader.ts`)
 * it feeds are all unit-tested directly.
 *
 * On-demand delivery (#143): a pack's buffers come from the CDN when one is
 * configured (`VITE_SAMPLE_PACK_CDN`) and every anchor WAV loads, and otherwise
 * from the procedural renderer. The decision lives in {@link resolvePackBuffers};
 * this file only supplies the concrete Web-Audio strategies.
 *
 * Provenance / license: the shipped default is rendered from Cadence's own code
 * ({@link renderInstrumentSample}), so the audio is Cadence's original work,
 * dedicated to the public domain (CC0) — **no third-party audio is downloaded,
 * bundled, or committed**. A remote pack fetched at runtime from an operator's CDN
 * is that operator's content; the default remains CC0, so `THIRD-PARTY-NOTICES.md`
 * and the in-app acknowledgements are unaffected.
 */
import * as Tone from 'tone'
import { pitchToName } from '../../../model/project'
import { renderInstrumentSample, type SampledInstrument } from './renderSample'
import {
  ANCHOR_MIDI_NOTES,
  GRAND_PIANO_MANIFEST,
  ELECTRIC_PIANO_MANIFEST,
  samplePackCdnBaseUrl,
  type PackSpec,
  type SamplePackManifest,
} from './packManifest'
import {
  fetchRemoteBuffers,
  resolvePackBuffers,
  type NoteBuffers,
} from './remoteLoader'

/** Render a pack's anchor notes into note-keyed `ToneAudioBuffer`s (the CC0 fallback). */
function renderProceduralBuffers(spec: PackSpec): NoteBuffers {
  const urls: NoteBuffers = {}
  for (const midi of ANCHOR_MIDI_NOTES) {
    urls[pitchToName(midi)] = Tone.ToneAudioBuffer.fromArray(
      renderInstrumentSample(midi, spec.timbre),
    )
  }
  return urls
}

/** Fetch+decode a WAV into a `ToneAudioBuffer` — the one Web-Audio-bound step of a
 * remote load, injected into {@link fetchRemoteBuffers}. */
async function decodeToneBuffer(data: ArrayBuffer): Promise<Tone.ToneAudioBuffer> {
  const audioBuffer = await Tone.getContext().decodeAudioData(data)
  return new Tone.ToneAudioBuffer(audioBuffer)
}

/** Wire note-keyed buffers into a `Tone.Sampler` connected to `output`. Shared by
 * the procedural and remote paths, so both sound identical apart from the source. */
function buildSamplerFromBuffers(
  output: Tone.Gain,
  spec: PackSpec,
  urls: NoteBuffers,
): SampledInstrument {
  const sampler = new Tone.Sampler({
    urls,
    attack: spec.attack,
    release: spec.release,
  }).connect(output)
  sampler.volume.value = spec.level
  return {
    trigger: (pitch, durationSeconds, time, velocity) => {
      sampler.triggerAttackRelease(pitchToName(pitch), durationSeconds, time, velocity)
    },
    dispose: () => sampler.dispose(),
  }
}

/**
 * Load a pack, preferring the configured CDN and gracefully falling back to the
 * procedural CC0 pack when no CDN is set or a fetch/decode fails. Never throws into
 * the audio path; the dev-only warning surfaces a failed remote load without
 * breaking playback.
 */
function loadSampledPack(
  output: Tone.Gain,
  manifest: SamplePackManifest,
): Promise<SampledInstrument> {
  return resolvePackBuffers(manifest, samplePackCdnBaseUrl(), {
    loadRemote: (urls) =>
      fetchRemoteBuffers(urls, {
        fetch: (url, init) => globalThis.fetch(url, init),
        decode: decodeToneBuffer,
      }),
    renderProcedural: () => renderProceduralBuffers(manifest.spec),
    build: (buffers) => buildSamplerFromBuffers(output, manifest.spec, buffers),
    warn: import.meta.env?.DEV
      ? (m, error) =>
          console.warn(
            `[cadence] sample pack "${m.id}" could not load from the CDN; using the built-in procedural pack.`,
            error,
          )
      : undefined,
  })
}

/** Load the sampled acoustic grand piano (CDN when configured, else procedural). */
export function loadGrandPiano(output: Tone.Gain): Promise<SampledInstrument> {
  return loadSampledPack(output, GRAND_PIANO_MANIFEST)
}

/** Load the sampled electric piano (CDN when configured, else procedural). */
export function loadElectricPiano(output: Tone.Gain): Promise<SampledInstrument> {
  return loadSampledPack(output, ELECTRIC_PIANO_MANIFEST)
}
