import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { TrackPanel } from './TrackPanel'
import { useComposer } from '../hooks/useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject } from '../model/project'

function Harness() {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  })
  return <TrackPanel controller={controller} />
}

describe('<TrackPanel />', () => {
  it('adds, renames, mutes, and removes tracks', () => {
    coversInteractions(
      'studio.track.add',
      'studio.track.name',
      'studio.track.mute',
      'studio.track.delete',
    )
    render(<Harness />)

    // Single track: delete is disabled.
    expect(screen.getByRole('button', { name: /Delete Synth/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '+ Add track' }))
    const names = screen.getAllByLabelText('Track name') as HTMLInputElement[]
    expect(names).toHaveLength(2)

    fireEvent.change(names[1], { target: { value: 'Bass' } })
    expect((screen.getAllByLabelText('Track name')[1] as HTMLInputElement).value).toBe('Bass')

    const mute = screen.getAllByRole('button', { name: 'Mute' })[1]
    fireEvent.click(mute)
    expect(screen.getAllByRole('button', { name: 'Muted' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: /Delete Bass/ }))
    expect(screen.getAllByLabelText('Track name')).toHaveLength(1)
  })

  it('keeps the selected track always shown on the roll (toggle disabled + on)', () => {
    render(<Harness />)
    const toggle = screen.getByRole('button', {
      name: /Synth is shown on the piano roll/,
    })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects a different track for editing', async () => {
    coversInteractions('studio.track.select')
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: '+ Add track' }))

    const synth = screen.getByRole('button', { name: 'Select Synth' })
    const added = screen.getByRole('button', { name: /Selected: Track 2/ })
    expect(synth).toHaveAttribute('aria-pressed', 'false')
    expect(added).toHaveAttribute('aria-pressed', 'true')

    await user.click(synth)

    expect(screen.getByRole('button', { name: 'Selected: Synth' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Select Track 2' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('toggles a non-selected track onto and off the piano roll', () => {
    coversInteractions('studio.track.visibility')
    render(<Harness />)
    // Add a second track — it becomes selected, leaving Synth as context.
    fireEvent.click(screen.getByRole('button', { name: '+ Add track' }))

    const show = screen.getByRole('button', { name: /Show Synth on the piano roll/ })
    expect(show).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(show)
    const hide = screen.getByRole('button', { name: /Hide Synth from the piano roll/ })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows all tracks and collapses back to just the selected one', () => {
    coversInteractions('studio.track.visibility-all')
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add track' }))

    fireEvent.click(screen.getByRole('button', { name: 'Show all tracks' }))
    const collapse = screen.getByRole('button', { name: 'Show only selected' })
    expect(collapse).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(collapse)
    expect(screen.getByRole('button', { name: 'Show all tracks' })).toBeInTheDocument()
  })
})
