export type MobileTaskId = 'project' | 'tracks' | 'notes' | 'tools'

export type MobileNoteMode = 'pan-select' | 'draw'

export type MobileSheetId = MobileTaskId | 'selected-note' | 'help'

export interface MobileTaskState {
  activeTask: MobileTaskId
  openSheet: MobileSheetId | null
  noteMode: MobileNoteMode
  selectedNoteId: string | null
}

export type MobileTaskAction =
  | { type: 'open-task'; task: MobileTaskId }
  | { type: 'close-sheet' }
  | { type: 'set-note-mode'; mode: MobileNoteMode }
  | { type: 'select-note'; noteId: string }
  | { type: 'open-selected-note' }
  | { type: 'clear-note-selection' }
  | { type: 'open-help' }

export interface MobileTaskDefinition {
  id: MobileTaskId
  label: string
  description: string
}

export const MOBILE_TASKS: readonly MobileTaskDefinition[] = [
  {
    id: 'project',
    label: 'Project',
    description: 'Create, open, import, save, share, and export.',
  },
  {
    id: 'tracks',
    label: 'Tracks',
    description: 'Choose tracks and instruments.',
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'Edit notes with touch-safe controls.',
  },
  {
    id: 'tools',
    label: 'Tools',
    description: 'Use AI, mix, MIDI, and extensions.',
  },
] as const

export const initialMobileTaskState: MobileTaskState = {
  activeTask: 'notes',
  openSheet: null,
  noteMode: 'pan-select',
  selectedNoteId: null,
}

export function mobileTaskReducer(
  state: MobileTaskState,
  action: MobileTaskAction,
): MobileTaskState {
  switch (action.type) {
    case 'open-task':
      return {
        ...state,
        activeTask: action.task,
        openSheet: action.task,
      }
    case 'close-sheet':
      return { ...state, openSheet: null }
    case 'set-note-mode':
      return { ...state, noteMode: action.mode }
    case 'select-note':
      return {
        ...state,
        activeTask: 'notes',
        selectedNoteId: action.noteId,
      }
    case 'open-selected-note':
      return state.selectedNoteId
        ? { ...state, activeTask: 'notes', openSheet: 'selected-note' }
        : state
    case 'clear-note-selection':
      return {
        ...state,
        openSheet: state.openSheet === 'selected-note' ? null : state.openSheet,
        selectedNoteId: null,
      }
    case 'open-help':
      return { ...state, openSheet: 'help' }
  }
}
