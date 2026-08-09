import { useId } from 'react'
import { type InstrumentId } from '../model/project'
import { type InstrumentDefinition, listInstruments } from '../instruments/registry'

interface InstrumentPickerProps {
  value: InstrumentId
  onChange: (id: InstrumentId) => void
  label?: string
  /** Selectable instruments; defaults to the live host list (built-in + plugins). */
  instruments?: readonly InstrumentDefinition[]
}

/** A labelled dropdown for choosing a track's instrument from the registry. */
export function InstrumentPicker({
  value,
  onChange,
  label = 'Instrument',
  instruments = listInstruments(),
}: InstrumentPickerProps) {
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
        {instruments.map((instrument) => (
          <option key={instrument.id} value={instrument.id}>
            {instrument.name}
          </option>
        ))}
      </select>
    </span>
  )
}
