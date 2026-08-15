import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { TransportBar } from './TransportBar'
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
  return <TransportBar controller={controller} />
}

describe('<TransportBar />', () => {
  it('toggles play/pause, stop, tempo, loop, and snap', async () => {
    coversInteractions(
      'studio.transport.play',
      'studio.transport.stop',
      'studio.transport.tempo',
      'studio.transport.loop',
      'studio.transport.snap',
    )
    render(<Harness />)

    const play = screen.getByRole('button', { name: /Play/ })
    fireEvent.click(play)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(screen.getByRole('button', { name: /Play/ })).toBeInTheDocument()

    const tempo = screen.getByRole('spinbutton', { name: 'Tempo' }) as HTMLInputElement
    fireEvent.change(tempo, { target: { value: '90' } })
    expect(tempo.value).toBe('90')

    const loop = screen.getByRole('button', { name: /Loop/ })
    fireEvent.click(loop)
    expect(loop).toHaveAttribute('aria-pressed', 'true')

    const snap = screen.getByRole('combobox', { name: 'Snap' }) as HTMLSelectElement
    fireEvent.change(snap, { target: { value: '0.5' } })
    expect(snap.value).toBe('0.5')
  })
})
