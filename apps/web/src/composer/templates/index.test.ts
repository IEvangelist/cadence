import { describe, expect, it } from 'vitest'
import { composerReducer, initialState } from '../model/reducer'
import { createEmptyProject } from '../model/project'
import {
  HOUSE_DUBS,
  getSongTemplate,
  listSongTemplates,
  songTemplatesByGenre,
} from './index'

describe('song template selectors', () => {
  it('lists the built-in registry in gallery order', () => {
    expect(listSongTemplates()).toEqual(HOUSE_DUBS)
  })

  it('looks a template up by id and returns undefined for unknown ids', () => {
    const first = HOUSE_DUBS[0]
    expect(getSongTemplate(first.id)).toBe(first)
    expect(getSongTemplate('does-not-exist')).toBeUndefined()
  })

  it('buckets templates by genre, preserving first-seen order and covering all', () => {
    const groups = songTemplatesByGenre()
    // Every template appears exactly once, and genres are unique + ordered.
    const flattened = groups.flatMap((g) => g.templates)
    expect(flattened).toEqual(HOUSE_DUBS)
    const genres = groups.map((g) => g.genre)
    expect(new Set(genres).size).toBe(genres.length)
    for (const group of groups) {
      for (const template of group.templates) {
        expect(template.genre).toBe(group.genre)
      }
    }
  })
})

describe('loading a template through the load-project reducer', () => {
  it('replaces the project, selects the first track and keeps note counts', () => {
    const template = HOUSE_DUBS[0]
    const project = template.build()
    const start = initialState(createEmptyProject('scratch'))

    const next = composerReducer(start, { type: 'load-project', project })

    expect(next.project.tracks).toHaveLength(project.tracks.length)
    next.project.tracks.forEach((track, i) => {
      expect(track.notes).toHaveLength(project.tracks[i].notes.length)
    })
    expect(next.selectedTrackId).toBe(project.tracks[0].id)
    expect(next.selectedNoteIds).toEqual([])
  })

  it('produces a loop that covers all content for every template', () => {
    for (const template of HOUSE_DUBS) {
      const project = template.build()
      const next = composerReducer(
        initialState(createEmptyProject('scratch')),
        { type: 'load-project', project },
      )
      const contentEnd = next.project.tracks.reduce(
        (max, track) =>
          track.notes.reduce((m, note) => Math.max(m, note.start + note.duration), max),
        0,
      )
      expect(next.project.loop.end).toBeGreaterThanOrEqual(contentEnd)
      expect(next.project.lengthBeats).toBeGreaterThanOrEqual(contentEnd)
    }
  })

  it('load-project self-heals a damaged loop, but sync-remote stays pure', () => {
    const project = HOUSE_DUBS[0].build()
    // Deliberately break the shipped loop so only a healing path can fix it.
    const damaged = { ...project, loop: { enabled: true, start: 0, end: 1 } }
    const start = initialState(createEmptyProject('scratch'))

    const healed = composerReducer(start, { type: 'load-project', project: damaged })
    expect(healed.project.loop.end).toBeGreaterThan(1)

    // The CRDT convergence path must NOT rewrite the loop (echo-safety).
    const synced = composerReducer(start, { type: 'sync-remote', project: damaged })
    expect(synced.project.loop.end).toBe(1)
  })
})
