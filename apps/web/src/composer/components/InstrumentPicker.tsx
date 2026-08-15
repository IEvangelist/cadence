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

/** Bucket instruments by their `group`, preserving first-seen group order. */
function groupInstruments(
  instruments: readonly InstrumentDefinition[],
): { group: string | undefined; items: InstrumentDefinition[] }[] {
  const order: (string | undefined)[] = []
  const buckets = new Map<string | undefined, InstrumentDefinition[]>()
  for (const instrument of instruments) {
    const key = instrument.group
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key)!.push(instrument)
  }
  return order.map((group) => ({ group, items: buckets.get(group)! }))
}

/** A labelled dropdown for choosing a track's instrument from the registry. */
export function InstrumentPicker({
  value,
  onChange,
  label = 'Instrument',
  instruments = listInstruments(),
}: InstrumentPickerProps) {
  const id = useId()
  const groups = groupInstruments(instruments)
  // Render bare <option>s unless at least one instrument declares a group, so
  // an ungrouped registry keeps the original flat markup.
  const useGroups = groups.some((entry) => entry.group !== undefined)
  return (
    <span className="instrument-picker">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="instrument-select"
        data-interaction="studio.track.instrument"
        value={value}
        onChange={(event) => onChange(event.target.value as InstrumentId)}
      >
        {useGroups
          ? groups.map((entry) =>
              entry.group === undefined ? (
                entry.items.map((instrument) => (
                  <option key={instrument.id} value={instrument.id}>
                    {instrument.name}
                  </option>
                ))
              ) : (
                <optgroup key={entry.group} label={entry.group}>
                  {entry.items.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrument.name}
                    </option>
                  ))}
                </optgroup>
              ),
            )
          : instruments.map((instrument) => (
              <option key={instrument.id} value={instrument.id}>
                {instrument.name}
              </option>
            ))}
      </select>
    </span>
  )
}
