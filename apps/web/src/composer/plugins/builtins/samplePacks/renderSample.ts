/**
 * Procedural multisample renderer — the pure, offline heart of the sampled
 * instrument lane (issue #113, option 2).
 *
 * Option 2 asks for **CC0 / public-domain** multisamples played back through a
 * Tone.js `Sampler`. Rather than commit megabytes of third-party audio (with the
 * license-audit and repo-weight cost that #113 flags), Cadence *renders its own*
 * samples: this module synthesizes a short PCM tone for a note from an additive
 * partial stack plus a hammer transient. Because the samples are generated from
 * original code, their provenance is unambiguous — they are Cadence's own work,
 * dedicated to the public domain (CC0) — so there is **no third-party licensing
 * question at all**, and **no binary is committed**.
 *
 * The output is a plain {@link Float32Array} of mono PCM in −1..1, so this
 * function is completely decoupled from Web Audio and is exercised directly in
 * unit tests. The browser-only step — wrapping the PCM in a `ToneAudioBuffer` and
 * handing a handful of these to a `Tone.Sampler` (which repitches between them) —
 * lives in `pianoPacks.ts`, which is lazy-imported so none of this loads until a
 * sampled instrument is actually selected.
 *
 * Dropping in a *real* CC0/public-domain WAV pack later is a drop-in: replace the
 * per-note buffer source in `pianoPacks.ts` with decoded file buffers keyed by
 * the same note names; nothing else changes.
 */

/** The minimal, Web-Audio-free surface a built sampled instrument exposes. */
export interface SampledInstrument {
  /** Play `pitch` (MIDI) for `durationSeconds` at absolute `time`, velocity 0..1. */
  trigger(pitch: number, durationSeconds: number, time: number, velocity: number): void
  /** Release audio nodes. */
  dispose(): void
}

/** Timbre knobs that shape a rendered sample's character. */
export interface SampleTimbre {
  /**
   * Relative amplitudes of the harmonic partials, index 0 = the fundamental.
   * A piano-like stack tapers quickly; a reedier voice keeps more upper partials.
   */
  partials: number[]
  /** Fundamental amplitude decay time constant, in seconds (longer = more sustain). */
  decay: number
  /** How much faster each higher partial decays relative to the fundamental (≥ 0). */
  brightness: number
  /** Slight partial stretch that reads as string inharmonicity (0 = perfectly harmonic). */
  inharmonicity: number
  /** Amount (0..1) of the short attack noise burst that reads as a hammer/pick. */
  hammer: number
}

/** Optional render settings. */
export interface RenderOptions {
  /** Output sample rate in Hz. */
  sampleRate?: number
  /** Sample length in seconds. */
  seconds?: number
  /** Seed for the deterministic hammer noise (defaults to a function of the note). */
  seed?: number
}

const DEFAULT_SAMPLE_RATE = 44100
const DEFAULT_SECONDS = 2.5

/** MIDI note number → frequency in Hz (A4 = MIDI 69 = 440 Hz). */
function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

/**
 * Render one note into a mono PCM buffer.
 *
 * The signal is a sum of decaying harmonic partials (with a little inharmonic
 * stretch), plus a brief noise transient for the attack. The result is faded out
 * at the tail and peak-normalized so every rendered note is audible but never
 * clips, regardless of how many partials sum in phase.
 *
 * Deterministic: identical inputs always produce identical samples, so the render
 * is stable to unit-test and reproducible across machines.
 */
export function renderInstrumentSample(
  midi: number,
  timbre: SampleTimbre,
  options: RenderOptions = {},
): Float32Array {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
  const seconds = options.seconds ?? DEFAULT_SECONDS
  const length = Math.max(1, Math.floor(sampleRate * seconds))
  const out = new Float32Array(length)
  const fundamental = midiToFrequency(midi)
  const nyquist = sampleRate / 2

  // A small, fast linear-congruential PRNG keeps the hammer noise deterministic
  // (seeded off the note) without pulling in any dependency.
  let state = (options.seed ?? (Math.abs(Math.floor(midi)) * 2654435761 + 1)) >>> 0
  const noise = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return (state / 0xffffffff) * 2 - 1
  }

  const hammerDecay = 0.004
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate
    let sample = 0
    for (let p = 0; p < timbre.partials.length; p += 1) {
      const amp = timbre.partials[p]
      if (amp === 0) continue
      const harmonic = p + 1
      const stretch = 1 + timbre.inharmonicity * harmonic * harmonic
      const partialFreq = fundamental * harmonic * stretch
      // Partials above Nyquist would alias; since they only climb from here, stop.
      if (partialFreq >= nyquist) break
      const partialDecay = timbre.decay / (1 + timbre.brightness * p)
      const env = Math.exp(-t / partialDecay)
      sample += amp * env * Math.sin(2 * Math.PI * partialFreq * t)
    }
    if (timbre.hammer > 0 && t < 0.02) {
      sample += timbre.hammer * Math.exp(-t / hammerDecay) * noise()
    }
    out[i] = sample
  }

  // Fade the last 20 ms to zero so the finite buffer never ends on a click.
  const fade = Math.min(length, Math.floor(sampleRate * 0.02))
  for (let i = 0; i < fade; i += 1) {
    out[length - 1 - i] *= i / fade
  }

  // Peak-normalize to a safe headroom so summed partials can't clip.
  let peak = 0
  for (let i = 0; i < length; i += 1) {
    const abs = Math.abs(out[i])
    if (abs > peak) peak = abs
  }
  if (peak > 0) {
    const gain = 0.9 / peak
    for (let i = 0; i < length; i += 1) out[i] *= gain
  }

  return out
}
