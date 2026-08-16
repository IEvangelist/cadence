/** Persisted project mixer state. Track mute remains owned by Track.muted. */

export const TRACK_GAIN_MIN = -60
export const TRACK_GAIN_MAX = 6
export const TRACK_PAN_MIN = -1
export const TRACK_PAN_MAX = 1
export const LIMITER_THRESHOLD_MIN = -60
export const LIMITER_THRESHOLD_MAX = 0

const PARAM_MIN = -1_000_000
const PARAM_MAX = 1_000_000

export interface ProjectMixInsert {
  id: string
  effectId: string
  enabled: boolean
  params: Record<string, number>
}

export interface ProjectTrackMix {
  gainDb: number
  pan: number
  solo: boolean
  inserts: ProjectMixInsert[]
}

export interface ProjectMasterMix {
  gainDb: number
  limiterEnabled: boolean
  limiterThresholdDb: number
}

export interface ProjectMix {
  tracks: Record<string, ProjectTrackMix>
  master: ProjectMasterMix
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

export const neutralTrackMix = (): ProjectTrackMix => ({
  gainDb: 0,
  pan: 0,
  solo: false,
  inserts: [],
})

export const neutralMasterMix = (): ProjectMasterMix => ({
  gainDb: 0,
  limiterEnabled: false,
  limiterThresholdDb: -1,
})

export function createProjectMix(trackIds: readonly string[]): ProjectMix {
  return {
    tracks: Object.fromEntries(trackIds.map((trackId) => [trackId, neutralTrackMix()])),
    master: neutralMasterMix(),
  }
}

function sanitizeParams(value: unknown): Record<string, number> {
  const params: Record<string, number> = {}
  for (const [key, candidate] of Object.entries(record(value))) {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) continue
    params[key] = clamp(candidate, PARAM_MIN, PARAM_MAX)
  }
  return params
}

function sanitizeInsert(value: unknown): ProjectMixInsert | null {
  const raw = record(value)
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.effectId !== 'string' || raw.effectId.length === 0) return null
  return {
    id: raw.id,
    effectId: raw.effectId,
    enabled: raw.enabled !== false,
    params: sanitizeParams(raw.params),
  }
}

function sanitizeTrackMix(value: unknown): ProjectTrackMix {
  const raw = record(value)
  return {
    gainDb: clamp(finite(raw.gainDb, 0), TRACK_GAIN_MIN, TRACK_GAIN_MAX),
    pan: clamp(finite(raw.pan, 0), TRACK_PAN_MIN, TRACK_PAN_MAX),
    solo: raw.solo === true,
    inserts: Array.isArray(raw.inserts)
      ? raw.inserts.flatMap((insert) => {
          const sanitized = sanitizeInsert(insert)
          return sanitized ? [sanitized] : []
        })
      : [],
  }
}

/**
 * Sanitize a persisted mix against the current track set. Every live track gets
 * neutral defaults and orphaned entries are omitted. Effect ids are deliberately
 * not registry-validated so unavailable plugin inserts survive round trips.
 */
export function sanitizeProjectMix(value: unknown, trackIds: readonly string[]): ProjectMix {
  const raw = record(value)
  const rawTracks = record(raw.tracks)
  const rawMaster = record(raw.master)
  const tracks: Record<string, ProjectTrackMix> = {}
  for (const trackId of trackIds) tracks[trackId] = sanitizeTrackMix(rawTracks[trackId])
  return {
    tracks,
    master: {
      gainDb: clamp(finite(rawMaster.gainDb, 0), TRACK_GAIN_MIN, TRACK_GAIN_MAX),
      limiterEnabled: rawMaster.limiterEnabled === true,
      limiterThresholdDb: clamp(
        finite(rawMaster.limiterThresholdDb, -1),
        LIMITER_THRESHOLD_MIN,
        LIMITER_THRESHOLD_MAX,
      ),
    },
  }
}

function withTrack(
  mix: ProjectMix | undefined,
  trackId: string,
  update: (track: ProjectTrackMix) => ProjectTrackMix,
): ProjectMix {
  const current = mix ?? createProjectMix([])
  return {
    ...current,
    tracks: {
      ...current.tracks,
      [trackId]: update(current.tracks[trackId] ?? neutralTrackMix()),
    },
  }
}

export function ensureTrackMix(mix: ProjectMix | undefined, trackId: string): ProjectMix {
  return withTrack(mix, trackId, (track) => track)
}

export function removeTrackMix(mix: ProjectMix | undefined, trackId: string): ProjectMix {
  const current = mix ?? createProjectMix([])
  const tracks = { ...current.tracks }
  delete tracks[trackId]
  return { ...current, tracks }
}

export function setTrackMix(
  mix: ProjectMix | undefined,
  trackId: string,
  changes: Partial<Pick<ProjectTrackMix, 'gainDb' | 'pan' | 'solo'>>,
): ProjectMix {
  return withTrack(mix, trackId, (track) => ({
    ...track,
    gainDb:
      changes.gainDb === undefined
        ? track.gainDb
        : clamp(changes.gainDb, TRACK_GAIN_MIN, TRACK_GAIN_MAX),
    pan:
      changes.pan === undefined
        ? track.pan
        : clamp(changes.pan, TRACK_PAN_MIN, TRACK_PAN_MAX),
    solo: changes.solo ?? track.solo,
  }))
}

export function addMixInsert(
  mix: ProjectMix | undefined,
  trackId: string,
  insert: ProjectMixInsert,
): ProjectMix {
  return withTrack(mix, trackId, (track) => ({
    ...track,
    inserts: [...track.inserts, insert],
  }))
}

export function removeMixInsert(
  mix: ProjectMix | undefined,
  trackId: string,
  insertId: string,
): ProjectMix {
  return withTrack(mix, trackId, (track) => ({
    ...track,
    inserts: track.inserts.filter((insert) => insert.id !== insertId),
  }))
}

export function setMixInsertEnabled(
  mix: ProjectMix | undefined,
  trackId: string,
  insertId: string,
  enabled: boolean,
): ProjectMix {
  return withTrack(mix, trackId, (track) => ({
    ...track,
    inserts: track.inserts.map((insert) =>
      insert.id === insertId ? { ...insert, enabled } : insert,
    ),
  }))
}

export function setMasterMix(
  mix: ProjectMix | undefined,
  changes: Partial<ProjectMasterMix>,
): ProjectMix {
  const current = mix ?? createProjectMix([])
  return {
    ...current,
    master: {
      gainDb:
        changes.gainDb === undefined
          ? current.master.gainDb
          : clamp(changes.gainDb, TRACK_GAIN_MIN, TRACK_GAIN_MAX),
      limiterEnabled: changes.limiterEnabled ?? current.master.limiterEnabled,
      limiterThresholdDb:
        changes.limiterThresholdDb === undefined
          ? current.master.limiterThresholdDb
          : clamp(
              changes.limiterThresholdDb,
              LIMITER_THRESHOLD_MIN,
              LIMITER_THRESHOLD_MAX,
            ),
    },
  }
}
