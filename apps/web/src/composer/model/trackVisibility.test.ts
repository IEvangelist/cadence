import { describe, expect, it } from 'vitest'
import { createNote, createTrack } from './project'
import { selectVisibleTracks, selectVisibleTrackIds } from './trackVisibility'

const lead = createTrack(
  { name: 'Lead', notes: [createNote({ pitch: 60, start: 0 })] },
  'track_lead',
)
const bass = createTrack(
  { name: 'Bass', notes: [createNote({ pitch: 40, start: 0 })] },
  'track_bass',
)
const pad = createTrack({ name: 'Pad' }, 'track_pad')
const tracks = [lead, bass, pad]

describe('selectVisibleTracks', () => {
  it('always includes the selected track even when nothing is toggled on', () => {
    const visible = selectVisibleTracks(tracks, new Set(), 'track_bass')
    expect(visible).toEqual([bass])
  })

  it('adds context tracks alongside the selected one', () => {
    const visible = selectVisibleTracks(tracks, new Set(['track_pad']), 'track_lead')
    expect(visible.map((t) => t.id)).toEqual(['track_lead', 'track_pad'])
  })

  it('does not duplicate the selected track when it is also in the context set', () => {
    const visible = selectVisibleTracks(
      tracks,
      new Set(['track_lead', 'track_bass']),
      'track_lead',
    )
    expect(visible.map((t) => t.id)).toEqual(['track_lead', 'track_bass'])
  })

  it('preserves project order regardless of set insertion order', () => {
    const visible = selectVisibleTracks(
      tracks,
      new Set(['track_pad', 'track_bass']),
      'track_lead',
    )
    expect(visible.map((t) => t.id)).toEqual(['track_lead', 'track_bass', 'track_pad'])
  })

  it('ignores stale ids that no longer name a live track', () => {
    const visible = selectVisibleTracks(
      tracks,
      new Set(['track_deleted']),
      'track_lead',
    )
    expect(visible.map((t) => t.id)).toEqual(['track_lead'])
  })

  it('returns an empty list when the selection is empty and nothing is toggled', () => {
    expect(selectVisibleTracks(tracks, new Set(), '')).toEqual([])
  })
})

describe('selectVisibleTrackIds', () => {
  it('projects the visible tracks down to their ids', () => {
    expect(
      selectVisibleTrackIds(tracks, new Set(['track_pad']), 'track_lead'),
    ).toEqual(['track_lead', 'track_pad'])
  })
})
