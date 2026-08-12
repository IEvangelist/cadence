import { describe, expect, it } from 'vitest'
import { renderInstrumentSample, type SampleTimbre } from './renderSample'

const PIANO: SampleTimbre = {
  partials: [1, 0.6, 0.4, 0.25, 0.15],
  decay: 1.5,
  brightness: 0.8,
  inharmonicity: 0.0004,
  hammer: 0.2,
}

// Small, fast render settings — enough samples to exercise every branch without
// generating a full 44.1 kHz buffer in the unit run.
const fast = { sampleRate: 8000, seconds: 0.1 }

describe('renderInstrumentSample', () => {
  it('renders a mono PCM buffer of the requested length', () => {
    const pcm = renderInstrumentSample(60, PIANO, fast)
    expect(pcm).toBeInstanceOf(Float32Array)
    expect(pcm.length).toBe(Math.floor(8000 * 0.1))
  })

  it('produces an audible, non-clipping, finite signal', () => {
    const pcm = renderInstrumentSample(60, PIANO, fast)
    let peak = 0
    for (const v of pcm) {
      expect(Number.isFinite(v)).toBe(true)
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    // Peak-normalized to 0.9 headroom: audible but never clipping.
    expect(peak).toBeGreaterThan(0.5)
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6)
  })

  it('fades the tail to silence so the buffer never ends on a click', () => {
    const pcm = renderInstrumentSample(60, PIANO, fast)
    expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(1e-6)
  })

  it('is deterministic for identical inputs', () => {
    const a = renderInstrumentSample(60, PIANO, fast)
    const b = renderInstrumentSample(60, PIANO, fast)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('renders different notes to different samples', () => {
    const low = renderInstrumentSample(48, PIANO, fast)
    const high = renderInstrumentSample(72, PIANO, fast)
    expect(Array.from(low)).not.toEqual(Array.from(high))
  })

  it('drops partials above Nyquist without producing NaNs', () => {
    // A very high note pushes every partial past Nyquist for this low rate; the
    // renderer must stop cleanly rather than alias or emit NaN.
    const pcm = renderInstrumentSample(120, PIANO, { sampleRate: 8000, seconds: 0.05 })
    for (const v of pcm) expect(Number.isFinite(v)).toBe(true)
  })

  it('returns exact silence when the timbre has no partials and no hammer', () => {
    const silent: SampleTimbre = {
      partials: [0, 0],
      decay: 1,
      brightness: 1,
      inharmonicity: 0,
      hammer: 0,
    }
    const pcm = renderInstrumentSample(60, silent, fast)
    expect(pcm.every((v) => v === 0)).toBe(true)
  })
})
