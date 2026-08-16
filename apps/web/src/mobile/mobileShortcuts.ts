export interface MobileShortcut {
  keys: string
  action: string
}

export const ATTACHED_KEYBOARD_SHORTCUTS: readonly MobileShortcut[] = [
  { keys: 'Enter', action: 'Add a note at the caret' },
  { keys: 'Arrow keys', action: 'Move the caret or selected note' },
  { keys: 'Shift + Left/Right', action: 'Resize the selected note' },
  { keys: 'Delete', action: 'Delete the selected note' },
] as const
