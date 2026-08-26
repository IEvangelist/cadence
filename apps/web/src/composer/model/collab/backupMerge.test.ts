import { describe, expect, it } from 'vitest'
import { createEmptyProject, createNote, createTrack } from '../project'
import { mergeSerializedBackup } from './backupMerge'

describe('mergeSerializedBackup', () => {
  it('gives offline backup conflicts precedence while retaining server-only work', () => {
    const server = createEmptyProject('shared')
    const serverTrack = createTrack({ name: 'Server name' }, 'track')
    serverTrack.notes = [
      createNote({ pitch: 60, start: 0 }, 'common'),
      createNote({ pitch: 67, start: 2 }, 'server-only'),
    ]
    server.tracks = [
      serverTrack,
      createTrack({ name: 'Remote track' }, 'remote-track'),
    ]

    const backup = createEmptyProject('shared')
    backup.name = 'Offline project name'
    const backupTrack = createTrack({ name: 'Offline name' }, 'track')
    backupTrack.notes = [
      createNote({ pitch: 62, start: 1 }, 'common'),
      createNote({ pitch: 64, start: 3 }, 'offline-only'),
    ]
    backup.tracks = [backupTrack]

    const merged = mergeSerializedBackup(server, backup)

    expect(merged.name).toBe('Offline project name')
    expect(merged.tracks.map((track) => track.id))
      .toEqual(['track', 'remote-track'])
    expect(merged.tracks[0].name).toBe('Offline name')
    expect(merged.tracks[0].notes.map((note) => note.id))
      .toEqual(['common', 'offline-only', 'server-only'])
    expect(merged.tracks[0].notes[0].pitch).toBe(62)
  })
})
