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
    server.automation = [
      {
        target: 'trackGain',
        trackId: 'track',
        points: [{ beat: 1, value: -3 }, { beat: 4, value: -6 }],
      },
      {
        target: 'masterGain',
        points: [{ beat: 8, value: -2 }],
      },
    ]
    server.mix = {
      tracks: {
        track: {
          gainDb: -2,
          pan: 0,
          solo: false,
          inserts: [
            {
              id: 'shared-insert',
              effectId: 'delay',
              enabled: true,
              params: { mix: 0.2, feedback: 0.4 },
            },
            {
              id: 'server-insert',
              effectId: 'reverb',
              enabled: true,
              params: { mix: 0.3 },
            },
          ],
        },
        'remote-track': {
          gainDb: -4,
          pan: 0.2,
          solo: false,
          inserts: [],
        },
      },
      master: {
        gainDb: -2,
        limiterEnabled: true,
        limiterThresholdDb: -3,
      },
    }

    const backup = createEmptyProject('shared')
    backup.name = 'Offline project name'
    const backupTrack = createTrack({ name: 'Offline name' }, 'track')
    backupTrack.notes = [
      createNote({ pitch: 62, start: 1 }, 'common'),
      createNote({ pitch: 64, start: 3 }, 'offline-only'),
    ]
    backup.tracks = [backupTrack]
    backup.automation = [
      {
        target: 'trackGain',
        trackId: 'track',
        points: [{ beat: 1, value: -9 }, { beat: 2, value: -5 }],
      },
    ]
    backup.mix = {
      tracks: {
        track: {
          gainDb: -8,
          pan: -0.4,
          solo: true,
          inserts: [
            {
              id: 'shared-insert',
              effectId: 'delay',
              enabled: false,
              params: { mix: 0.8 },
            },
            {
              id: 'backup-insert',
              effectId: 'chorus',
              enabled: true,
              params: { depth: 0.5 },
            },
          ],
        },
      },
      master: {
        gainDb: -6,
        limiterEnabled: false,
        limiterThresholdDb: -1,
      },
    }

    const merged = mergeSerializedBackup(server, backup)

    expect(merged.name).toBe('Offline project name')
    expect(merged.tracks.map((track) => track.id))
      .toEqual(['track', 'remote-track'])
    expect(merged.tracks[0].name).toBe('Offline name')
    expect(merged.tracks[0].notes.map((note) => note.id))
      .toEqual(['common', 'offline-only', 'server-only'])
    expect(merged.tracks[0].notes[0].pitch).toBe(62)
    expect(merged.automation).toEqual([
      {
        target: 'trackGain',
        trackId: 'track',
        points: [
          { beat: 1, value: -9 },
          { beat: 2, value: -5 },
          { beat: 4, value: -6 },
        ],
      },
      {
        target: 'masterGain',
        points: [{ beat: 8, value: -2 }],
      },
    ])
    expect(merged.mix?.tracks.track).toMatchObject({
      gainDb: -8,
      pan: -0.4,
      solo: true,
    })
    expect(merged.mix?.tracks.track.inserts.map((insert) => insert.id)).toEqual([
      'shared-insert',
      'backup-insert',
      'server-insert',
    ])
    expect(merged.mix?.tracks.track.inserts[0].params).toEqual({
      mix: 0.8,
      feedback: 0.4,
    })
    expect(merged.mix?.tracks['remote-track']).toEqual(
      server.mix.tracks['remote-track'],
    )
    expect(merged.mix?.master).toEqual(backup.mix.master)
  })
})
