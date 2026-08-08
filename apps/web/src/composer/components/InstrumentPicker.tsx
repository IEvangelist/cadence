import { useId } from 'react'
import { type InstrumentId } from '../model/project'
import { INSTRUMENTS } from '../instruments/registry'

interface InstrumentPickerProps {
  value: InstrumentId
  onChange: (id: InstrumentId) => void
  label?: string
}

/** A labelled dropdown for choosing a track's instrument from the registry. */
export function InstrumentPicker({ value, onChange, label = 'Instrument' }: InstrumentPickerProps) {
  const id = useId()
  return (
    <span className="instrument-picker">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="instrument-select"
        value={value}
        onChange={(event) => onChange(event.target.value as InstrumentId)}
      >
        {INSTRUMENTS.map((instrument) => (
          <option key={instrument.id} value={instrument.id}>
            {instrument.name}
          </option>
        ))}
      </select>
    </span>
  )
}
