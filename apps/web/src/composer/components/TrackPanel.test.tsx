import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
})
