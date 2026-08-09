import { describe, expect, it } from 'vitest'
import { encodeWav } from './audioExport'
import {
  WATERMARK_SPEC,
  applyAudioWatermark,
  watermarkNoise,
} from './audioWatermark'

const makeChannel = (frames: number, fill = 0): Float32Array => {
  const channel = new Float32Array(frames)
  channel.fill(fill)
  return channel
}

describe('watermarkNoise', () => {
  it('is deterministic for a given length', () => {
    const a = watermarkNoise(256)
    const b = watermarkNoise(256)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('stays within the subtle watermark amplitude', () => {
    const noise = watermarkNoise(1024)
    for (const value of noise) {
      expect(Math.abs(value)).toBeLessThanOrEqual(WATERMARK_SPEC.amplitude)
    }
    // And it actually carries energy (not all zeros).
    const energy = noise.reduce((sum, v) => sum + v * v, 0)
    expect(energy).toBeGreaterThan(0)
  })
})

describe('applyAudioWatermark — free tier (enabled)', () => {
  it('adds the exact deterministic watermark sequence per channel', () => {
    const frames = 512
    const left = makeChannel(frames, 0)
    const right = makeChannel(frames, 0)
    const noise = watermarkNoise(frames)

    const [wLeft, wRight] = applyAudioWatermark([left, right], { enabled: true })

    // Silent input + watermark == the watermark sequence itself.
    expect(Array.from(wLeft)).toEqual(Array.from(noise))
    expect(Array.from(wRight)).toEqual(Array.from(noise))
  })

  it('adds measurable energy relative to the untouched signal', () => {
    const frames = 2048
    const signal = makeChannel(frames, 0)
    const [watermarked] = applyAudioWatermark([signal], { enabled: true })

    const addedEnergy = watermarked.reduce((sum, v) => sum + v * v, 0)
    expect(addedEnergy).toBeGreaterThan(0)
  })

  it('does not mutate the input channels', () => {
    const frames = 64
    const input = makeChannel(frames, 0.25)
    const snapshot = Array.from(input)

    applyAudioWatermark([input], { enabled: true })

    expect(Array.from(input)).toEqual(snapshot)
  })

  it('clamps into the valid -1..1 sample range', () => {
    const frames = 128
    const hot = makeChannel(frames, 1)
    const [watermarked] = applyAudioWatermark([hot], { enabled: true })
    for (const value of watermarked) {
      expect(value).toBeGreaterThanOrEqual(-1)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe('applyAudioWatermark — paid tier (disabled)', () => {
  it('returns the input channels unchanged (same references)', () => {
    const channels = [makeChannel(256, 0.1), makeChannel(256, -0.1)]
    const result = applyAudioWatermark(channels, { enabled: false })
    expect(result).toBe(channels)
    expect(result[0]).toBe(channels[0])
    expect(result[1]).toBe(channels[1])
  })

  it('encodes byte-identically to an un-watermarked export', () => {
    // A non-trivial signal so any added energy would change the bytes.
    const frames = 500
    const channel = new Float32Array(frames)
    for (let i = 0; i < frames; i += 1) channel[i] = Math.sin(i / 5) * 0.5

    const clean = encodeWav([channel], 44100)
    const paid = encodeWav(
      applyAudioWatermark([channel], { enabled: false }),
      44100,
    )
    const free = encodeWav(
      applyAudioWatermark([channel], { enabled: true }),
      44100,
    )

    expect(Array.from(paid)).toEqual(Array.from(clean))
    // Sanity: the free export is NOT byte-identical (watermark present).
    expect(Array.from(free)).not.toEqual(Array.from(clean))
    expect(free.length).toBe(clean.length)
  })
})
