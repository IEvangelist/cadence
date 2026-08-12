/**
 * Sampled-instrument packs (issue #113, option 2) — the **lazy-loaded** bridge
 * between the pure PCM renderer and a Tone.js `Sampler`.
 *
 * This module is imported **dynamically** (see `plugins/builtins/samplerVoices.ts`),
 * exactly like the LAME MP3 encoder in `formats/mp3Export.ts`: it is code-split
 * into its own chunk and only fetched when a sampled instrument is actually
 * selected, so the base bundle carries none of it. It is the only sampled-lane
 * module that touches Web Audio (it builds `ToneAudioBuffer`s and a `Sampler`),
 * so — like `audio/offlineRender.ts` — it is excluded from jsdom unit coverage
 * and exercised in the browser; the pure renderer and the voice wiring it feeds
 * are unit-tested directly.
 *
 * Provenance / license: every sample is rendered from Cadence's own code
 * ({@link renderInstrumentSample}), so the audio is Cadence's original work,
 * dedicated to the public domain (CC0). No third-party audio is downloaded,
 * bundled, or committed. To ship a *real* CC0/public-domain WAV pack instead,
 * decode the files into `ToneAudioBuffer`s and key them by note name in
 * {@link buildSampler} — the `Sampler`, the voice, and the registry entry are
 * unchanged.
 */
import * as Tone from 'tone'
import { pitchToName } from '../../../model/project'
import {
  renderInstrumentSample,
  type SampleTimbre,
  type SampledInstrument,
} from './renderSample'

/** The anchor notes rendered for each pack. The `Sampler` repitches between them,
 * so a handful of keys spanning the range keeps the pack tiny yet playable across
 * the keyboard. */
const ANCHOR_MIDI_NOTES = [36, 48, 60, 72, 84] // C2, C3, C4, C5, C6

/** A named, renderable pack: a timbre plus the output level (dB) it plays at. */
interface PackSpec {
  timbre: SampleTimbre
  /** Output level in dB. */
  level: number
  /** Sampler attack in seconds. */
  attack: number
  /** Sampler release in seconds. */
  release: number
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

/** Build a {@link SampledInstrument} for a pack by rendering its anchor notes into
 * `ToneAudioBuffer`s and wiring them into a `Tone.Sampler` connected to `output`. */
function buildSampler(output: Tone.Gain, spec: PackSpec): SampledInstrument {
  const urls: Record<string, Tone.ToneAudioBuffer> = {}
  for (const midi of ANCHOR_MIDI_NOTES) {
    const pcm = renderInstrumentSample(midi, spec.timbre)
    urls[pitchToName(midi)] = Tone.ToneAudioBuffer.fromArray(pcm)
  }
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

/** Load the sampled acoustic grand piano. */
export function loadGrandPiano(output: Tone.Gain): SampledInstrument {
  return buildSampler(output, GRAND_PIANO)
}

/** Load the sampled electric piano. */
export function loadElectricPiano(output: Tone.Gain): SampledInstrument {
  return buildSampler(output, ELECTRIC_PIANO)
}
