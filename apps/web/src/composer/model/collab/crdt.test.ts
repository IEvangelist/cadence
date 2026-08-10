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
  createEmptyProject,
  createNote,
  createTrack,
} from '../project'

function sampleProject(): Project {
  const track = createTrack(
    { name: 'Lead', instrumentId: 'poly-synth', color: '#12bddc' },
    'track_a',
  )
  track.notes = [
    createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'note_1'),
    createNote({ pitch: 64, start: 1, duration: 1, velocity: 0.7 }, 'note_2'),
  ]
  return {
    schemaVersion: 1,
    id: 'proj_1',
    name: 'Round trip',
    tempo: 128,
    ppq: 480,
    lengthBeats: 16,
    loop: { enabled: true, start: 0, end: 8 },
    tracks: [track],
  }
}

/** Exchange full state both ways so two docs converge. */
function sync(a: Y.Doc, b: Y.Doc): void {
  const ua = Y.encodeStateAsUpdate(a)
  const ub = Y.encodeStateAsUpdate(b)
  Y.applyUpdate(a, ub)
  Y.applyUpdate(b, ua)
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
    })

    const read = readProject(doc)
    expect(read.tracks[0].notes[0].pitch).toBeLessThanOrEqual(127)
    expect(read.tracks[0].notes[0].velocity).toBeLessThanOrEqual(1)
    expect(read.tracks[0].notes[0].duration).toBeGreaterThan(0)
    expect(read.tempo).toBeLessThanOrEqual(300)
    expect(read.ppq).toBeGreaterThan(0)
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
