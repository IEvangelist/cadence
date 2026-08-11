import { describe, expect, it, vi } from 'vitest'
import { createDemoProject, createEmptyProject } from '../model/project'
import { beatsToSeconds } from '../timing/timing'
import { type OfflineRenderer, type RenderedAudio, projectEndBeats } from './audioExport'
import { DEFAULT_MP3_BITRATE_KBPS, encodeMp3, renderProjectToMp3 } from './mp3Export'

/** A -1..1 sine, so encodes carry real signal (not just silence). */
function sine(freq: number, sampleRate: number, frames: number, gain = 0.6): Float32Array {
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * gain
  }
  return out
}

/** Index of the first MPEG frame sync (`0xFF 0xEx`), or -1 if absent. */
function frameSyncIndex(bytes: Uint8Array): number {
  for (let i = 0; i + 1 < bytes.length; i += 1) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) return i
  }
  return -1
}

/** Byte-for-byte equality, avoiding Node's Buffer (not typed under jsdom). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

describe('encodeMp3', () => {
  it('encodes a known PCM buffer to a non-empty MP3 with a valid frame sync header', () => {
    const sampleRate = 44100
    const mono = sine(440, sampleRate, sampleRate) // 1 second
    const bytes = encodeMp3([mono], sampleRate)

    expect(bytes.length).toBeGreaterThan(0)
    // Definition of done: the stream opens with the MP3 frame sync 0xFF 0xEx.
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1] & 0xe0).toBe(0xe0)
    expect(frameSyncIndex(bytes)).toBe(0)
  })

  it('encodes stereo input', () => {
    const sampleRate = 44100
    const left = sine(440, sampleRate, sampleRate / 2)
    const right = sine(554, sampleRate, sampleRate / 2)
    const bytes = encodeMp3([left, right], sampleRate)

    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1] & 0xe0).toBe(0xe0)
  })

  it('produces a larger stream at a higher bitrate', () => {
    const sampleRate = 44100
    const mono = sine(440, sampleRate, sampleRate)
    const low = encodeMp3([mono], sampleRate, { bitrateKbps: 96 })
    const high = encodeMp3([mono], sampleRate, { bitrateKbps: 320 })
    expect(high.length).toBeGreaterThan(low.length)
  })

  it('defaults to a 192 kbps CBR', () => {
    expect(DEFAULT_MP3_BITRATE_KBPS).toBe(192)
    const sampleRate = 44100
    const mono = sine(440, sampleRate, sampleRate)
    const byDefault = encodeMp3([mono], sampleRate)
    const explicit = encodeMp3([mono], sampleRate, { bitrateKbps: 192 })
    expect(byDefault.length).toBe(explicit.length)
  })
})

describe('renderProjectToMp3', () => {
  it('renders a non-empty MP3 of the expected duration with a valid header', async () => {
    const sampleRate = 44100
    const mockRender: OfflineRenderer = vi.fn(
      async (_project, durationSeconds, rate): Promise<RenderedAudio> => {
        const frames = Math.round(durationSeconds * rate)
        return { sampleRate: rate, channels: [sine(440, rate, frames)] }
      },
    )

    const demo = createDemoProject('demo')
    const result = await renderProjectToMp3(demo, {
      sampleRate,
      tailSeconds: 0,
      renderOffline: mockRender,
    })

    const expectedSeconds = beatsToSeconds(projectEndBeats(demo), demo.tempo)
    expect(result.durationSeconds).toBeCloseTo(expectedSeconds, 5)
    expect(result.sampleRate).toBe(sampleRate)
    expect(mockRender).toHaveBeenCalledOnce()
    expect(result.bytes.length).toBeGreaterThan(0)
    expect(result.bytes[0]).toBe(0xff)
    expect(result.bytes[1] & 0xe0).toBe(0xe0)
  })

  it('appends a release tail to the rendered duration', async () => {
    const captured: number[] = []
    const mockRender: OfflineRenderer = async (_p, durationSeconds, rate) => {
      captured.push(durationSeconds)
      return { sampleRate: rate, channels: [new Float32Array(1)] }
    }
    const project = createEmptyProject('e')
    await renderProjectToMp3(project, { tailSeconds: 2, renderOffline: mockRender })
    const base = beatsToSeconds(projectEndBeats(project), project.tempo)
    expect(captured[0]).toBeCloseTo(base + 2, 5)
  })

  it('watermarks free-tier MP3 (default) and leaves paid MP3 clean — parity with WAV', async () => {
    const sampleRate = 8000
    const renderedChannels = (): Float32Array[] => [sine(440, sampleRate, 4096)]
    const mockRender: OfflineRenderer = async (_p, _d, rate) => ({
      sampleRate: rate,
      channels: renderedChannels(),
    })
    const project = createEmptyProject('e')

    const free = await renderProjectToMp3(project, {
      sampleRate,
      tailSeconds: 0,
      renderOffline: mockRender,
      // watermark defaults to true (free tier)
    })
    const paid = await renderProjectToMp3(project, {
      sampleRate,
      tailSeconds: 0,
      renderOffline: mockRender,
      watermark: false,
    })

    // The pre-encode watermark makes the free bytes differ from the clean paid bytes.
    expect(bytesEqual(free.bytes, paid.bytes)).toBe(false)
    // The clean (paid) export is a byte-identical encode of the un-watermarked PCM.
    const cleanEncode = encodeMp3(renderedChannels(), sampleRate)
    expect(bytesEqual(paid.bytes, cleanEncode)).toBe(true)
    // Both are still valid MP3 streams.
    expect(free.bytes[0]).toBe(0xff)
    expect(paid.bytes[0]).toBe(0xff)
  })
})
