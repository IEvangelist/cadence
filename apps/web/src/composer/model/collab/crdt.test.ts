import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  LOCAL_ORIGIN,
  getProjectMap,
  isProjectDocEmpty,
  readProject,
  reconcileDoc,
  seedProjectDoc,
} from './crdt'
import {
  type Project,
  SCHEMA_VERSION,
  createEmptyProject,
  createNote,
  createTrack,
} from '../project'
import { createProjectMix } from '../mix'

function sampleProject(): Project {
  const track = createTrack(
    { name: 'Lead', instrumentId: 'poly-synth', color: '#12bddc' },
    'track_a',
  )
  track.notes = [
    createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'note_1'),
    createNote({ pitch: 64, start: 1, duration: 1, velocity: 0.7 }, 'note_2'),
  ]
  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    id: 'proj_1',
    name: 'Round trip',
    tempo: 128,
    ppq: 480,
    lengthBeats: 16,
    loop: { enabled: true, start: 0, end: 8 },
    tracks: [track],
  }
  project.mix = createProjectMix(['track_a'])
  project.mix.tracks.track_a.gainDb = -6
  project.mix.tracks.track_a.inserts = [
    {
      id: 'verb',
      effectId: 'plugin.reverb',
      enabled: true,
      params: { wet: 0.64, future: 7 },
    },
  ]
  return project
}

/** Exchange full state both ways so two docs converge. */
function sync(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a)
  const ub = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(a, ub)
  Y.applyUpdate(b, ua)
}

const plainRecord = (): Record<string, unknown> => ({ malformed: true })

function mixMap(projectMap: Y.Map<unknown>): Y.Map<unknown> {
  return projectMap.get('mix') as Y.Map<unknown>
}

function mixTracks(projectMap: Y.Map<unknown>): Y.Map<unknown> {
  return mixMap(projectMap).get('tracks') as Y.Map<unknown>
}

function trackMix(projectMap: Y.Map<unknown>): Y.Map<unknown> {
  return mixTracks(projectMap).get('track_a') as Y.Map<unknown>
}

function mixInserts(projectMap: Y.Map<unknown>): Y.Array<unknown> {
  return trackMix(projectMap).get('inserts') as Y.Array<unknown>
}

function firstMixInsert(projectMap: Y.Map<unknown>): Y.Map<unknown> {
  return mixInserts(projectMap).get(0) as Y.Map<unknown>
}

function rawTrackMix(
  gainDb: number,
  insertId: string,
  effectId: string,
): Y.Map<unknown> {
  const params = new Y.Map<unknown>()
  params.set('amount', 0.5)
  const insert = new Y.Map<unknown>()
  insert.set('id', insertId)
  insert.set('effectId', effectId)
  insert.set('enabled', true)
  insert.set('params', params)
  const inserts = new Y.Array<Y.Map<unknown>>()
  inserts.push([insert])
  const track = new Y.Map<unknown>()
  track.set('gainDb', gainDb)
  track.set('pan', 0)
  track.set('solo', false)
  track.set('inserts', inserts)
  return track
}

function projectTracks(projectMap: Y.Map<unknown>): Y.Array<unknown> {
  return projectMap.get('tracks') as Y.Array<unknown>
}

function firstProjectTrack(projectMap: Y.Map<unknown>): Y.Map<unknown> {
  return projectTracks(projectMap).get(0) as Y.Map<unknown>
}

function trackNotes(projectMap: Y.Map<unknown>): Y.Array<unknown> {
  return firstProjectTrack(projectMap).get('notes') as Y.Array<unknown>
}

