import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { MidiControls } from './MidiControls'
import { type ComposerController, type ComposerMidi } from '../hooks/useComposer'

function controllerWith(midi: Partial<ComposerMidi> = {}): ComposerController {
  const base: ComposerMidi = {
    supported: true,
    inputs: [],
    selectedInputId: null,
    selectInput: vi.fn(),
    connected: false,
    armed: false,
    toggleArmed: vi.fn(),
    quantize: false,
    setQuantize: vi.fn(),
    ...midi,
  }
  return { midi: base } as unknown as ComposerController
}

const indicator = (): HTMLElement =>
  screen.getByTestId('midi-controls').querySelector('.midi-indicator') as HTMLElement

describe('<MidiControls />', () => {
  it('shows only an unsupported hint when Web MIDI is absent', () => {
    render(<MidiControls controller={controllerWith({ supported: false })} />)
    expect(screen.getByText(/not supported/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('MIDI device')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    expect(indicator()).toHaveAttribute('data-state', 'unsupported')
  })

  it('lists connected devices and reports the current selection', async () => {
    coversInteractions('studio.midi.settings', 'studio.midi.device')
    const user = userEvent.setup()
    const selectInput = vi.fn()
    render(
      <MidiControls
        controller={controllerWith({
          inputs: [
            { id: 'a', name: 'Keystation' },
            { id: 'b', name: 'Launchkey' },
          ],
          selectedInputId: 'a',
          connected: true,
          selectInput,
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'MIDI' }))
    const select = await screen.findByLabelText('MIDI device') as HTMLSelectElement
    expect(select.value).toBe('a')
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    expect(indicator()).toHaveAttribute('data-state', 'connected')

    fireEvent.change(select, { target: { value: 'b' } })
    expect(selectInput).toHaveBeenCalledWith('b')
  })

  it('disables the selector and shows a placeholder with no devices', async () => {
    const user = userEvent.setup()
    render(<MidiControls controller={controllerWith({ inputs: [] })} />)
    await user.click(screen.getByRole('button', { name: 'MIDI' }))
    const select = await screen.findByLabelText('MIDI device')
    expect(select).toBeDisabled()
    expect(screen.getByText('No MIDI devices')).toBeInTheDocument()
    expect(indicator()).toHaveAttribute('data-state', 'idle')
  })

  it('arms recording and reflects the recording indicator state', () => {
    coversInteractions('studio.midi.arm')
    const toggleArmed = vi.fn()
    const { rerender } = render(
      <MidiControls controller={controllerWith({ armed: false, connected: true, toggleArmed })} />,
    )
    const button = screen.getByRole('button', { name: 'Record' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(toggleArmed).toHaveBeenCalledTimes(1)

    rerender(
      <MidiControls controller={controllerWith({ armed: true, connected: true, toggleArmed })} />,
    )
    expect(screen.getByRole('button', { name: 'Record' })).toHaveAttribute('aria-pressed', 'true')
    expect(indicator()).toHaveAttribute('data-state', 'recording')
  })

  it('toggles opt-in quantize', async () => {
    coversInteractions('studio.midi.quantize')
    const user = userEvent.setup()
    const setQuantize = vi.fn()
    render(<MidiControls controller={controllerWith({ quantize: false, setQuantize })} />)
    await user.click(screen.getByRole('button', { name: 'MIDI' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /quantize/i }))
    expect(setQuantize).toHaveBeenCalledWith(true)
  })
})
