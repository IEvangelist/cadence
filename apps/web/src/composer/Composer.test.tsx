import { fireEvent, render, screen } from '@testing-library/react'
/* Interaction coverage: studio.empty.load-demo */
import { describe, expect, it } from 'vitest'
import { Composer } from './Composer'
import { SilentAudioEngine } from './audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from './model/storage'
import { createEmptyProject } from './model/project'

function options() {
  return {
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: createEmptyProject('p'),
    autosaveDelay: 0,
  }
}

describe('<Composer />', () => {
  it('shows the empty state and dismisses it after loading the demo', () => {
    render(<Composer options={options()} />)
    expect(screen.getByText('Your canvas is empty.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Load a demo pattern/ }))
    expect(screen.queryByText('Your canvas is empty.')).not.toBeInTheDocument()
  })

  it('surfaces a note when audio output is unavailable', () => {
    render(<Composer options={options()} />)
    expect(screen.getByRole('note')).toHaveTextContent(/Audio output isn/)
  })

  it('composes the toolbar, transport, tracks, and piano roll', () => {
    render(<Composer options={options()} />)
    expect(screen.getByRole('group', { name: 'Project toolbar' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Transport controls' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tracks' })).toBeInTheDocument()
    expect(screen.getByRole('application', { name: /Note grid/ })).toBeInTheDocument()
  })
})