describe('crdt seed + read round-trip', () => {
  it('seeds an empty doc and reads back the sanitized project', () => {
    const doc = new Y.Doc()
    const project = sampleProject()
    seedProjectDoc(doc, project)

    const read = readProject(doc)
    expect(read.id).toBe('proj_1')
    expect(read.name).toBe('Round trip')
    expect(read.tempo).toBe(128)
    expect(read.ppq).toBe(480)
    expect(read.loop).toEqual({ enabled: true, start: 0, end: 8 })
    expect(read.tracks).toHaveLength(1)
    expect(read.tracks[0].id).toBe('track_a')
    expect(read.tracks[0].notes.map((n) => n.id)).toEqual(['note_1', 'note_2'])
    expect(read.tracks[0].notes[0].pitch).toBe(60)
    expect(read.mix?.tracks.track_a).toMatchObject({
      gainDb: -6,
      inserts: [
        {
          id: 'verb',
          effectId: 'plugin.reverb',
          enabled: true,
          params: { wet: 0.64, future: 7 },
        },
      ],
    })
  })

  it('isProjectDocEmpty reflects seeding', () => {
    const doc = new Y.Doc()
    expect(isProjectDocEmpty(doc)).toBe(true)
    seedProjectDoc(doc, sampleProject())
    expect(isProjectDocEmpty(doc)).toBe(false)
  })

  it('seedProjectDoc does not overwrite a non-empty doc', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    const other = createEmptyProject('proj_other')
    other.name = 'Should not win'
    seedProjectDoc(doc, other)
    expect(readProject(doc).name).toBe('Round trip')
  })

  it('preserves an authoritative schema-v2 shared mix independently of migration', () => {
    const doc = new Y.Doc()
    const project = sampleProject()
    project.schemaVersion = 2
    seedProjectDoc(doc, project)

    const read = readProject(doc)
    expect(read.schemaVersion).toBe(SCHEMA_VERSION)
    expect(read.mix?.tracks.track_a.gainDb).toBe(-6)
    expect(read.mix?.tracks.track_a.inserts[0]).toEqual({
      id: 'verb',
      effectId: 'plugin.reverb',
      enabled: true,
      params: { wet: 0.64, future: 7 },
    })
  })

  it('preserves prototype-like track ids in CRDT mix snapshots', () => {
    const doc = new Y.Doc()
    const ids = ['__proto__', 'constructor', 'prototype']
    const project = sampleProject()
    project.tracks = ids.map((id) => createTrack({ name: id }, id))
    project.mix = createProjectMix(ids)
    ids.forEach((id, index) => {
      project.mix!.tracks[id].gainDb = -4 * (index + 1)
    })
    seedProjectDoc(doc, project)

    const read = readProject(doc)
    ids.forEach((id, index) => {
      expect(Object.hasOwn(read.mix!.tracks, id)).toBe(true)
      expect(read.mix!.tracks[id].gainDb).toBe(-4 * (index + 1))
    })
  })
})

