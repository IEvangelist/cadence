import type { Note, Project, Track } from '../project'
import type { AutomationLane, AutomationPoint } from '../automation'
import type {
  ProjectMix,
  ProjectMixInsert,
  ProjectTrackMix,
} from '../mix'

function mergeNotes(server: Note[], backup: Note[]): Note[] {
  const serverById = new Map(server.map((note) => [note.id, note]))
  const merged = backup.map((note) => ({ ...serverById.get(note.id), ...note }))
  const backupIds = new Set(backup.map((note) => note.id))
  return [
    ...merged,
    ...server.filter((note) => !backupIds.has(note.id)).map((note) => ({ ...note })),
  ]
}

function mergeTrack(server: Track, backup: Track): Track {
  return {
    ...server,
    ...backup,
    notes: mergeNotes(server.notes, backup.notes),
  }
}

function laneKey(lane: AutomationLane): string {
  return `${lane.target}:${lane.trackId ?? ''}`
}

function mergePoints(
  server: readonly AutomationPoint[],
  backup: readonly AutomationPoint[],
): AutomationPoint[] {
  const byBeat = new Map(server.map((point) => [point.beat, { ...point }]))
  for (const point of backup) byBeat.set(point.beat, { ...point })
  return [...byBeat.values()].sort((left, right) => left.beat - right.beat)
}

function mergeAutomation(
  server: readonly AutomationLane[] = [],
  backup: readonly AutomationLane[] = [],
): AutomationLane[] {
  const serverByKey = new Map(server.map((lane) => [laneKey(lane), lane]))
  const merged = backup.map((lane) => {
    const serverLane = serverByKey.get(laneKey(lane))
    return {
      ...serverLane,
      ...lane,
      points: mergePoints(serverLane?.points ?? [], lane.points),
    }
  })
  const backupKeys = new Set(backup.map(laneKey))
  merged.push(
    ...server
      .filter((lane) => !backupKeys.has(laneKey(lane)))
      .map((lane) => ({
        ...lane,
        points: lane.points.map((point) => ({ ...point })),
      })),
  )
  return merged
}

function mergeInserts(
  server: ProjectMixInsert[],
  backup: ProjectMixInsert[],
): ProjectMixInsert[] {
  const serverById = new Map(server.map((insert) => [insert.id, insert]))
  const merged = backup.map((insert) => {
    const serverInsert = serverById.get(insert.id)
    return {
      ...serverInsert,
      ...insert,
      params: { ...serverInsert?.params, ...insert.params },
    }
  })
  const backupIds = new Set(backup.map((insert) => insert.id))
  return [
    ...merged,
    ...server
      .filter((insert) => !backupIds.has(insert.id))
      .map((insert) => ({ ...insert, params: { ...insert.params } })),
  ]
}

function mergeTrackMix(
  server: ProjectTrackMix | undefined,
  backup: ProjectTrackMix | undefined,
): ProjectTrackMix | undefined {
  if (!server && !backup) return undefined
  return {
    ...(server ?? backup!),
    ...backup,
    inserts: mergeInserts(server?.inserts ?? [], backup?.inserts ?? []),
  }
}

function mergeMix(
  server: ProjectMix | undefined,
  backup: ProjectMix | undefined,
): ProjectMix | undefined {
  if (!server && !backup) return undefined
  const trackIds = new Set([
    ...Object.keys(server?.tracks ?? {}),
    ...Object.keys(backup?.tracks ?? {}),
  ])
  return {
    tracks: Object.fromEntries(
      [...trackIds].flatMap((trackId) => {
        const merged = mergeTrackMix(
          server?.tracks[trackId],
          backup?.tracks[trackId],
        )
        return merged ? [[trackId, merged]] : []
      }),
    ),
    master: {
      ...(server?.master ?? backup!.master),
      ...backup?.master,
    },
  }
}

/**
 * Recover a lossy serialized fallback without discarding relay-only work.
 * Backup values win same-id/same-field conflicts (they are the offline edits);
 * server-only tracks and notes are retained. This deliberately favors no data
 * loss over inferring deletions that a snapshot without its CRDT cannot prove.
 */
export function mergeSerializedBackup(
  server: Project,
  backup: Project,
): Project {
  const serverById = new Map(server.tracks.map((track) => [track.id, track]))
  const tracks = backup.tracks.map((track) => {
    const serverTrack = serverById.get(track.id)
    return serverTrack
      ? mergeTrack(serverTrack, track)
      : { ...track, notes: track.notes.map((note) => ({ ...note })) }
  })
  const backupIds = new Set(backup.tracks.map((track) => track.id))
  tracks.push(
    ...server.tracks
      .filter((track) => !backupIds.has(track.id))
      .map((track) => ({
        ...track,
        notes: track.notes.map((note) => ({ ...note })),
      })),
  )
  return {
    ...server,
    ...backup,
    tracks,
    automation: mergeAutomation(server.automation, backup.automation),
    mix: mergeMix(server.mix, backup.mix),
  }
}
