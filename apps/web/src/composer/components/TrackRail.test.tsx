import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComposerController } from '../hooks/useComposer'
import { createNote, createTrack, type Project } from '../model/project'
import { TrackRail } from './TrackRail'
import { trackRequiresDeleteConfirmation } from './trackRailModel'
import { coversInteractions } from '../../test/coversInteractions'

function controller(project: Project): ComposerController {
  return {
    project,
    selectedTrackId: project.tracks[0]?.id ?? '',
    visibleTrackIds: project.tracks.map((track) => track.id),
    selectTrack: vi.fn(),
    toggleMute: vi.fn(),
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
    toggleTrackVisibility: vi.fn(),
    setAllTracksVisible: vi.fn(),
    mixer: {
      getSnapshot: () => ({
        tracks: Object.fromEntries(
          project.tracks.map((track) => [
            track.id,
            { trackId: track.id, gainDb: 0, pan: 0, solo: false, muted: track.muted },
          ]),
        ),
        master: { gainDb: 0, limiterEnabled: false, limiterThresholdDb: -1 },
      }),
      listInserts: () => [],
    },
  } as unknown as ComposerController
}

function projectWithTracks(): Project {
  return {
    schemaVersion: 2,
    id: 'project',
    name: 'Test',
    tempo: 120,
    ppq: 480,
    lengthBeats: 16,
    loop: { enabled: false, start: 0, end: 16 },
    tracks: [
      createTrack({ name: 'Clean' }, 'clean'),
      createTrack({ name: 'Written', notes: [createNote({ pitch: 60, start: 0 })] }, 'written'),
    ],
    automation: [],
  }
}

describe('<TrackRail />', () => {
  it('selects tracks, exposes the #157 trailing slot, and opens instrument discovery', async () => {
    coversInteractions(
      'studio.track.add',
      'studio.track.select',
      'studio.track.visibility-all',
      'studio.track.visibility',
      'studio.track.mute',
    )
    const user = userEvent.setup()
    const value = controller(projectWithTracks())
    render(
      <TrackRail
        controller={value}
        renderTrailing={(track) => <span>Meter {track.name}</span>}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Select Written' }))
    expect(value.selectTrack).toHaveBeenCalledWith('written')
    expect(screen.getByText('Meter Written')).toBeInTheDocument()
  })

  it('deletes an empty track immediately but confirms destructive track data', async () => {
    coversInteractions(
      'studio.track.delete',
      'studio.track.delete.dialog',
      'studio.track.delete.confirm',
      'studio.track.delete.cancel',
    )
    const user = userEvent.setup()
    const value = controller(projectWithTracks())
    render(<TrackRail controller={value} />)

    await user.click(screen.getByRole('button', { name: 'Delete Clean' }))
    expect(value.removeTrack).toHaveBeenCalledWith('clean')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Written' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'This removes its notes, automation, and mix settings.',
    )
    expect(value.removeTrack).not.toHaveBeenCalledWith('written')
    expect(screen.getByRole('alertdialog')).toContainElement(
      document.activeElement as HTMLElement,
    )

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Written' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Delete Written' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Written' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Delete Written' }))
    await user.click(screen.getByRole('button', { name: 'Delete track' }))
    expect(value.removeTrack).toHaveBeenCalledWith('written')
  })

  it('detects automation and non-default mixer state as destructive data', () => {
    const project = projectWithTracks()
    project.automation = [
      { target: 'trackGain', trackId: 'clean', points: [{ beat: 0, value: -3 }] },
    ]
    const value = controller(project)
    expect(trackRequiresDeleteConfirmation(value, project.tracks[0])).toBe(true)

    project.automation = []
    const mixer = value.mixer.getSnapshot()
    mixer.tracks.clean.pan = 0.5
    value.mixer.getSnapshot = () => mixer
    expect(trackRequiresDeleteConfirmation(value, project.tracks[0])).toBe(true)
  })
})
