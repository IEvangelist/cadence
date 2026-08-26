import type { Note, Project, Track } from '../project'

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
  }
}
