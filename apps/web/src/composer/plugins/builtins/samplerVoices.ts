/**
 * Sampler-backed instrument voices (issue #113, option 2).
 *
 * These contributions add a **`Tone.Sampler` voice type** to the built-in
 * catalog: instead of synthesizing every note in real time (option 1), they play
 * back short rendered samples and repitch between them for a more realistic body.
 * The realism win is wired to two flagship keys — a sampled **grand piano** and a
 * sampled **electric piano**.
 *
 * Bundle discipline: this module is tiny and safe to keep in the base bundle —
 * it holds only metadata and a thin factory. The actual sample data, the
 * `ToneAudioBuffer`s, and the `Sampler` live in `samplePacks/pianoPacks.ts`,
 * which is **dynamically imported on first use** (mirroring how the MP3 encoder
 * in `formats/mp3Export.ts` is code-split). So selecting a sampled instrument
 * fetches the pack chunk on demand, and a project that never touches one loads
 * zero extra bytes.
 *
 * Seam discipline (#97): the audio engine builds a voice **synchronously** via
 * `createVoice`, but loading a pack is asynchronous. {@link createSamplerVoice}
 * bridges the two without touching the frozen engine: it returns a valid
 * {@link InstrumentVoice} immediately, buffers any notes that arrive before the
 * pack finishes loading, and flushes them once it's ready. Velocity flows through
 * untouched, so the sampled voices stay velocity-sensitive like every other voice.
 */
import type { InstrumentContribution, InstrumentVoice, InstrumentVoiceContext } from '../types'
import type { SampledInstrument } from './samplePacks/renderSample'

/** Loads (and connects) the concrete sampled instrument for a voice's output. */
type SampleLoader = (context: InstrumentVoiceContext) => Promise<SampledInstrument>

/**
 * Wrap an async {@link SampledInstrument} load in the synchronous
 * {@link InstrumentVoice} contract the engine expects.
 *
 * The voice is usable the instant it is created: triggers that arrive before the
 * pack loads are queued and replayed in order once it does, and `dispose()` is
 * safe at any point (before, during, or after loading). Exported for direct unit
 * testing of the buffer/flush/dispose logic.
 */
export function createSamplerVoice(
  ctx: InstrumentVoiceContext,
  load: SampleLoader,
): InstrumentVoice {
  let instrument: SampledInstrument | null = null
  let disposed = false
  const pending: Array<[number, number, number, number]> = []

  load(ctx)
    .then((loaded) => {
      // The voice was disposed while the pack was loading — throw the load away.
      if (disposed) {
        loaded.dispose()
        return
      }
      instrument = loaded
      for (const [pitch, duration, time, velocity] of pending) {
        instrument.trigger(pitch, duration, time, velocity)
      }
      pending.length = 0
    })
    .catch(() => {
      // Pack failed to load (e.g. no Web Audio available). The voice stays valid
      // and simply silent rather than throwing into the audio callback.
    })

  return {
    trigger: (pitch, duration, time, velocity) => {
      if (instrument) {
        instrument.trigger(pitch, duration, time, velocity)
      } else if (!disposed) {
        pending.push([pitch, duration, time, velocity])
      }
    },
    dispose: () => {
      disposed = true
      instrument?.dispose()
      instrument = null
      pending.length = 0
    },
  }
}

/**
 * The sampled instruments contributed by the core plugin. Each `createVoice`
 * dynamically imports the pack module, so the sample renderer + `Sampler` only
 * load when one of these is selected.
 */
export const SAMPLER_VOICE_INSTRUMENTS: InstrumentContribution[] = [
  {
    id: 'sampled-grand-piano',
    name: 'Grand Piano (Sampled)',
    kind: 'synth',
    description:
      'A sampled acoustic grand — rendered CC0 samples played through a Tone.js Sampler, lazy-loaded on demand.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      createSamplerVoice(ctx, async ({ output }) => {
        const { loadGrandPiano } = await import('./samplePacks/pianoPacks')
        return loadGrandPiano(output)
      }),
  },
  {
    id: 'sampled-electric-piano',
    name: 'Electric Piano (Sampled)',
    kind: 'synth',
    description:
      'A sampled tine electric piano — rendered CC0 samples played through a Tone.js Sampler, lazy-loaded on demand.',
    polyphonic: true,
    group: 'Keys',
    createVoice: (ctx) =>
      createSamplerVoice(ctx, async ({ output }) => {
        const { loadElectricPiano } = await import('./samplePacks/pianoPacks')
        return loadElectricPiano(output)
      }),
  },
]
