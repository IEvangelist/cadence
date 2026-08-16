/**
 * Versioned (de)serialization for projects.
 *
 * Persistence is deliberately schema-versioned and defensive: a stored document
 * from an older/partial shape is migrated and coerced into a valid {@link Project}
 * rather than crashing the app. The same {@link migrateProject} seam is where a
 * future backend/DB would translate its rows into the model.
 */
import {
  BEATS_PER_BAR,
  DEFAULT_PPQ,
  DEFAULT_TEMPO,
  SCHEMA_VERSION,
  type InstrumentId,
  type LoopRegion,
  type Note,
  type Project,
  type Track,
  newId,
} from './project'
import { sanitizeAutomation } from './automation'
import { sanitizeProjectMix } from './mix'
import { getInstrument } from '../instruments/registry'

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectParseError'
  }
}

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Playable tempo range (matches the reducer's `set-tempo` clamp). */
const MIN_TEMPO = 20
const MAX_TEMPO = 300

const str = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

/**
 * Coerce a stored instrument id to one the registry actually knows about.
 *
 * This is registry-aware rather than a hardcoded list so that instruments
 * contributed by plugins (or the expanded built-in library) round-trip through
 * persistence instead of being silently reset. Unknown ids fall back to the
 * default `poly-synth`. {@link getInstrument} already falls back for unknown
 * ids, so we compare the resolved id back to the input to detect that fallback.
 */
function coerceInstrument(value: unknown): InstrumentId {
  return typeof value === 'string' && getInstrument(value).id === value
    ? (value as InstrumentId)
    : 'poly-synth'
}

function coerceNote(raw: unknown): Note {
  const n = (raw ?? {}) as Record<string, unknown>
  return {
    id: str(n.id, newId('note')),
    pitch: clamp(Math.round(num(n.pitch, 60)), 0, 127),
    start: Math.max(0, num(n.start, 0)),
    duration: Math.max(1 / 16, num(n.duration, 1)),
    velocity: Math.min(1, Math.max(0, num(n.velocity, 0.8))),
  }
}

function coerceTrack(raw: unknown, index: number): Track {
  const t = (raw ?? {}) as Record<string, unknown>
  const notes = Array.isArray(t.notes) ? t.notes.map(coerceNote) : []
  return {
    id: str(t.id, newId('track')),
    name: str(t.name, `Track ${index + 1}`),
    instrumentId: coerceInstrument(t.instrumentId),
    notes,
    muted: t.muted === true,
    color: str(t.color, '#7a2ff0'),
  }
}

function coerceLoop(raw: unknown, lengthBeats: number): LoopRegion {
  const l = (raw ?? {}) as Record<string, unknown>
  const start = Math.max(0, num(l.start, 0))
  const end = Math.max(start, num(l.end, lengthBeats))
  return { enabled: l.enabled === true, start, end }
}

/**
 * Normalize any stored/parsed value into a valid current-schema project.
 * Accepts legacy documents (missing `schemaVersion`, `loop`, or `ppq`).
 */
export function migrateProject(data: unknown): Project {
  if (data === null || typeof data !== 'object') {
    throw new ProjectParseError('Project data must be an object')
  }
  const raw = data as Record<string, unknown>
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks.map((t, i) => coerceTrack(t, i))
    : []

  const noteEnd = tracks
    .flatMap((t) => t.notes)
    .reduce((max, n) => Math.max(max, n.start + n.duration), 0)
  const lengthBeats = Math.max(
    BEATS_PER_BAR,
    num(raw.lengthBeats, Math.ceil(noteEnd / BEATS_PER_BAR) * BEATS_PER_BAR),
  )

  // Clamp tempo/ppq so a corrupted or hand-edited document can never produce
  // Infinity durations (tempo 0) or divide-by-zero tick math (ppq 0) at play.
  const tempo = clamp(num(raw.tempo, DEFAULT_TEMPO), MIN_TEMPO, MAX_TEMPO)
  const rawPpq = num(raw.ppq, DEFAULT_PPQ)
  const ppq = rawPpq > 0 ? rawPpq : DEFAULT_PPQ
  const normalizedTracks = tracks.length > 0 ? tracks : coerceTrackless()

  return {
    schemaVersion: SCHEMA_VERSION,
    id: str(raw.id, newId('project')),
    name: str(raw.name, 'Untitled'),
    tempo,
    ppq,
    lengthBeats,
    loop: coerceLoop(raw.loop, lengthBeats),
    tracks: normalizedTracks,
    automation: sanitizeAutomation(raw.automation),
    mix: sanitizeProjectMix(raw.mix, normalizedTracks.map((track) => track.id)),
  }
}

function coerceTrackless(): Track[] {
  return [coerceTrack({ name: 'Synth' }, 0)]
}

/** Serialize a project to a JSON string for storage. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project)
}

/** Parse a JSON string into a validated, migrated project. */
export function parseProject(raw: string): Project {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new ProjectParseError('Project data is not valid JSON')
  }
  return migrateProject(data)
}
