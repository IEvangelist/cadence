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
import {
  createProjectMix,
  sanitizeMixParams,
  sanitizeProjectMix,
  type ProjectMixInsert,
  type ProjectTrackMix,
} from './../mix'

/** Origin stamped on every local (non-remote) transaction. */
export const LOCAL_ORIGIN: unique symbol = Symbol('cadence-collab-local')
/** Origin used for deterministic structural repairs during defensive reads. */
export const CRDT_REPAIR_ORIGIN: unique symbol = Symbol('cadence-collab-repair')

/** Root shared-type key holding the whole project. */
export const PROJECT_MAP_KEY = 'project'

type YMap = Y.Map<unknown>
type YArray = Y.Array<YMap>

function isYMap(value: unknown): value is YMap {
  return value instanceof Y.Map
}

function isYArray(value: unknown): value is YArray {
  return value instanceof Y.Array
}

function ensureYMap(parent: YMap, key: string): YMap {
  const current = parent.get(key)
  if (isYMap(current)) return current
  const replacement = new Y.Map<unknown>()
  parent.set(key, replacement)
  return replacement
}

function ensureYArray(parent: YMap, key: string): YArray {
  const current = parent.get(key)
  if (isYArray(current)) return current
  const replacement = new Y.Array<YMap>()
  parent.set(key, replacement)
  return replacement
}

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
  for (const entry of array) {
    if (!isYMap(entry)) continue
    const id = entry.get('id')
    if (typeof id === 'string') byId.set(id, entry)
  }
  return byId
}

function reconcileNotes(notesArray: YArray, notes: Note[]): void {
  const existing = indexById(notesArray)
  const desired = new Set(notes.map((n) => n.id))

  // Remove notes that disappeared (walk backwards so indices stay valid).
  for (let i = notesArray.length - 1; i >= 0; i -= 1) {
    const candidate = notesArray.get(i) as unknown
    if (
      !isYMap(candidate) ||
      typeof candidate.get('id') !== 'string' ||
      !desired.has(candidate.get('id') as string)
    ) {
      notesArray.delete(i, 1)
    }
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
    const candidate = tracksArray.get(i) as unknown
    if (
      !isYMap(candidate) ||
      typeof candidate.get('id') !== 'string' ||
      !desired.has(candidate.get('id') as string)
    ) {
      tracksArray.delete(i, 1)
    }
  }

  tracks.forEach((track) => {
    const current = existing.get(track.id)
    if (current) {
      for (const field of TRACK_FIELDS) setChanged(current, field, track[field])
      reconcileNotes(ensureYArray(current, 'notes'), track.notes)
    } else {
      tracksArray.push([buildTrack(track)])
    }
  })
}

function reconcileLoop(pmap: YMap, project: Project): void {
  const loop = ensureYMap(pmap, 'loop')
  setChanged(loop, 'enabled', project.loop.enabled)
  setChanged(loop, 'start', project.loop.start)
  setChanged(loop, 'end', project.loop.end)
}

function buildParams(params: Readonly<Record<string, number>>): YMap {
  const map = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(params)) map.set(key, value)
  return map
}

function reconcileParams(
  paramsMap: YMap,
  params: Readonly<Record<string, number>>,
): void {
  for (const key of [...paramsMap.keys()]) {
    if (!Object.hasOwn(params, key)) paramsMap.delete(key)
  }
  for (const [key, value] of Object.entries(params)) {
    setChanged(paramsMap, key, value)
  }
}

function buildInsert(insert: ProjectMixInsert): YMap {
  const map = new Y.Map<unknown>()
  map.set('id', insert.id)
  map.set('effectId', insert.effectId)
  map.set('enabled', insert.enabled)
  map.set('params', buildParams(insert.params))
  return map
}

