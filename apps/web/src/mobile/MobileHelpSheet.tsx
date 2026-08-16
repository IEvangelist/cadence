import { FullScreenSheet } from './FullScreenSheet'
import {
  ATTACHED_KEYBOARD_SHORTCUTS,
  type MobileShortcut,
} from './mobileShortcuts'
import './mobile.css'

export interface MobileHelpSheetProps {
  open: boolean
  onClose: () => void
  shortcuts?: readonly MobileShortcut[]
}

export function MobileHelpSheet({
  open,
  onClose,
  shortcuts = ATTACHED_KEYBOARD_SHORTCUTS,
}: MobileHelpSheetProps) {
  return (
    <FullScreenSheet
      open={open}
      title="Help"
      description="Touch controls and attached keyboard shortcuts."
      onClose={onClose}
      testId="mobile-help-sheet"
    >
      <section className="mobile-help-section" aria-labelledby="touch-help-title">
        <h3 id="touch-help-title">Touch</h3>
        <dl>
          <div>
            <dt>Pan/Select</dt>
            <dd>Drag empty space to pan. Tap a note to select it.</dd>
          </div>
          <div>
            <dt>Draw</dt>
            <dd>Tap empty space to add. A drag pans without adding.</dd>
          </div>
          <div>
            <dt>Precise edits</dt>
            <dd>Select a note, then open its editor for values and delete.</dd>
          </div>
        </dl>
      </section>
      <section className="mobile-help-section" aria-labelledby="keyboard-help-title">
        <h3 id="keyboard-help-title">Attached keyboard</h3>
        <dl>
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys}>
              <dt>
                <kbd>{shortcut.keys}</kbd>
              </dt>
              <dd>{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </section>
    </FullScreenSheet>
  )
}
