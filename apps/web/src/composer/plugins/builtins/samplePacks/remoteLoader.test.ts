import { describe, expect, it, vi } from 'vitest'
import type { ToneAudioBuffer } from 'tone'
import type { SampledInstrument } from './renderSample'
import { GRAND_PIANO_MANIFEST, type SamplePackManifest } from './packManifest'
import {
  fetchRemoteBuffers,
  resolvePackBuffers,
  type NoteBuffers,
  type PackBuildSources,
} from './remoteLoader'

/** A stand-in decoded buffer — the loader only moves these around by reference. */
function fakeBuffer(tag: string): ToneAudioBuffer {
  return { tag } as unknown as ToneAudioBuffer
}

/** A minimal `Response` with just the fields the loader reads. */
function response(init: { ok: boolean; status?: number; bytes?: ArrayBuffer }): Response {
  return {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    arrayBuffer: async () => init.bytes ?? new ArrayBuffer(8),
  } as unknown as Response
}

/** A recordable {@link SampledInstrument} so triggers (and velocity) can be asserted. */
function recordableInstrument(): { instrument: SampledInstrument; triggers: unknown[][] } {
  const triggers: unknown[][] = []
  return {
    triggers,
    instrument: {
      trigger: (...args) => {
        triggers.push(args)
      },
      dispose: () => {},
    },
  }
}

describe('fetchRemoteBuffers', () => {
  it('fetches every url and decodes each into a buffer keyed by note name', async () => {
    const c4Bytes = new ArrayBuffer(4)
    const c5Bytes = new ArrayBuffer(5)
    const fetchMock = vi.fn(async (url: string) =>
      response({ ok: true, bytes: url.endsWith('C4.wav') ? c4Bytes : c5Bytes }),
    )
    const decodeMock = vi.fn(async (data: ArrayBuffer) =>
      fakeBuffer(data === c4Bytes ? 'c4' : 'c5'),
    )

    const buffers = await fetchRemoteBuffers(
      { C4: 'https://cdn/x/C4.wav', C5: 'https://cdn/x/C5.wav' },
      { fetch: fetchMock, decode: decodeMock },
    )

    expect(Object.keys(buffers).sort()).toEqual(['C4', 'C5'])
    expect((buffers.C4 as unknown as { tag: string }).tag).toBe('c4')
    expect((buffers.C5 as unknown as { tag: string }).tag).toBe('c5')
    expect(fetchMock).toHaveBeenCalledWith('https://cdn/x/C4.wav')
    expect(fetchMock).toHaveBeenCalledWith('https://cdn/x/C5.wav')
    // Decode is fed the fetched bytes, not the URL.
    expect(decodeMock).toHaveBeenCalledWith(c4Bytes)
    expect(decodeMock).toHaveBeenCalledWith(c5Bytes)
  })

  it('rejects when any file responds non-OK (so the caller can fall back)', async () => {
    const fetchMock = vi.fn(async () => response({ ok: false, status: 404 }))
    const decodeMock = vi.fn(async () => fakeBuffer('never'))

    await expect(
      fetchRemoteBuffers({ C4: 'https://cdn/x/C4.wav' }, { fetch: fetchMock, decode: decodeMock }),
    ).rejects.toThrow(/404/)
    expect(decodeMock).not.toHaveBeenCalled()
  })

  it('rejects when decoding fails', async () => {
    const fetchMock = vi.fn(async () => response({ ok: true }))
    const decodeMock = vi.fn(async () => {
      throw new Error('bad audio data')
    })

    await expect(
      fetchRemoteBuffers({ C4: 'https://cdn/x/C4.wav' }, { fetch: fetchMock, decode: decodeMock }),
    ).rejects.toThrow(/bad audio data/)
  })
})

describe('resolvePackBuffers', () => {
  const remoteBuffers = { C4: fakeBuffer('remote') } as NoteBuffers
  const proceduralBuffers = { C4: fakeBuffer('procedural') } as NoteBuffers

  interface Harness {
    sources: PackBuildSources
    loadRemote: ReturnType<typeof vi.fn>
    renderProcedural: ReturnType<typeof vi.fn>
    build: ReturnType<typeof vi.fn>
    warn?: ReturnType<typeof vi.fn>
  }

  function harness(
    over: {
      loadRemote?: () => Promise<NoteBuffers>
      build?: () => SampledInstrument
      withWarn?: boolean
    } = {},
  ): Harness {
    const loadRemote = vi.fn(over.loadRemote ?? (async () => remoteBuffers))
    const renderProcedural = vi.fn(() => proceduralBuffers)
    const build = vi.fn(over.build ?? (() => recordableInstrument().instrument))
    const warn = over.withWarn ? vi.fn() : undefined
    return {
      sources: { loadRemote, renderProcedural, build, warn },
      loadRemote,
      renderProcedural,
      build,
      warn,
    }
  }

  it('renders the procedural pack and never fetches when no CDN is configured', async () => {
    const h = harness()
    await resolvePackBuffers(GRAND_PIANO_MANIFEST, '', h.sources)

    expect(h.loadRemote).not.toHaveBeenCalled()
    expect(h.renderProcedural).toHaveBeenCalledTimes(1)
    expect(h.build).toHaveBeenCalledWith(proceduralBuffers)
  })

  it('renders procedurally when the manifest has no remote source, even with a CDN set', async () => {
    const local: SamplePackManifest = { ...GRAND_PIANO_MANIFEST, remote: undefined }
    const h = harness()
    await resolvePackBuffers(local, 'https://cdn.example.com', h.sources)

    expect(h.loadRemote).not.toHaveBeenCalled()
    expect(h.build).toHaveBeenCalledWith(proceduralBuffers)
  })

  it('uses the remote pack when a CDN is configured and the fetch succeeds', async () => {
    const h = harness()
    await resolvePackBuffers(GRAND_PIANO_MANIFEST, 'https://cdn.example.com', h.sources)

    expect(h.loadRemote).toHaveBeenCalledTimes(1)
    expect(h.renderProcedural).not.toHaveBeenCalled()
    expect(h.build).toHaveBeenCalledWith(remoteBuffers)
  })

  it('falls back to the procedural pack and warns when the remote load fails', async () => {
    const error = new Error('offline')
    const h = harness({ loadRemote: () => Promise.reject(error), withWarn: true })

    await resolvePackBuffers(GRAND_PIANO_MANIFEST, 'https://cdn.example.com', h.sources)

    expect(h.warn).toHaveBeenCalledWith(GRAND_PIANO_MANIFEST, error)
    expect(h.renderProcedural).toHaveBeenCalledTimes(1)
    expect(h.build).toHaveBeenCalledWith(proceduralBuffers)
  })

  it('falls back without throwing when no warn sink is provided', async () => {
    const h = harness({ loadRemote: () => Promise.reject(new Error('offline')) })

    await expect(
      resolvePackBuffers(GRAND_PIANO_MANIFEST, 'https://cdn.example.com', h.sources),
    ).resolves.toBeDefined()
    expect(h.build).toHaveBeenCalledWith(proceduralBuffers)
  })

  it('returns a playable voice that forwards velocity through to the built instrument', async () => {
    const bed = recordableInstrument()
    const h = harness({ build: () => bed.instrument })

    const voice = await resolvePackBuffers(GRAND_PIANO_MANIFEST, '', h.sources)
    voice.trigger(60, 0.5, 0, 0.8)

    expect(bed.triggers).toEqual([[60, 0.5, 0, 0.8]])
  })
})
