import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstrumentPicker } from './InstrumentPicker'

describe('<InstrumentPicker />', () => {
  it('renders every registry instrument and reports changes', () => {
    const onChange = vi.fn()
    render(<InstrumentPicker value="poly-synth" onChange={onChange} />)
    const select = screen.getByLabelText('Instrument') as HTMLSelectElement
    expect(select.value).toBe('poly-synth')
    expect(screen.getByRole('option', { name: 'FM Synth' })).toBeInTheDocument()
    fireEvent.change(select, { target: { value: 'drum-kit' } })
    expect(onChange).toHaveBeenCalledWith('drum-kit')
  })
})
