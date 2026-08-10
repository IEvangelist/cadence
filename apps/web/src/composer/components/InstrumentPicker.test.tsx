import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InstrumentPicker } from './InstrumentPicker'
import type { InstrumentDefinition } from '../instruments/registry'

const def = (
  id: string,
  name: string,
  group?: string,
): InstrumentDefinition => ({
  id,
  name,
  kind: 'synth',
  description: `${name} description`,
  polyphonic: true,
  group,
})

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

  it('groups instruments into <optgroup>s in first-seen group order', () => {
    const instruments = [
      def('a', 'A', 'Keys'),
      def('b', 'B', 'Bass'),
      def('c', 'C', 'Keys'),
    ]
    const { container } = render(
      <InstrumentPicker value="a" onChange={vi.fn()} instruments={instruments} />,
    )
    const groups = Array.from(container.querySelectorAll('optgroup'))
    // Keys appears before Bass (first-seen), and the second Keys entry folds in.
    expect(groups.map((g) => g.label)).toEqual(['Keys', 'Bass'])
    const keysOptions = Array.from(groups[0].querySelectorAll('option')).map(
      (o) => o.value,
    )
    expect(keysOptions).toEqual(['a', 'c'])
    // Options inside optgroups remain selectable by accessible name.
    expect(screen.getByRole('option', { name: 'C' })).toBeInTheDocument()
  })

  it('renders ungrouped instruments as bare options alongside groups', () => {
    const instruments = [def('a', 'A', 'Keys'), def('b', 'B')]
    const { container } = render(
      <InstrumentPicker value="a" onChange={vi.fn()} instruments={instruments} />,
    )
    // The grouped one is inside an optgroup; the ungrouped one is a direct child.
    expect(container.querySelectorAll('optgroup')).toHaveLength(1)
    const bare = container.querySelector('select > option')
    expect(bare?.getAttribute('value')).toBe('b')
  })

  it('renders a flat option list when no instrument declares a group', () => {
    const instruments = [def('a', 'A'), def('b', 'B')]
    const { container } = render(
      <InstrumentPicker value="a" onChange={vi.fn()} instruments={instruments} />,
    )
    expect(container.querySelectorAll('optgroup')).toHaveLength(0)
    expect(container.querySelectorAll('option')).toHaveLength(2)
  })
})
