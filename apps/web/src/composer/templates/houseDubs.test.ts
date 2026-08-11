import { describe, expect, it } from 'vitest'
import { BEATS_PER_BAR } from '../model/project'
import { getInstrument } from '../instruments/registry'
import { HOUSE_DUBS } from './houseDubs'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

describe('house dubs registry', () => {
  it('ships at least 6 templates across at least 4 genres', () => {
    expect(HOUSE_DUBS.length).toBeGreaterThanOrEqual(6)
    const genres = new Set(HOUSE_DUBS.map((t) => t.genre))
    expect(genres.size).toBeGreaterThanOrEqual(4)
  })

  it('has a unique, kebab-case id for every template', () => {
    const ids = HOUSE_DUBS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(KEBAB)
  })

  it('gives every template a name, description and sane tempo', () => {
    for (const t of HOUSE_DUBS) {
      expect(t.name.trim().length).toBeGreaterThan(0)
      expect(t.description.trim().length).toBeGreaterThan(0)
      expect(t.genre.trim().length).toBeGreaterThan(0)
      expect(t.tempo).toBeGreaterThanOrEqual(20)
      expect(t.tempo).toBeLessThanOrEqual(300)
    }
  })

  it.each(HOUSE_DUBS.map((t) => [t.name, t] as const))(
    'builds "%s" as a valid, multi-track, multi-bar arrangement',
    (_name, template) => {
      const project = template.build()

      // Multi-track: drums + bass + chords/keys + lead is the baseline.
      expect(project.tracks.length).toBeGreaterThanOrEqual(3)
      // "Longer composed track": at least 8 bars of content.
      expect(project.lengthBeats).toBeGreaterThanOrEqual(8 * BEATS_PER_BAR)
      expect(project.tempo).toBe(template.tempo)

      let contentEnd = 0
      for (const track of project.tracks) {
        expect(track.notes.length).toBeGreaterThan(0)
        for (const note of track.notes) {
          expect(Number.isInteger(note.pitch)).toBe(true)
          expect(note.pitch).toBeGreaterThanOrEqual(0)
          expect(note.pitch).toBeLessThanOrEqual(127)
          expect(note.start).toBeGreaterThanOrEqual(0)
          expect(note.duration).toBeGreaterThan(0)
          expect(note.velocity).toBeGreaterThan(0)
          expect(note.velocity).toBeLessThanOrEqual(1)
          contentEnd = Math.max(contentEnd, note.start + note.duration)
        }
      }

      // The whole-song loop must cover every note so playback reaches the end.
      expect(project.loop.enabled).toBe(true)
      expect(project.loop.start).toBe(0)
      expect(project.loop.end).toBeGreaterThanOrEqual(contentEnd)
      expect(project.lengthBeats).toBeGreaterThanOrEqual(contentEnd)
    },
  )

  it.each(HOUSE_DUBS.map((t) => [t.name, t] as const))(
    'resolves every track instrument of "%s" to itself (never the poly-synth fallback)',
    (_name, template) => {
      for (const track of template.build().tracks) {
        expect(getInstrument(track.instrumentId).id).toBe(track.instrumentId)
      }
    },
  )

  it('builds a fresh project (new ids) on every call, with no shared mutable state', () => {
    const template = HOUSE_DUBS[0]
    const a = template.build()
    const b = template.build()
    expect(a.id).not.toBe(b.id)
    expect(a.tracks[0].id).not.toBe(b.tracks[0].id)
    expect(a.tracks[0].notes[0].id).not.toBe(b.tracks[0].notes[0].id)
    // Same musical content though.
    expect(b.tracks.map((t) => t.instrumentId)).toEqual(a.tracks.map((t) => t.instrumentId))
    expect(b.tracks[0].notes.length).toBe(a.tracks[0].notes.length)
  })
})