describe('crdt convergence under concurrent edits', () => {
  it('merges concurrent note insertions on the same track', () => {
    const d1 = new Y.Doc()
    seedProjectDoc(d1, sampleProject())
    const d2 = new Y.Doc()
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))

    // d1 adds a note; d2 adds a different note — concurrently.
    const p1 = readProject(d1)
    p1.tracks[0].notes.push(
      createNote({ pitch: 67, start: 2, duration: 1, velocity: 0.6 }, 'note_d1'),
    )
    reconcileDoc(d1, p1)

    const p2 = readProject(d2)
    p2.tracks[0].notes.push(
      createNote({ pitch: 72, start: 3, duration: 1, velocity: 0.6 }, 'note_d2'),
    )
    reconcileDoc(d2, p2)

    sync(d1, d2)

    const r1 = readProject(d1)
    const r2 = readProject(d2)
    expect(r1).toEqual(r2)
    const ids = r1.tracks[0].notes.map((n) => n.id).sort()
    expect(ids).toEqual(['note_1', 'note_2', 'note_d1', 'note_d2'])
  })

  it('merges concurrent edits to different scalar fields', () => {
    const d1 = new Y.Doc()
    seedProjectDoc(d1, sampleProject())
    const d2 = new Y.Doc()
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))

    const p1 = readProject(d1)
    p1.name = 'Renamed on 1'
    reconcileDoc(d1, p1)

    const p2 = readProject(d2)
    p2.tempo = 90
    reconcileDoc(d2, p2)

    sync(d1, d2)

    const r1 = readProject(d1)
    const r2 = readProject(d2)
    expect(r1).toEqual(r2)
    expect(r1.name).toBe('Renamed on 1')
    expect(r1.tempo).toBe(90)
  })

  it('merges concurrent mixer edits on different fields', () => {
    const d1 = new Y.Doc()
    seedProjectDoc(d1, sampleProject())
    const d2 = new Y.Doc()
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))

    const p1 = readProject(d1)
    p1.mix!.tracks.track_a.gainDb = -12
    reconcileDoc(d1, p1)

    const p2 = readProject(d2)
    p2.mix!.tracks.track_a.inserts[0].params.wet = 0.8
    reconcileDoc(d2, p2)

    sync(d1, d2)
    expect(readProject(d1)).toEqual(readProject(d2))
    expect(readProject(d1).mix?.tracks.track_a.gainDb).toBe(-12)
    expect(readProject(d1).mix?.tracks.track_a.inserts[0].params.wet).toBe(0.8)
  })

  it('interleaved op streams converge to an identical project', () => {
    const d1 = new Y.Doc()
    seedProjectDoc(d1, sampleProject())
    const d2 = new Y.Doc()
    Y.applyUpdate(d2, Y.encodeStateAsUpdate(d1))

    // Two independent editing streams, applied without syncing in between.
    const a = readProject(d1)
    a.tracks[0].notes[0].pitch = 62
    a.tracks.push(createTrack({ name: 'Bass' }, 'track_bass'))
    reconcileDoc(d1, a)

    const b = readProject(d2)
    b.name = 'Collab'
    b.tracks[0].notes[1].velocity = 0.5
    reconcileDoc(d2, b)

    sync(d1, d2)

    expect(readProject(d1)).toEqual(readProject(d2))
  })
})

