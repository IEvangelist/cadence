import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ELECTRIC_PIANO_MANIFEST,
  GRAND_PIANO_MANIFEST,
  resolveRemoteUrls,
  samplePackCdnBaseUrl,
  type SamplePackManifest,
} from './packManifest'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sample pack manifests', () => {
  it('describes the two flagship keys with matching ids and names', () => {
    expect(GRAND_PIANO_MANIFEST.id).toBe('sampled-grand-piano')
    expect(ELECTRIC_PIANO_MANIFEST.id).toBe('sampled-electric-piano')
    expect(GRAND_PIANO_MANIFEST.name.length).toBeGreaterThan(0)
    expect(ELECTRIC_PIANO_MANIFEST.name.length).toBeGreaterThan(0)
  })

  it('always carries a procedural spec so an offline fallback exists', () => {
    for (const manifest of [GRAND_PIANO_MANIFEST, ELECTRIC_PIANO_MANIFEST]) {
      expect(manifest.spec.timbre.partials.length).toBeGreaterThan(0)
      expect(typeof manifest.spec.attack).toBe('number')
      expect(typeof manifest.spec.release).toBe('number')
      expect(typeof manifest.spec.level).toBe('number')
    }
  })

  it('keys each remote source by the anchor note names (C2..C6)', () => {
    for (const manifest of [GRAND_PIANO_MANIFEST, ELECTRIC_PIANO_MANIFEST]) {
      expect(manifest.remote).toBeDefined()
      expect(Object.keys(manifest.remote!.files)).toEqual(['C2', 'C3', 'C4', 'C5', 'C6'])
      // Each note maps to a plain file name resolved under basePath (no absolute URLs baked in).
      for (const file of Object.values(manifest.remote!.files)) {
        expect(file).toMatch(/^C\d\.wav$/)
      }
      expect(manifest.remote!.basePath.length).toBeGreaterThan(0)
    }
  })
})

describe('samplePackCdnBaseUrl', () => {
  it('returns an empty string when VITE_SAMPLE_PACK_CDN is unset', () => {
    vi.stubEnv('VITE_SAMPLE_PACK_CDN', '')
    expect(samplePackCdnBaseUrl()).toBe('')
  })

  it('trims surrounding whitespace and treats a blank value as unset', () => {
    vi.stubEnv('VITE_SAMPLE_PACK_CDN', '   ')
    expect(samplePackCdnBaseUrl()).toBe('')
  })

  it('strips trailing slashes from a configured base URL', () => {
    vi.stubEnv('VITE_SAMPLE_PACK_CDN', 'https://cdn.example.com/packs/')
    expect(samplePackCdnBaseUrl()).toBe('https://cdn.example.com/packs')
  })

  it('returns a configured base URL verbatim (minus trailing slash)', () => {
    vi.stubEnv('VITE_SAMPLE_PACK_CDN', 'https://cdn.example.com/packs')
    expect(samplePackCdnBaseUrl()).toBe('https://cdn.example.com/packs')
  })
})

describe('resolveRemoteUrls', () => {
  it('returns null when the manifest has no remote source', () => {
    const local: SamplePackManifest = { ...GRAND_PIANO_MANIFEST, remote: undefined }
    expect(resolveRemoteUrls(local, 'https://cdn.example.com')).toBeNull()
  })

  it('returns null when no CDN base URL is configured', () => {
    expect(resolveRemoteUrls(GRAND_PIANO_MANIFEST, '')).toBeNull()
  })

  it('builds absolute, note-keyed URLs under the base and basePath', () => {
    const urls = resolveRemoteUrls(GRAND_PIANO_MANIFEST, 'https://cdn.example.com/packs')
    expect(urls).toEqual({
      C2: 'https://cdn.example.com/packs/grand-piano/C2.wav',
      C3: 'https://cdn.example.com/packs/grand-piano/C3.wav',
      C4: 'https://cdn.example.com/packs/grand-piano/C4.wav',
      C5: 'https://cdn.example.com/packs/grand-piano/C5.wav',
      C6: 'https://cdn.example.com/packs/grand-piano/C6.wav',
    })
  })

  it('omits the basePath segment when it is empty', () => {
    const flat: SamplePackManifest = {
      ...GRAND_PIANO_MANIFEST,
      remote: { basePath: '', files: { C4: 'C4.wav' } },
    }
    expect(resolveRemoteUrls(flat, 'https://cdn.example.com')).toEqual({
      C4: 'https://cdn.example.com/C4.wav',
    })
  })
})
