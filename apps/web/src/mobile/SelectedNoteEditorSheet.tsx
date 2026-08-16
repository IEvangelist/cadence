import type { Note } from '../composer/model/project'
import { FullScreenSheet } from './FullScreenSheet'
import './mobile.css'

export interface SelectedNoteEditorSheetProps {
  note: Note | null
  open: boolean
  onClose: () => void
  onChange: (changes: Partial<Note>) => void
  onDelete: () => void
}

interface NoteFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function NoteField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: NoteFieldProps) {
  const commit = (value: number) => onChange(clamp(value, min, max))

  return (
    <label className="mobile-note-field">
      <span>{label}</span>
      <div className="mobile-note-field__controls">
        <button
          type="button"
          data-interaction="mobile.note-field.decrease"
          aria-label={`Decrease ${label}`}
          onClick={() => commit(value - step)}
        >
          -
        </button>
        <input
          type="number"
          data-interaction="mobile.note-field.value"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => {
            const next = event.currentTarget.valueAsNumber
            if (Number.isFinite(next)) commit(next)
          }}
        />
        <button
          type="button"
          data-interaction="mobile.note-field.increase"
          aria-label={`Increase ${label}`}
          onClick={() => commit(value + step)}
        >
          +
        </button>
      </div>
    </label>
  )
}

export function SelectedNoteEditorSheet({
  note,
  open,
  onClose,
  onChange,
  onDelete,
}: SelectedNoteEditorSheetProps) {
  return (
    <FullScreenSheet
      open={open && note !== null}
      title="Selected note"
      description="Adjust precise note values with touch-safe controls."
      onClose={onClose}
      testId="selected-note-sheet"
      footer={
        <button
          type="button"
          className="mobile-danger-button"
          data-interaction="mobile.note.delete"
          onClick={onDelete}
        >
          Delete note
        </button>
      }
    >
      {note && (
        <div className="mobile-note-editor">
          <NoteField
            label="Pitch"
            value={note.pitch}
            min={21}
            max={108}
            step={1}
            onChange={(pitch) => onChange({ pitch })}
          />
          <NoteField
            label="Start"
            value={note.start}
            min={0}
            max={1024}
            step={0.25}
            onChange={(start) => onChange({ start })}
          />
          <NoteField
            label="Duration"
            value={note.duration}
            min={0.0625}
            max={256}
            step={0.25}
            onChange={(duration) => onChange({ duration })}
          />
          <NoteField
            label="Velocity"
            value={Math.round(note.velocity * 127)}
            min={1}
            max={127}
            step={1}
            onChange={(velocity) => onChange({ velocity: velocity / 127 })}
          />
        </div>
      )}
    </FullScreenSheet>
  )
}
