/** Persisted project mixer state. Track mute remains owned by Track.muted. */

export const TRACK_GAIN_MIN = -60
export const TRACK_GAIN_MAX = 6
export const TRACK_PAN_MIN = -1
export const TRACK_PAN_MAX = 1
export const LIMITER_THRESHOLD_MIN = -60
export const LIMITER_THRESHOLD_MAX = 0

export const EFFECT_PARAM_MIN = -1_000_000
export const EFFECT_PARAM_MAX = 1_000_000

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

export const clampFinite = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number => {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, candidate))
}

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

export function sanitizeMixParams(value: unknown): Record<string, number> {
  const entries: Array<[string, number]> = []
  for (const [key, candidate] of Object.entries(record(value))) {
    const hasControlCharacter = [...key].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 31 || codePoint === 127
    })
    if (
      key.length === 0 ||
      key.length > 128 ||
      hasControlCharacter ||
      key === '__proto__' ||
      key === 'prototype' ||
      key === 'constructor'
    ) {
      continue
    }
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) continue
    entries.push([
      key,
      clampFinite(candidate, EFFECT_PARAM_MIN, EFFECT_PARAM_MAX, 0),
    ])
  }
  return Object.fromEntries(entries)
}

function sanitizeInsert(value: unknown): ProjectMixInsert | null {
  const raw = record(value)
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null
  if (typeof raw.effectId !== 'string' || raw.effectId.length === 0) return null
  return {
    id: raw.id,
    effectId: raw.effectId,
    enabled: raw.enabled !== false,
    params: sanitizeMixParams(raw.params),
  }
}

function sanitizeTrackMix(value: unknown): ProjectTrackMix {
  const raw = record(value)
  return {
    gainDb: clampFinite(raw.gainDb, TRACK_GAIN_MIN, TRACK_GAIN_MAX, 0),
    pan: clampFinite(raw.pan, TRACK_PAN_MIN, TRACK_PAN_MAX, 0),
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
  const tracks = Object.fromEntries(
    trackIds.map((trackId) => [
      trackId,
      sanitizeTrackMix(Object.hasOwn(rawTracks, trackId) ? rawTracks[trackId] : undefined),
    ]),
  )
  return {
    tracks,
    master: {
      gainDb: clampFinite(rawMaster.gainDb, TRACK_GAIN_MIN, TRACK_GAIN_MAX, 0),
      limiterEnabled: rawMaster.limiterEnabled === true,
      limiterThresholdDb: clampFinite(
        rawMaster.limiterThresholdDb,
        LIMITER_THRESHOLD_MIN,
        LIMITER_THRESHOLD_MAX,
        -1,
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
  const track = Object.hasOwn(current.tracks, trackId)
    ? current.tracks[trackId]
    : neutralTrackMix()
  return {
    ...current,
    tracks: {
      ...current.tracks,
      [trackId]: update(track),
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
        : clampFinite(changes.gainDb, TRACK_GAIN_MIN, TRACK_GAIN_MAX, track.gainDb),
    pan:
      changes.pan === undefined
        ? track.pan
        : clampFinite(changes.pan, TRACK_PAN_MIN, TRACK_PAN_MAX, track.pan),
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
    inserts: [...track.inserts, { ...insert, params: sanitizeMixParams(insert.params) }],
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

export function setMixInsertParams(
  mix: ProjectMix | undefined,
  trackId: string,
  insertId: string,
  params: Readonly<Record<string, number>>,
): ProjectMix {
  return withTrack(mix, trackId, (track) => ({
    ...track,
    inserts: track.inserts.map((insert) =>
      insert.id === insertId
        ? { ...insert, params: sanitizeMixParams(params) }
        : insert,
    ),
  }))
}

export function setMixInsertParam(
  mix: ProjectMix | undefined,
  trackId: string,
  insertId: string,
  parameterId: string,
  value: number,
): ProjectMix {
  return withTrack(mix, trackId, (track) => ({
    ...track,
    inserts: track.inserts.map((insert) =>
      insert.id === insertId
        ? {
            ...insert,
            params: sanitizeMixParams({
              ...insert.params,
              [parameterId]: value,
            }),
          }
        : insert,
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
          : clampFinite(
              changes.gainDb,
              TRACK_GAIN_MIN,
              TRACK_GAIN_MAX,
              current.master.gainDb,
            ),
      limiterEnabled: changes.limiterEnabled ?? current.master.limiterEnabled,
      limiterThresholdDb:
        changes.limiterThresholdDb === undefined
          ? current.master.limiterThresholdDb
          : clampFinite(
              changes.limiterThresholdDb,
              LIMITER_THRESHOLD_MIN,
              LIMITER_THRESHOLD_MAX,
              current.master.limiterThresholdDb,
            ),
    },
  }
}
