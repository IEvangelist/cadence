/**
 * Yjs ⇆ Cadence project binding.
 *
 * The composer project is modelled as a nested Yjs document so concurrent edits
 * from multiple clients merge deterministically and converge:
 *
 *   project (Y.Map)
 *     ├─ scalars: schemaVersion, id, name, tempo, ppq, lengthBeats
 *     ├─ loop    (Y.Map: enabled, start, end)
 *     └─ tracks  (Y.Array<Y.Map>)
 *          └─ each track: id, name, instrumentId, muted, color
 *               └─ notes (Y.Array<Y.Map>)  each note: id, pitch, start, duration, velocity
 *
 * Reads always flow back through {@link migrateProject} — the same sanitize seam
 * used by file/share/plugin imports — so a malicious or buggy remote peer cannot
 * inject out-of-range pitches, NaN/negative durations, or unbounded tempo/ppq
 * into live state. Local writes are tagged with {@link LOCAL_ORIGIN} and each
 * field write is guarded (only set when the value actually changed), so
 * reconciling an unchanged project is a no-op and can never echo.
 */
import * as Y from 'yjs'
import { type Note, type Project, type Track } from './../project'
import { migrateProject } from './../persistence'

/** Origin stamped on every local (non-remote) transaction. */
export const LOCAL_ORIGIN: unique symbol = Symbol('cadence-collab-local')

/** Root shared-type key holding the whole project. */
export const PROJECT_MAP_KEY = 'project'

type YMap = Y.Map<unknown>
type YArray = Y.Array<YMap>

/** The root project {@link Y.Map} for a document (created on first access). */
export function getProjectMap(doc: Y.Doc): YMap {
  return doc.getMap(PROJECT_MAP_KEY)
}

/** True when the document has not been seeded with a project yet. */
export function isProjectDocEmpty(doc: Y.Doc): boolean {
  return getProjectMap(doc).size === 0
}

const NOTE_FIELDS = ['pitch', 'start', 'duration', 'velocity'] as const
const TRACK_FIELDS = ['name', 'instrumentId', 'muted', 'color'] as const

function setChanged(map: YMap, key: string, value: unknown): void {
  if (map.get(key) !== value) map.set(key, value)
}

function buildNote(note: Note): YMap {
  const m = new Y.Map<unknown>()
  m.set('id', note.id)
  m.set('pitch', note.pitch)
  m.set('start', note.start)
  m.set('duration', note.duration)
  m.set('velocity', note.velocity)
  return m
}

function buildTrack(track: Track): YMap {
  const m = new Y.Map<unknown>()
  m.set('id', track.id)
  m.set('name', track.name)
  m.set('instrumentId', track.instrumentId)
  m.set('muted', track.muted)
  m.set('color', track.color)
  const notes = new Y.Array<YMap>()
  notes.push(track.notes.map(buildNote))
  m.set('notes', notes)
  return m
}

/** Index a Yjs array of records by their `id` field. */
function indexById(array: YArray): Map<string, YMap> {
  const byId = new Map<string, YMap>()
  for (const entry of array) byId.set(entry.get('id') as string, entry)
  return byId
}

function reconcileNotes(notesArray: YArray, notes: Note[]): void {
  const existing = indexById(notesArray)
  const desired = new Set(notes.map((n) => n.id))

  // Remove notes that disappeared (walk backwards so indices stay valid).
  for (let i = notesArray.length - 1; i >= 0; i -= 1) {
    if (!desired.has(notesArray.get(i).get('id') as string)) notesArray.delete(i, 1)
  }

  notes.forEach((note) => {
    const current = existing.get(note.id)
    if (current) {
      for (const field of NOTE_FIELDS) setChanged(current, field, note[field])
    } else {
      notesArray.push([buildNote(note)])
    }
  })
}

