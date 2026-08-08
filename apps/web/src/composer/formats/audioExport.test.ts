import { describe, expect, it, vi } from 'vitest'
import { createDemoProject, createEmptyProject } from '../model/project'
import { beatsToSeconds } from '../timing/timing'
import {
  type OfflineRenderer,
  type RenderedAudio,
  encodeWav,
  projectEndBeats,
  renderProjectToWav,
} from './audioExport'

const readString = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.slice(offset, offset + length))

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true)

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE PCM-16 header', () => {
    const frames = 100
    const channel = new Float32Array(frames)
    const bytes = encodeWav([channel], 44100)

    expect(readString(bytes, 0, 4)).toBe('RIFF')
    expect(readString(bytes, 8, 4)).toBe('WAVE')
    expect(readString(bytes, 12, 4)).toBe('fmt ')
    expect(readString(bytes, 36, 4)).toBe('data')
    // 44-byte header + frames * channels(1) * 2 bytes.
    expect(bytes.length).toBe(44 + frames * 1 * 2)
    expect(readUint32(bytes, 24)).toBe(44100) // sample rate
    expect(readUint32(bytes, 40)).toBe(frames * 2) // data chunk size
  })

  it('interleaves stereo samples and encodes amplitude', () => {
    const left = Float32Array.from([1, 0, -1])
    const right = Float32Array.from([-1, 0, 1])
    const bytes = encodeWav([left, right], 48000)
    expect(bytes.length).toBe(44 + 3 * 2 * 2)

    const view = new DataView(bytes.buffer, bytes.byteOffset)
    // Frame 0: left = +full scale, right = -full scale.
    expect(view.getInt16(44, true)).toBe(0x7fff)
    expect(view.getInt16(46, true)).toBe(-0x8000)
  })
})

describe('projectEndBeats', () => {
  it('is at least the project length', () => {
    expect(projectEndBeats(createEmptyProject('e'))).toBeGreaterThanOrEqual(4)
  })

  it('reflects the last sounding note when it extends past the length', () => {
    const project = createEmptyProject('e')
    project.lengthBeats = 4
    project.tracks[0].notes = [
      { id: 'n', pitch: 60, start: 6, duration: 2, velocity: 0.8 },
    ]
    expect(projectEndBeats(project)).toBe(8)
  })
})

describe('renderProjectToWav', () => {
  it('renders a non-empty WAV of the expected duration', async () => {
    const sampleRate = 8000
    const mockRender: OfflineRenderer = vi.fn(
      async (_project, durationSeconds, rate): Promise<RenderedAudio> => {
        const frames = Math.round(durationSeconds * rate)
        return { sampleRate: rate, channels: [new Float32Array(frames)] }
      },
    )

    const demo = createDemoProject('demo')
    const result = await renderProjectToWav(demo, {
      sampleRate,
      tailSeconds: 0,
      renderOffline: mockRender,
    })

    const expectedSeconds = beatsToSeconds(projectEndBeats(demo), demo.tempo)
    expect(result.durationSeconds).toBeCloseTo(expectedSeconds, 5)
    expect(mockRender).toHaveBeenCalledOnce()

    // Header (44) + frames * 1 channel * 2 bytes, and the byte stream is non-empty.
    const expectedFrames = Math.round(expectedSeconds * sampleRate)
    expect(result.bytes.length).toBe(44 + expectedFrames * 2)
    expect(result.bytes.length).toBeGreaterThan(44)
    expect(readString(result.bytes, 0, 4)).toBe('RIFF')
  })

  it('appends a release tail to the rendered duration', async () => {
    const captured: number[] = []
    const mockRender: OfflineRenderer = async (_p, durationSeconds, rate) => {
      captured.push(durationSeconds)
      return { sampleRate: rate, channels: [new Float32Array(1)] }
    }
    const project = createEmptyProject('e')
    await renderProjectToWav(project, { tailSeconds: 2, renderOffline: mockRender })
    const base = beatsToSeconds(projectEndBeats(project), project.tempo)
    expect(captured[0]).toBeCloseTo(base + 2, 5)
  })
})
