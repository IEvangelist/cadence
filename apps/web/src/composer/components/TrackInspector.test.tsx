import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ComposerController } from '../hooks/useComposer'
import { createEmptyProject } from '../model/project'
import type { InstrumentDefinition } from '../plugins/types'
import { TrackInspector } from './TrackInspector'

const instruments: InstrumentDefinition[] = [
  {
    id: 'synth',
    name: 'Synth',
    kind: 'synth',
    group: 'Synths',
    description: 'Subtractive synth',
    polyphonic: true,
  },
  {
    id: 'drum',
    name: 'Drum Kit',
    kind: 'drum',
    group: 'Drums',
    description: 'Drum voice',
    polyphonic: true,
  },
  {
    id: 'sampled',
    name: 'Sampled Piano',
    kind: 'synth',
    group: 'Keys',
    description: 'Lazy sampled piano',
    polyphonic: true,
  },
  {
    id: 'plugin',
    name: 'Plugin Marimba',
    kind: 'synth',
    group: 'Mallets',
    description: 'Plugin-contributed mallet',
    polyphonic: true,
  },
]

function controller(): ComposerController {
  const project = createEmptyProject('project')
  project.tracks[0].id = 'track'
  project.tracks[0].instrumentId = 'poly-synth'
  return {
    project,
    selectedTrackId: 'track',
    renameTrack: vi.fn(),
    setInstrument: vi.fn(),
  } as unknown as ComposerController
}

describe('<TrackInspector />', () => {
  it('renames the selected track and assigns representative registry instruments only to it', async () => {
    const user = userEvent.setup()
    const value = controller()
    render(
      <TrackInspector
        controller={value}
        getInstruments={() => instruments}
        subscribeInstruments={() => () => {}}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'Track name' }), {
      target: { value: 'Lead' },
    })
    expect(value.renameTrack).toHaveBeenLastCalledWith('track', 'Lead')

    for (const instrument of instruments) {
      await user.click(screen.getByRole('button', { name: /Choose instrument for Synth/ }))
      await user.click(
        within(screen.getByRole('listbox')).getByRole('option', {
          name: new RegExp(instrument.name),
        }),
      )
      expect(value.setInstrument).toHaveBeenLastCalledWith('track', instrument.id)
    }
  })
})