function reconcileTracks(tracksArray: YArray, tracks: Track[]): void {
  const existing = indexById(tracksArray)
  const desired = new Set(tracks.map((t) => t.id))

  for (let i = tracksArray.length - 1; i >= 0; i -= 1) {
    if (!desired.has(tracksArray.get(i).get('id') as string)) tracksArray.delete(i, 1)
  }

  tracks.forEach((track) => {
    const current = existing.get(track.id)
    if (current) {
      for (const field of TRACK_FIELDS) setChanged(current, field, track[field])
      reconcileNotes(current.get('notes') as YArray, track.notes)
    } else {
      tracksArray.push([buildTrack(track)])
    }
  })
}

function reconcileLoop(pmap: YMap, project: Project): void {
  let loop = pmap.get('loop') as YMap | undefined
  if (!loop) {
    loop = new Y.Map<unknown>()
    pmap.set('loop', loop)
  }
  setChanged(loop, 'enabled', project.loop.enabled)
  setChanged(loop, 'start', project.loop.start)
  setChanged(loop, 'end', project.loop.end)
}

/**
 * Reconcile the document to match {@link project} using minimal Yjs deltas.
 * Every write is guarded and id-keyed, so an unchanged project produces no ops
 * (echo-safe) and concurrent edits merge per-field / per-note rather than
 * clobbering the whole document.
 */
export function reconcileDoc(
  doc: Y.Doc,
  project: Project,
  origin: unknown = LOCAL_ORIGIN,
): void {
  doc.transact(() => {
    const pmap = getProjectMap(doc)
    setChanged(pmap, 'schemaVersion', project.schemaVersion)
    setChanged(pmap, 'id', project.id)
    setChanged(pmap, 'name', project.name)
    setChanged(pmap, 'tempo', project.tempo)
    setChanged(pmap, 'ppq', project.ppq)
    setChanged(pmap, 'lengthBeats', project.lengthBeats)
    reconcileLoop(pmap, project)

    let tracks = pmap.get('tracks') as YArray | undefined
    if (!tracks) {
      tracks = new Y.Array<YMap>()
      pmap.set('tracks', tracks)
    }
    reconcileTracks(tracks, project.tracks)
  }, origin)
}

/**
 * Seed an empty document from a project. A no-op when the doc already holds a
 * project, so a late joiner binding onto an existing shared doc never clobbers
 * peers' state.
 */
export function seedProjectDoc(doc: Y.Doc, project: Project): void {
  if (!isProjectDocEmpty(doc)) return
  reconcileDoc(doc, project)
}

function readNote(m: YMap): Record<string, unknown> {
  return {
    id: m.get('id'),
    pitch: m.get('pitch'),
    start: m.get('start'),
    duration: m.get('duration'),
    velocity: m.get('velocity'),
  }
}

function readTrack(m: YMap): Record<string, unknown> {
  const notes = m.get('notes') as YArray | undefined
  return {
    id: m.get('id'),
    name: m.get('name'),
    instrumentId: m.get('instrumentId'),
    muted: m.get('muted'),
    color: m.get('color'),
    notes: notes ? notes.map(readNote) : [],
  }
}

/**
 * Read the current project out of the document, routed through the shared
 * sanitize seam so remote CRDT data can never produce an invalid project.
 */
export function readProject(doc: Y.Doc): Project {
  const pmap = getProjectMap(doc)
  const loop = pmap.get('loop') as YMap | undefined
  const tracks = pmap.get('tracks') as YArray | undefined
  const raw = {
    schemaVersion: pmap.get('schemaVersion'),
    id: pmap.get('id'),
    name: pmap.get('name'),
    tempo: pmap.get('tempo'),
    ppq: pmap.get('ppq'),
    lengthBeats: pmap.get('lengthBeats'),
    loop: loop
      ? { enabled: loop.get('enabled'), start: loop.get('start'), end: loop.get('end') }
      : undefined,
    tracks: tracks ? tracks.map(readTrack) : [],
  }
  return migrateProject(raw)
}