function reconcileInserts(
  insertsArray: YArray,
  inserts: readonly ProjectMixInsert[],
): void {
  const existing = new Map<string, YMap>()
  for (const candidate of insertsArray) {
    if (!isYMap(candidate)) continue
    const id = candidate.get('id')
    if (typeof id === 'string') existing.set(id, candidate)
  }
  const desired = new Set(inserts.map((insert) => insert.id))
  for (let index = insertsArray.length - 1; index >= 0; index -= 1) {
    const candidate = insertsArray.get(index) as unknown
    if (
      !isYMap(candidate) ||
      typeof candidate.get('id') !== 'string' ||
      !desired.has(candidate.get('id') as string)
    ) {
      insertsArray.delete(index, 1)
    }
  }
  for (const insert of inserts) {
    const current = existing.get(insert.id)
    if (!current) {
      insertsArray.push([buildInsert(insert)])
      continue
    }
    setChanged(current, 'effectId', insert.effectId)
    setChanged(current, 'enabled', insert.enabled)
    const params = ensureYMap(current, 'params')
    reconcileParams(params, insert.params)
  }
}

function buildTrackMix(track: ProjectTrackMix): YMap {
  const map = new Y.Map<unknown>()
  map.set('gainDb', track.gainDb)
  map.set('pan', track.pan)
  map.set('solo', track.solo)
  const inserts = new Y.Array<YMap>()
  inserts.push(track.inserts.map(buildInsert))
  map.set('inserts', inserts)
  return map
}

function reconcileTrackMix(map: YMap, track: ProjectTrackMix): void {
  setChanged(map, 'gainDb', track.gainDb)
  setChanged(map, 'pan', track.pan)
  setChanged(map, 'solo', track.solo)
  const inserts = ensureYArray(map, 'inserts')
  reconcileInserts(inserts, track.inserts)
}

function reconcileMix(pmap: YMap, project: Project): void {
  const source =
    project.mix ?? createProjectMix(project.tracks.map((track) => track.id))
  const mix = ensureYMap(pmap, 'mix')
  const master = ensureYMap(mix, 'master')
  setChanged(master, 'gainDb', source.master.gainDb)
  setChanged(master, 'limiterEnabled', source.master.limiterEnabled)
  setChanged(master, 'limiterThresholdDb', source.master.limiterThresholdDb)

  const tracks = ensureYMap(mix, 'tracks')
  const trackIds = new Set(project.tracks.map((track) => track.id))
  for (const trackId of [...tracks.keys()]) {
    if (!trackIds.has(trackId)) tracks.delete(trackId)
  }

  for (const trackId of trackIds) {
    const track = Object.hasOwn(source.tracks, trackId)
      ? source.tracks[trackId]
      : createProjectMix([trackId]).tracks[trackId]
    const current = tracks.get(trackId)
    if (isYMap(current)) reconcileTrackMix(current, track)
    else tracks.set(trackId, buildTrackMix(track))
  }
}

function hasValidMixStructure(projectMap: YMap): boolean {
  const mix = projectMap.get('mix')
  if (!isYMap(mix)) return false
  const master = mix.get('master')
  const mixTracks = mix.get('tracks')
  if (!isYMap(master) || !isYMap(mixTracks)) return false
  if (
    typeof master.get('gainDb') !== 'number' ||
    !Number.isFinite(master.get('gainDb')) ||
    typeof master.get('limiterEnabled') !== 'boolean' ||
    typeof master.get('limiterThresholdDb') !== 'number' ||
    !Number.isFinite(master.get('limiterThresholdDb'))
  ) {
    return false
  }

  const scoreTracks = projectMap.get('tracks')
  if (isYArray(scoreTracks)) {
    for (const scoreTrack of scoreTracks) {
      if (!isYMap(scoreTrack)) continue
      const trackId = scoreTrack.get('id')
      if (typeof trackId !== 'string' || trackId.length === 0) continue
      if (!isYMap(mixTracks.get(trackId))) return false
    }
  }

  for (const trackMix of mixTracks.values()) {
    if (!isYMap(trackMix)) return false
    if (
      typeof trackMix.get('gainDb') !== 'number' ||
      !Number.isFinite(trackMix.get('gainDb')) ||
      typeof trackMix.get('pan') !== 'number' ||
      !Number.isFinite(trackMix.get('pan')) ||
      typeof trackMix.get('solo') !== 'boolean'
    ) {
      return false
    }
    const inserts = trackMix.get('inserts')
    if (!isYArray(inserts)) return false
    for (const insert of inserts) {
      if (
        !isYMap(insert) ||
        typeof insert.get('id') !== 'string' ||
        (insert.get('id') as string).length === 0 ||
        typeof insert.get('effectId') !== 'string' ||
        (insert.get('effectId') as string).length === 0 ||
        typeof insert.get('enabled') !== 'boolean' ||
        !isYMap(insert.get('params'))
      ) {
        return false
      }
      for (const value of (insert.get('params') as YMap).values()) {
        if (typeof value !== 'number' || !Number.isFinite(value)) return false
      }
    }
  }
  return true
}