describe('crdt sanitizes remote data', () => {
  it('clamps out-of-range values written directly into the doc', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())

    // Simulate a malicious/buggy remote peer writing junk straight into the CRDT.
    const pmap = getProjectMap(doc)
    const tracks = pmap.get('tracks') as Y.Array<Y.Map<unknown>>
    const notes = tracks.get(0).get('notes') as Y.Array<Y.Map<unknown>>
    const note = notes.get(0)
    doc.transact(() => {
      note.set('pitch', 9999)
      note.set('velocity', 5)
      note.set('duration', -3)
      pmap.set('tempo', 100000)
      pmap.set('ppq', 0)
      const mix = pmap.get('mix') as Y.Map<unknown>
      const mixTracks = mix.get('tracks') as Y.Map<Y.Map<unknown>>
      const trackMix = mixTracks.get('track_a')!
      const inserts = trackMix.get('inserts') as Y.Array<Y.Map<unknown>>
      const params = inserts.get(0).get('params') as Y.Map<unknown>
      params.set('wet', Number.POSITIVE_INFINITY)
    })

    const read = readProject(doc)
    expect(read.tracks[0].notes[0].pitch).toBeLessThanOrEqual(127)
    expect(read.tracks[0].notes[0].velocity).toBeLessThanOrEqual(1)
    expect(read.tracks[0].notes[0].duration).toBeGreaterThan(0)
    expect(read.tempo).toBeLessThanOrEqual(300)
    expect(read.ppq).toBeGreaterThan(0)
    expect(read.mix?.tracks.track_a.inserts[0].params.wet).toBeUndefined()
  })

  it('drops NaN values in favor of sane defaults', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    const pmap = getProjectMap(doc)
    doc.transact(() => {
      pmap.set('tempo', Number.NaN)
    })
    expect(Number.isFinite(readProject(doc).tempo)).toBe(true)
  })

  it('removes inherited-name params that are not own normalized keys', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    const params = firstMixInsert(getProjectMap(doc)).get(
      'params',
    ) as Y.Map<unknown>
    params.set('toString', 0.2)
    params.set('valueOf', 0.3)
    params.set('hasOwnProperty', 0.4)

    reconcileDoc(doc, sampleProject())

    expect(params.has('toString')).toBe(false)
    expect(params.has('valueOf')).toBe(false)
    expect(params.has('hasOwnProperty')).toBe(false)
    expect(readProject(doc).mix!.tracks.track_a.inserts[0].params).toEqual({
      wet: 0.64,
      future: 7,
    })
  })

  const malformedMixCases: Array<{
    name: string
    corrupt: (projectMap: Y.Map<unknown>) => void
  }> = [
    {
      name: 'root mix scalar',
      corrupt: (projectMap) => projectMap.set('mix', 7),
    },
    {
      name: 'root mix plain object',
      corrupt: (projectMap) => projectMap.set('mix', plainRecord()),
    },
    {
      name: 'master map',
      corrupt: (projectMap) => mixMap(projectMap).set('master', 'invalid'),
    },
    {
      name: 'tracks map',
      corrupt: (projectMap) => mixMap(projectMap).set('tracks', plainRecord()),
    },
    {
      name: 'per-track map',
      corrupt: (projectMap) =>
        mixTracks(projectMap).set('track_a', plainRecord()),
    },
    {
      name: 'inserts array',
      corrupt: (projectMap) =>
        trackMix(projectMap).set('inserts', plainRecord()),
    },
    {
      name: 'insert map',
      corrupt: (projectMap) => {
        const inserts = mixInserts(projectMap)
        inserts.delete(0, inserts.length)
        inserts.push([plainRecord()])
      },
    },
    {
      name: 'params map',
      corrupt: (projectMap) =>
        firstMixInsert(projectMap).set('params', plainRecord()),
    },
  ]

  it.each(malformedMixCases)(
    'defaults malformed $name and converges after valid peer recovery',
    ({ corrupt }) => {
      const doc = new Y.Doc()
      seedProjectDoc(doc, sampleProject())
      const projectMap = getProjectMap(doc)
      doc.transact(() => corrupt(projectMap), 'malicious-peer')

      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
      const firstRead = readProject(doc)
      expect(readProject(doc)).toEqual(firstRead)
      expect(readProject(peer)).toEqual(firstRead)
      expect(Object.getPrototypeOf(readProject(doc).mix!.tracks)).toBe(
        Object.prototype,
      )

      const recovered = sampleProject()
      reconcileDoc(doc, recovered)
      sync(doc, peer)

      expect(readProject(doc).mix).toEqual(recovered.mix)
      expect(readProject(peer).mix).toEqual(recovered.mix)
      expect(
        Object.getPrototypeOf(
          readProject(peer).mix!.tracks.track_a.inserts[0].params,
        ),
      ).toBe(Object.prototype)
    },
  )

  const malformedScoreCases: Array<{
    name: string
    corrupt: (projectMap: Y.Map<unknown>) => void
  }> = [
    {
      name: 'root loop scalar',
      corrupt: (projectMap) => projectMap.set('loop', false),
    },
    {
      name: 'root loop plain object',
      corrupt: (projectMap) => projectMap.set('loop', plainRecord()),
    },
    {
      name: 'root tracks scalar',
      corrupt: (projectMap) => projectMap.set('tracks', 'invalid'),
    },
    {
      name: 'root tracks plain object',
      corrupt: (projectMap) => projectMap.set('tracks', plainRecord()),
    },
    {
      name: 'track map',
      corrupt: (projectMap) => {
        const tracks = projectTracks(projectMap)
        tracks.delete(0, tracks.length)
        tracks.push([plainRecord()])
      },
    },
    {
      name: 'notes array scalar',
      corrupt: (projectMap) => firstProjectTrack(projectMap).set('notes', 7),
    },
    {
      name: 'notes array plain object',
      corrupt: (projectMap) =>
        firstProjectTrack(projectMap).set('notes', plainRecord()),
    },
    {
      name: 'note map',
      corrupt: (projectMap) => {
        const notes = trackNotes(projectMap)
        notes.delete(0, notes.length)
        notes.push([plainRecord()])
      },
    },
  ]

  it.each(malformedScoreCases)(
    'defaults malformed $name and repairs without update loops',
    ({ corrupt }) => {
      const doc = new Y.Doc()
      seedProjectDoc(doc, sampleProject())
      doc.transact(() => corrupt(getProjectMap(doc)), 'malicious-peer')

      const peer = new Y.Doc()
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
      expect(() => readProject(doc)).not.toThrow()
      expect(() => readProject(peer)).not.toThrow()

      const recovered = sampleProject()
      reconcileDoc(doc, recovered)
      sync(doc, peer)
      expect(readProject(doc).loop).toEqual(recovered.loop)
      expect(readProject(doc).tracks).toEqual(recovered.tracks)
      expect(readProject(peer).loop).toEqual(recovered.loop)
      expect(readProject(peer).tracks).toEqual(recovered.tracks)

      const before = Y.encodeStateVector(doc)
      reconcileDoc(doc, readProject(doc))
      expect(Array.from(Y.encodeStateVector(doc))).toEqual(Array.from(before))
    },
  )

  it('repairs missing and duplicate track/note ids deterministically once', () => {
    const doc = new Y.Doc()
    const source = sampleProject()
    source.mix!.tracks.track_a.inserts.push({
      id: 'delay',
      effectId: 'plugin.delay',
      enabled: true,
      params: { feedback: 0.4 },
    })
    source.mix!.tracks.track_a.inserts.push({
      id: 'compressor',
      effectId: 'plugin.compressor',
      enabled: true,
      params: { ratio: 4 },
    })
    source.tracks.push(
      createTrack(
        {
          name: 'Bass',
          notes: [createNote({ pitch: 48, start: 0 }, 'note_1')],
        },
        'track_b',
      ),
    )
    seedProjectDoc(doc, source)
    const tracks = projectTracks(getProjectMap(doc))
    const firstTrack = tracks.get(0) as Y.Map<unknown>
    const secondTrack = tracks.get(1) as Y.Map<unknown>
    const firstNotes = firstTrack.get('notes') as Y.Array<Y.Map<unknown>>
    doc.transact(() => {
      getProjectMap(doc).delete('id')
      firstTrack.delete('id')
      secondTrack.set('id', '')
      firstNotes.get(0).set('id', 'duplicate-note')
      firstNotes.get(1).set('id', 'duplicate-note')
      ;(secondTrack.get('notes') as Y.Array<Y.Map<unknown>>)
        .get(0)
        .set('id', 'duplicate-note')
    }, 'malicious-peer')

    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const first = readProject(doc)
    const stateAfterRepair = Y.encodeStateVector(doc)
    const repeated = readProject(doc)
    const peerRead = readProject(peer)

    expect(repeated).toEqual(first)
    expect(peerRead).toEqual(first)
    expect(first.id).toMatch(/^project_repaired_/)
    expect(new Set(first.tracks.map((track) => track.id)).size).toBe(
      first.tracks.length,
    )
    const noteIds = first.tracks.flatMap((track) =>
      track.notes.map((note) => note.id),
    )
    expect(new Set(noteIds).size).toBe(noteIds.length)
    expect(first.mix!.tracks[first.tracks[0].id]).toEqual({
      gainDb: 0,
      pan: 0,
      solo: false,
      inserts: [],
    })
    expect(Array.from(Y.encodeStateVector(doc))).toEqual(
      Array.from(stateAfterRepair),
    )

    sync(doc, peer)
    expect(readProject(peer)).toEqual(readProject(doc))
  })

  it('repairs a missing project id even when the tracks container is malformed', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    doc.transact(() => {
      const projectMap = getProjectMap(doc)
      projectMap.delete('id')
      projectMap.set('tracks', { malformed: true })
    }, 'malicious-peer')

    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc))
    const first = readProject(doc)
    const repeated = readProject(doc)
    const peerRead = readProject(peer)
    expect(first.id).toMatch(/^project_repaired_/)
    expect(repeated.id).toBe(first.id)
    expect(peerRead.id).toBe(first.id)
  })

  it('repairs opposite-order concurrent updates to identical canonical results', () => {
    const base = new Y.Doc()
    const project = sampleProject()
    project.tracks[0].id = 'z-track'
    project.tracks.push(createTrack({ name: 'Bass' }, 'a-track'))
    project.mix = createProjectMix(['z-track', 'a-track'])
    project.mix.tracks['z-track'].gainDb = -3
    project.mix.tracks['a-track'].gainDb = -12
    seedProjectDoc(base, project)
    const baseUpdate = Y.encodeStateAsUpdate(base)
    const baseVector = Y.encodeStateVector(base)

    const authorA = new Y.Doc()
    Y.applyUpdate(authorA, baseUpdate)
    authorA.transact(() => {
      getProjectMap(authorA).delete('id')
      const tracks = projectTracks(getProjectMap(authorA))
      ;(tracks.get(0) as Y.Map<unknown>).delete('id')
      const mix = mixMap(getProjectMap(authorA))
      ;(mix.get('tracks') as Y.Map<unknown>)
        .set('é', rawTrackMix(-21, 'same-insert', 'z-effect'))
    }, 'author-a')

    const authorB = new Y.Doc()
    Y.applyUpdate(authorB, baseUpdate)
    authorB.transact(() => {
      const tracks = projectTracks(getProjectMap(authorB))
      ;(tracks.get(1) as Y.Map<unknown>).delete('id')
      const mix = mixMap(getProjectMap(authorB))
      ;(mix.get('tracks') as Y.Map<unknown>)
        .set('e\u0301', rawTrackMix(-7, 'same-insert', 'a-effect'))
    }, 'author-b')

    const updateA = Y.encodeStateAsUpdate(authorA, baseVector)
    const updateB = Y.encodeStateAsUpdate(authorB, baseVector)
    const left = new Y.Doc()
    const right = new Y.Doc()
    Y.applyUpdate(left, baseUpdate)
    Y.applyUpdate(right, baseUpdate)
    Y.applyUpdate(left, updateA)
    Y.applyUpdate(left, updateB)
    Y.applyUpdate(right, updateB)
    Y.applyUpdate(right, updateA)

    const leftProject = readProject(left)
    const rightProject = readProject(right)
    expect(rightProject).toEqual(leftProject)
    expect(
      leftProject.tracks.map(
        (track) => leftProject.mix!.tracks[track.id].gainDb,
      ),
    ).toEqual(
      rightProject.tracks.map(
        (track) => rightProject.mix!.tracks[track.id].gainDb,
      ),
    )
    const insertIds = leftProject.tracks.flatMap((track) =>
      leftProject.mix!.tracks[track.id].inserts.map((insert) => insert.id),
    )
    expect(new Set(insertIds).size).toBe(insertIds.length)

    sync(left, right)
    expect(readProject(right)).toEqual(readProject(left))
  })

  it('drops integrated shared types while cloning orphan parameter maps', () => {
    const doc = new Y.Doc()
    const source = sampleProject()
    const associatedMix = source.mix!.tracks.track_a
    source.tracks[0].id = ''
    source.mix = {
      tracks: Object.fromEntries([['', associatedMix]]),
      master: source.mix!.master,
    }
    seedProjectDoc(doc, source)
    const projectMap = getProjectMap(doc)
    const mix = mixMap(projectMap)
    const mixTracks = mix.get('tracks') as Y.Map<Y.Map<unknown>>
    const trackMix = mixTracks.get('')!
    const inserts = trackMix.get('inserts') as Y.Array<Y.Map<unknown>>
    const params = inserts.get(0).get('params') as Y.Map<unknown>
    doc.transact(() => {
      const hostile = new Y.Map<unknown>()
      hostile.set('nested', 1)
      params.set('hostile', hostile)
    }, 'malicious-peer')

    let repaired: Project | undefined
    expect(() => {
      repaired = readProject(doc)
    }).not.toThrow()
    const trackId = repaired!.tracks[0].id
    expect(repaired!.mix!.tracks[trackId].gainDb).toBe(-6)
    expect(repaired!.mix!.tracks[trackId].inserts[0].params).toEqual({
      wet: 0.64,
      future: 7,
    })
  })

  it('reserves later valid ids before repairing predictable collisions', () => {
    const probe = new Y.Doc()
    seedProjectDoc(probe, sampleProject())
    ;(projectTracks(getProjectMap(probe)).get(0) as Y.Map<unknown>).delete('id')
    const predicted = readProject(probe, { repair: false }).tracks[0].id

    const doc = new Y.Doc()
    const source = sampleProject()
    source.tracks.push(createTrack({ name: 'Later valid' }, predicted))
    source.mix = createProjectMix(['track_a', predicted])
    source.mix.tracks.track_a.gainDb = -6
    source.mix.tracks[predicted].gainDb = -12
    seedProjectDoc(doc, source)
    ;(projectTracks(getProjectMap(doc)).get(0) as Y.Map<unknown>).delete('id')

    const repaired = readProject(doc)
    expect(repaired.tracks[1].id).toBe(predicted)
    expect(repaired.tracks[0].id).not.toBe(predicted)
    expect(new Set(repaired.tracks.map((track) => track.id)).size).toBe(2)
    expect(
      repaired.tracks.map((track) => repaired.mix!.tracks[track.id].gainDb),
    ).toEqual([0, -12])
  })

  it('reserves unrelated orphan mix keys before generating a track id', () => {
    const probe = new Y.Doc()
    seedProjectDoc(probe, sampleProject())
    ;(projectTracks(getProjectMap(probe)).get(0) as Y.Map<unknown>).delete('id')
    const predicted = readProject(probe, { repair: false }).tracks[0].id

    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    const projectMap = getProjectMap(doc)
    ;(projectTracks(projectMap).get(0) as Y.Map<unknown>).delete('id')
    const mixTracks = mixMap(projectMap).get('tracks') as Y.Map<unknown>
    mixTracks.set(
      predicted,
      rawTrackMix(-24, 'orphan-insert', 'orphan-effect'),
    )

    const repaired = readProject(doc)
    expect(repaired.tracks[0].id).not.toBe(predicted)
    expect(repaired.mix!.tracks[repaired.tracks[0].id]).toEqual({
      gainDb: 0,
      pan: 0,
      solo: false,
      inserts: [],
    })
    expect(Object.hasOwn(repaired.mix!.tracks, predicted)).toBe(false)
  })

  it('does not assign an unrelated deleted-track orphan mix by position', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    const projectMap = getProjectMap(doc)
    const mix = mixMap(projectMap)
    const tracks = mix.get('tracks') as Y.Map<unknown>
    tracks.delete('track_a')
    const orphan = rawTrackMix(-24, 'deleted-insert', 'deleted-effect')
    orphan.set('pan', 0.75)
    orphan.set('solo', true)
    tracks.set('deleted_track', orphan)

    const read = readProject(doc)
    expect(read.mix!.tracks.track_a).toEqual({
      gainDb: 0,
      pan: 0,
      solo: false,
      inserts: [],
    })
    expect(Object.hasOwn(read.mix!.tracks, 'deleted_track')).toBe(false)
  })

  it('preserves exact old-key mix provenance for duplicate track repairs', () => {
    const doc = new Y.Doc()
    const source = sampleProject()
    source.tracks[0].id = 'duplicate-track'
    source.tracks.push(createTrack({ name: 'Duplicate' }, 'second-track'))
    source.mix = createProjectMix(['duplicate-track', 'second-track'])
    source.mix.tracks['duplicate-track'].gainDb = -8
    source.mix.tracks['second-track'].gainDb = -16
    seedProjectDoc(doc, source)
    ;(projectTracks(getProjectMap(doc)).get(1) as Y.Map<unknown>)
      .set('id', 'duplicate-track')

    const read = readProject(doc)
    expect(read.tracks[0].id).toBe('duplicate-track')
    expect(read.tracks[1].id).not.toBe('duplicate-track')
    expect(read.mix!.tracks[read.tracks[0].id].gainDb).toBe(-8)
    expect(read.mix!.tracks[read.tracks[1].id].gainDb).toBe(-8)
  })

  it('repairs missing and duplicate insert ids without collapsing entries', () => {
    const doc = new Y.Doc()
    const source = sampleProject()
    source.mix!.tracks.track_a.inserts.push(
      {
        id: 'delay',
        effectId: 'plugin.delay',
        enabled: true,
        params: { feedback: 0.4 },
      },
      {
        id: 'compressor',
        effectId: 'plugin.compressor',
        enabled: true,
        params: { ratio: 4 },
      },
    )
    seedProjectDoc(doc, source)
    const inserts = mixInserts(getProjectMap(doc)) as Y.Array<Y.Map<unknown>>
    inserts.get(0).delete('id')
    inserts.get(1).set('id', 'duplicate-insert')
    inserts.get(2).set('id', 'duplicate-insert')

    const read = readProject(doc)
    const repaired = read.mix!.tracks.track_a.inserts
    expect(repaired).toHaveLength(3)
    expect(new Set(repaired.map((insert) => insert.id)).size).toBe(3)
    expect(repaired.map((insert) => insert.effectId).sort()).toEqual([
      'plugin.compressor',
      'plugin.delay',
      'plugin.reverb',
    ])
  })
})

