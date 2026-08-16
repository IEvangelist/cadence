import type { MobileNoteMode } from './mobileTaskModel'
import './mobile.css'

export interface MobileNoteControlsProps {
  mode: MobileNoteMode
  hasSelection: boolean
  onModeChange: (mode: MobileNoteMode) => void
  onEditSelection: () => void
}

export function MobileNoteControls({
  mode,
  hasSelection,
  onModeChange,
  onEditSelection,
}: MobileNoteControlsProps) {
  return (
    <div className="mobile-note-controls" aria-label="Note editing mode">
      <div className="mobile-segmented-control">
        <button
          type="button"
          data-interaction="mobile.notes.mode"
          aria-pressed={mode === 'pan-select'}
          onClick={() => onModeChange('pan-select')}
        >
          Pan/Select
        </button>
        <button
          type="button"
          data-interaction="mobile.notes.mode"
          aria-pressed={mode === 'draw'}
          onClick={() => onModeChange('draw')}
        >
          Draw
        </button>
      </div>
      <button
        type="button"
        className="mobile-secondary-button"
        data-interaction="mobile.notes.edit-selected"
        disabled={!hasSelection}
        onClick={onEditSelection}
      >
        Edit selected note
      </button>
    </div>
  )
}