/** True only when the room carries a complete, structurally valid shared mix. */
export function hasValidSharedMix(doc: Y.Doc): boolean {
  return hasValidMixStructure(getProjectMap(doc))
}

/** Whether the room has any shared mix root key (valid, partial, or malformed). */
export function hasSharedMixRoot(doc: Y.Doc): boolean {
  return getProjectMap(doc).has('mix')
}

/**
 * Backfill an absent/invalid legacy-room mix without touching shared score data.
 * The guarded check runs inside the transaction, so sequential joiners cannot
 * overwrite a mix installed by an earlier peer.
 */
export function backfillSharedMixIfMissing(
  doc: Y.Doc,
  project: Project,
): boolean {
  if (hasValidSharedMix(doc)) return false
  // Only a wholly absent/non-map root may use the joining client's local mix.
  // Partial roots are authoritative: sanitize their valid values + defaults,
  // then use that snapshot to repair only malformed/missing shared fields.
  const sharedProject = readProject(doc)
  const roomTrackIds = sharedProject.tracks.map((track) => track.id)
  const source = hasSharedMixRoot(doc)
    ? sharedProject
    : {
        ...sharedProject,
        mix: sanitizeProjectMix(project.mix, roomTrackIds),
      }
  let changed = false
  doc.transact(() => {
    const projectMap = getProjectMap(doc)
    if (hasValidMixStructure(projectMap)) return
    reconcileMix(projectMap, source)
    changed = true
  }, LOCAL_ORIGIN)
  return changed
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
    reconcileMix(pmap, project)

    reconcileTracks(ensureYArray(pmap, 'tracks'), project.tracks)
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

function stablePart(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''
}

/** Locale-independent total order over the exact UTF-16 code-unit sequence. */
function compareCrdtKeys(left: string, right: string): number {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

function stableRepairId(prefix: string, parts: readonly unknown[]): string {
  const value = parts.map(stablePart).join('|')
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`
}

function uniqueRepairId(
  base: string,
  used: ReadonlySet<string>,
): string {
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function cloneParamsMap(value: unknown): YMap {
  const clone = new Y.Map<unknown>()
  if (!isYMap(value)) return clone
  const sanitized = sanitizeMixParams(Object.fromEntries(value.entries()))
  for (const [key, candidate] of Object.entries(sanitized)) {
    clone.set(key, candidate)
  }
  return clone
}

function cloneInsertMap(value: unknown): YMap | null {
  if (!isYMap(value)) return null
  const clone = new Y.Map<unknown>()
  const id = value.get('id')
  const effectId = value.get('effectId')
  const enabled = value.get('enabled')
  if (typeof id === 'string') clone.set('id', id)
  if (typeof effectId === 'string') clone.set('effectId', effectId)
  if (typeof enabled === 'boolean') clone.set('enabled', enabled)
  clone.set('params', cloneParamsMap(value.get('params')))
  return clone
}

function cloneTrackMixMap(value: unknown): YMap | null {
  if (!isYMap(value)) return null
  const clone = new Y.Map<unknown>()
  const gainDb = value.get('gainDb')
  const pan = value.get('pan')
  const solo = value.get('solo')
  if (typeof gainDb === 'number' && Number.isFinite(gainDb)) {
    clone.set('gainDb', gainDb)
  }
  if (typeof pan === 'number' && Number.isFinite(pan)) clone.set('pan', pan)
  if (typeof solo === 'boolean') clone.set('solo', solo)
  const clonedInserts = new Y.Array<YMap>()
  const inserts = value.get('inserts')
  if (isYArray(inserts)) {
    clonedInserts.push(
      inserts.toArray().flatMap((insert) => {
        const cloned = cloneInsertMap(insert)
        return cloned ? [cloned] : []
      }),
    )
  }
  clone.set('inserts', clonedInserts)
  return clone
}

interface RepairIdPlan {
  projectId: string
  trackIds: ReadonlyMap<YMap, string>
  noteIds: ReadonlyMap<YMap, string>
  insertIds: ReadonlyMap<YMap, string>
}

function existingId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function computeRepairIdPlan(projectMap: YMap): RepairIdPlan {
  const currentProjectId = existingId(projectMap.get('id'))
  const projectId =
    currentProjectId ??
    stableRepairId('project_repaired', [
      projectMap.get('name'),
      projectMap.get('tempo'),
      projectMap.get('ppq'),
      projectMap.get('lengthBeats'),
    ])

  const tracks = projectMap.get('tracks')
  const trackMaps = isYArray(tracks)
    ? tracks.toArray().filter(isYMap)
    : []
  const mix = projectMap.get('mix')
  const mixTracks = isYMap(mix) ? mix.get('tracks') : undefined
  const reservedTrackIds = new Set(
    [
      ...trackMaps.flatMap((track) => {
        const id = existingId(track.get('id'))
        return id ? [id] : []
      }),
      ...(isYMap(mixTracks) ? [...mixTracks.keys()] : []),
    ],
  )
  const usedTrackIds = new Set(reservedTrackIds)
  const seenTrackIds = new Set<string>()
  const trackIds = new Map<YMap, string>()
  trackMaps.forEach((track, trackIndex) => {
    const current = existingId(track.get('id'))
    const keepCurrent = current !== null && !seenTrackIds.has(current)
    const id = keepCurrent
      ? current
      : uniqueRepairId(
          stableRepairId('track_repaired', [
            projectId,
            trackIndex,
            track.get('name'),
            track.get('instrumentId'),
            track.get('color'),
          ]),
          usedTrackIds,
        )
    trackIds.set(track, id)
    usedTrackIds.add(id)
    if (keepCurrent) seenTrackIds.add(id)
  })

  const noteMaps = trackMaps.flatMap((track) => {
    const notes = track.get('notes')
    return isYArray(notes)
      ? notes.toArray().filter(isYMap).map((note, noteIndex) => ({
          note,
          noteIndex,
          trackId: trackIds.get(track) as string,
        }))
      : []
  })
  const reservedNoteIds = new Set(
    noteMaps.flatMap(({ note }) => {
      const id = existingId(note.get('id'))
      return id ? [id] : []
    }),
  )
  const usedNoteIds = new Set(reservedNoteIds)
  const seenNoteIds = new Set<string>()
  const noteIds = new Map<YMap, string>()
  for (const { note, noteIndex, trackId } of noteMaps) {
    const current = existingId(note.get('id'))
    const keepCurrent = current !== null && !seenNoteIds.has(current)
    const id = keepCurrent
      ? current
      : uniqueRepairId(
          stableRepairId('note_repaired', [
            trackId,
            noteIndex,
            note.get('pitch'),
            note.get('start'),
            note.get('duration'),
            note.get('velocity'),
          ]),
          usedNoteIds,
        )
    noteIds.set(note, id)
    usedNoteIds.add(id)
    if (keepCurrent) seenNoteIds.add(id)
  }

  const insertMaps: Array<{
    insert: YMap
    insertIndex: number
    trackId: string
  }> = []
  if (isYMap(mixTracks)) {
    for (const [trackId, trackMix] of [...mixTracks.entries()].sort(
      ([left], [right]) => compareCrdtKeys(left, right),
    )) {
      if (!isYMap(trackMix)) continue
      const inserts = trackMix.get('inserts')
      if (!isYArray(inserts)) continue
      inserts.toArray().forEach((insert, insertIndex) => {
        if (isYMap(insert)) insertMaps.push({ insert, insertIndex, trackId })
      })
    }
  }
  const reservedInsertIds = new Set(
    insertMaps.flatMap(({ insert }) => {
      const id = existingId(insert.get('id'))
      return id ? [id] : []
    }),
  )
  const usedInsertIds = new Set(reservedInsertIds)
  const seenInsertIds = new Set<string>()
  const insertIds = new Map<YMap, string>()
  for (const { insert, insertIndex, trackId } of insertMaps) {
    const current = existingId(insert.get('id'))
    const keepCurrent = current !== null && !seenInsertIds.has(current)
    const params = insert.get('params')
    const paramToken = isYMap(params)
      ? [...params.entries()]
          .sort(([left], [right]) => compareCrdtKeys(left, right))
          .map(([key, value]) => `${key}:${stablePart(value)}`)
          .join(',')
      : ''
    const id = keepCurrent
      ? current
      : uniqueRepairId(
          stableRepairId('insert_repaired', [
            trackId,
            insertIndex,
            insert.get('effectId'),
            insert.get('enabled'),
            paramToken,
          ]),
          usedInsertIds,
        )
    insertIds.set(insert, id)
    usedInsertIds.add(id)
    if (keepCurrent) seenInsertIds.add(id)
  }
  return { projectId, trackIds, noteIds, insertIds }
}

function repairSharedIds(doc: Y.Doc): void {
  const projectMap = getProjectMap(doc)
  const plan = computeRepairIdPlan(projectMap)

  doc.transact(() => {
    if (projectMap.get('id') !== plan.projectId) {
      projectMap.set('id', plan.projectId)
    }
    const tracks = projectMap.get('tracks')
    if (!isYArray(tracks)) return
    const mix = projectMap.get('mix')
    const mixTracks =
      isYMap(mix) && isYMap(mix.get('tracks'))
        ? (mix.get('tracks') as YMap)
        : null

    for (const [track, trackId] of plan.trackIds) {
      const oldId = track.get('id')
      if (oldId === trackId) continue
      track.set('id', trackId)
      // Only an exact old key on this repaired record proves provenance.
      // Unrelated/deleted-track orphans are never assigned by position.
      if (
        mixTracks &&
        typeof oldId === 'string' &&
        isYMap(mixTracks.get(oldId)) &&
        !isYMap(mixTracks.get(trackId))
      ) {
        const cloned = cloneTrackMixMap(mixTracks.get(oldId))
        if (cloned) mixTracks.set(trackId, cloned)
      }
    }
    if (mixTracks) {
      const finalTrackIds = new Set(plan.trackIds.values())
      for (const key of [...mixTracks.keys()]) {
        if (!finalTrackIds.has(key)) mixTracks.delete(key)
      }
    }
    for (const [note, noteId] of plan.noteIds) {
      if (note.get('id') !== noteId) note.set('id', noteId)
    }

    // Cloning a repaired track creates fresh insert maps; recompute so those
    // maps receive the same globally collision-free deterministic ids.
    const repairedPlan = computeRepairIdPlan(projectMap)
    for (const [insert, insertId] of repairedPlan.insertIds) {
      if (insert.get('id') !== insertId) insert.set('id', insertId)
    }
  }, CRDT_REPAIR_ORIGIN)
}

function readNote(
  value: unknown,
  ids: RepairIdPlan,
): Record<string, unknown> | null {
  if (!isYMap(value)) return null
  return {
    id: ids.noteIds.get(value) ?? value.get('id'),
    pitch: value.get('pitch'),
    start: value.get('start'),
    duration: value.get('duration'),
    velocity: value.get('velocity'),
  }
}

function readTrack(
  value: unknown,
  ids: RepairIdPlan,
): Record<string, unknown> | null {
  if (!isYMap(value)) return null
  const notes = value.get('notes')
  return {
    id: ids.trackIds.get(value) ?? value.get('id'),
    name: value.get('name'),
    instrumentId: value.get('instrumentId'),
    muted: value.get('muted'),
    color: value.get('color'),
    notes: isYArray(notes)
      ? notes.toArray().flatMap((note) => {
          const decoded = readNote(note, ids)
          return decoded ? [decoded] : []
        })
      : [],
  }
}

function readInsert(
  value: unknown,
  ids: RepairIdPlan,
): Record<string, unknown> | null {
  if (!isYMap(value)) return null
  const params = value.get('params')
  return {
    id: ids.insertIds.get(value) ?? value.get('id'),
    effectId: value.get('effectId'),
    enabled: value.get('enabled'),
    params: isYMap(params) ? Object.fromEntries(params.entries()) : {},
  }
}

function readTrackMix(
  value: unknown,
  ids: RepairIdPlan,
): Record<string, unknown> | null {
  if (!isYMap(value)) return null
  const inserts = value.get('inserts')
  return {
    gainDb: value.get('gainDb'),
    pan: value.get('pan'),
    solo: value.get('solo'),
    inserts: isYArray(inserts)
      ? inserts.toArray().flatMap((insert) => {
          const decoded = readInsert(insert, ids)
          return decoded ? [decoded] : []
        })
      : [],
  }
}

function readMix(
  value: unknown,
  ids: RepairIdPlan,
): Record<string, unknown> | undefined {
  if (!isYMap(value)) return undefined
  const master = value.get('master')
  const tracks = value.get('tracks')
  const decodedTracks: Array<[string, Record<string, unknown>]> = []
  if (isYMap(tracks)) {
    for (const [trackId, track] of tracks.entries()) {
      const decoded = readTrackMix(track, ids)
      if (decoded) decodedTracks.push([trackId, decoded])
    }
  }
  return {
    tracks: Object.fromEntries(decodedTracks),
    master: isYMap(master)
      ? {
          gainDb: master.get('gainDb'),
          limiterEnabled: master.get('limiterEnabled'),
          limiterThresholdDb: master.get('limiterThresholdDb'),
        }
      : undefined,
  }
}

/**
 * Read the current project out of the document, routed through the shared
 * sanitize seam so remote CRDT data can never produce an invalid project.
 */
export interface ReadProjectOptions {
  /** Writers repair deterministic ids in the Y.Doc; viewers decode purely. */
  repair?: boolean
}

export function readProject(
  doc: Y.Doc,
  options: ReadProjectOptions = {},
): Project {
  let repairIds = computeRepairIdPlan(getProjectMap(doc))
  if (options.repair !== false) {
    repairSharedIds(doc)
    repairIds = computeRepairIdPlan(getProjectMap(doc))
  }
  const pmap = getProjectMap(doc)
  const loop = pmap.get('loop')
  const tracks = pmap.get('tracks')
  const decodedTracks = isYArray(tracks)
    ? tracks.toArray().flatMap((track) => {
        const decoded = readTrack(track, repairIds)
        return decoded ? [decoded] : []
      })
    : []
  const deterministicFallbackTrack = {
    id: stableRepairId('track_repaired', ['fallback', pmap.get('id')]),
    name: 'Synth',
    instrumentId: 'poly-synth',
    muted: false,
    color: '#7a2ff0',
    notes: [],
  }
  const decodedMix = readMix(pmap.get('mix'), repairIds)
  const raw = {
    schemaVersion: pmap.get('schemaVersion'),
    id: repairIds.projectId,
    name: pmap.get('name'),
    tempo: pmap.get('tempo'),
    ppq: pmap.get('ppq'),
    lengthBeats: pmap.get('lengthBeats'),
    loop: isYMap(loop)
      ? { enabled: loop.get('enabled'), start: loop.get('start'), end: loop.get('end') }
      : undefined,
    tracks: decodedTracks.length > 0 ? decodedTracks : [deterministicFallbackTrack],
    mix: decodedMix,
  }
  const project = migrateProject(raw)
  // CRDT mix rollout is independent from the serialized project schema. A
  // schema-v2 legacy room may already contain an authoritative shared mix, so
  // sanitize that branch directly instead of letting migrateProject discard it.
  if (decodedMix) {
    project.mix = sanitizeProjectMix(
      decodedMix,
      project.tracks.map((track) => track.id),
    )
  }
  return project
}