describe('reconcileDoc is minimal and echo-safe', () => {
  it('produces no new updates when reconciling an unchanged project', () => {
    const doc = new Y.Doc()
    seedProjectDoc(doc, sampleProject())
    const before = Y.encodeStateVector(doc)

    reconcileDoc(doc, readProject(doc))

    const after = Y.encodeStateVector(doc)
    expect(Array.from(after)).toEqual(Array.from(before))
  })

  it('removes tracks and notes that disappear from the project', () => {
    const doc = new Y.Doc()
    const project = sampleProject()
    project.tracks.push(createTrack({ name: 'Temp' }, 'track_temp'))
    seedProjectDoc(doc, project)
    expect(readProject(doc).tracks).toHaveLength(2)

    const pruned = readProject(doc)
    pruned.tracks = pruned.tracks.filter((t) => t.id !== 'track_temp')
    pruned.tracks[0].notes = pruned.tracks[0].notes.filter((n) => n.id !== 'note_2')
    reconcileDoc(doc, pruned)

    const read = readProject(doc)
    expect(read.tracks.map((t) => t.id)).toEqual(['track_a'])
    expect(read.tracks[0].notes.map((n) => n.id)).toEqual(['note_1'])
  })

  it('tags local writes with LOCAL_ORIGIN', () => {
    const doc = new Y.Doc()
    const origins: unknown[] = []
    doc.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    seedProjectDoc(doc, sampleProject())
    expect(origins).toContain(LOCAL_ORIGIN)
  })
})
