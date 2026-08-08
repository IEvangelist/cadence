import { describe, expect, it, vi } from 'vitest'
import {
  MAX_SHARE_FRAGMENT_LENGTH,
  MAX_SHARE_URL_LENGTH,
  createShareSnapshot,
  decodeProjectFromFragment,
  encodeProjectToFragment,
  fromBase64Url,
  toBase64Url,
} from './share'
import { createEmptyProject, createNote, createTrack, type Project } from '../model/project'

function smallProject(): Project {
  const project = createEmptyProject('p')
  project.name = 'Shared ✨'
  project.tracks = [
    createTrack(
      { name: 'Synth', notes: [createNote({ pitch: 60, start: 0, duration: 1 }, 'a')] },
      't',
    ),
  ]
  return project
}

function largeProject(): Project {
  const notes = Array.from({ length: 400 }, (_, i) =>
    createNote({ pitch: 60 + (i % 24), start: i * 0.25, duration: 0.25 }, `n${i}`),
  )
  const project = createEmptyProject('big')
  project.tracks = [createTrack({ name: 'Dense', notes }, 't')]
  return project
}

describe('base64url helpers', () => {
  it('round-trips UTF-8 text (including non-ASCII)', () => {
    const text = 'Cadence — every idea, resolved ✨'
    expect(fromBase64Url(toBase64Url(text))).toBe(text)
  })

  it('produces URL-safe output with no +, / or = characters', () => {
    const encoded = toBase64Url('??>>>???ffff????')
    expect(encoded).not.toMatch(/[+/=]/)
  })
})

describe('project fragment round trip', () => {
  it('encodes and decodes a project via the URL fragment', () => {
    const project = smallProject()
    const restored = decodeProjectFromFragment(`#${encodeProjectToFragment(project)}`)
    expect(restored?.name).toBe('Shared ✨')
    expect(restored?.tracks[0].notes).toHaveLength(1)
    expect(restored?.tracks[0].notes[0].pitch).toBe(60)
  })

  it('decodes a fragment without the leading #', () => {
    const project = smallProject()
    const restored = decodeProjectFromFragment(encodeProjectToFragment(project))
    expect(restored?.name).toBe('Shared ✨')
  })

  it('returns null when no project fragment is present', () => {
    expect(decodeProjectFromFragment('#foo=bar')).toBeNull()
    expect(decodeProjectFromFragment('')).toBeNull()
  })

  it('returns null (not throw) on a corrupt payload', () => {
    expect(decodeProjectFromFragment('#project=@@not-base64@@')).toBeNull()
  })

  it('returns null for an over-long fragment without decoding it', () => {
    // A large project encodes to a fragment past the decode cap; the guard must
    // bail before atob/JSON.parse so a hostile link can't force a big decode.
    const encoded = encodeProjectToFragment(largeProject())
    const payload = encoded.slice(`${'project'}=`.length)
    expect(payload.length).toBeGreaterThan(MAX_SHARE_FRAGMENT_LENGTH)
    const atobSpy = vi.spyOn(globalThis, 'atob')
    expect(decodeProjectFromFragment(`#${encoded}`)).toBeNull()
    expect(atobSpy).not.toHaveBeenCalled()
    atobSpy.mockRestore()
  })
})

describe('createShareSnapshot', () => {
  it('returns a URL snapshot for a small project', () => {
    const snapshot = createShareSnapshot(smallProject(), {
      baseUrl: 'https://cadence.app/studio',
    })
    expect(snapshot.kind).toBe('url')
    if (snapshot.kind === 'url') {
      expect(snapshot.url.startsWith('https://cadence.app/studio#project=')).toBe(true)
      expect(snapshot.url.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH)
      const restored = decodeProjectFromFragment(new URL(snapshot.url).hash)
      expect(restored?.name).toBe('Shared ✨')
    }
  })

  it('replaces an existing hash on the base URL', () => {
    const snapshot = createShareSnapshot(smallProject(), {
      baseUrl: 'https://cadence.app/studio#project=stale',
    })
    if (snapshot.kind === 'url') {
      expect(snapshot.url.match(/#project=/g)).toHaveLength(1)
    }
  })

  it('falls back to the file for a project that exceeds the URL budget', () => {
    const snapshot = createShareSnapshot(largeProject(), {
      baseUrl: 'https://cadence.app/studio',
    })
    expect(snapshot.kind).toBe('file')
    if (snapshot.kind === 'file') {
      expect(snapshot.reason).toMatch(/\.cadence\.json/)
    }
  })

  it('honors a custom maxUrlLength', () => {
    const snapshot = createShareSnapshot(smallProject(), {
      baseUrl: 'https://cadence.app/studio',
      maxUrlLength: 10,
    })
    expect(snapshot.kind).toBe('file')
  })
})
