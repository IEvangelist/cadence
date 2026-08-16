import { describe, expect, it } from 'vitest'
import {
  initialMobileTaskState,
  mobileTaskReducer,
  type MobileTaskState,
} from './mobileTaskModel'

describe('mobileTaskReducer', () => {
  it('defaults to the safe Pan/Select Notes task', () => {
    expect(initialMobileTaskState).toEqual({
      activeTask: 'notes',
      openSheet: null,
      noteMode: 'pan-select',
      selectedNoteId: null,
    })
  })

  it('opens and closes task sheets without losing the active task', () => {
    const opened = mobileTaskReducer(initialMobileTaskState, {
      type: 'open-task',
      task: 'tracks',
    })

    expect(opened).toMatchObject({ activeTask: 'tracks', openSheet: 'tracks' })
    expect(mobileTaskReducer(opened, { type: 'close-sheet' })).toMatchObject({
      activeTask: 'tracks',
      openSheet: null,
    })
  })

  it('uses Draw only after an explicit mode change', () => {
    const next = mobileTaskReducer(initialMobileTaskState, {
      type: 'set-note-mode',
      mode: 'draw',
    })

    expect(next.noteMode).toBe('draw')
  })

  it('selects a note, explicitly opens its editor, and clears safely', () => {
    const state: MobileTaskState = {
      ...initialMobileTaskState,
      activeTask: 'project',
    }
    const selected = mobileTaskReducer(state, {
      type: 'select-note',
      noteId: 'note-1',
    })

    expect(selected).toMatchObject({
      activeTask: 'notes',
      openSheet: null,
      selectedNoteId: 'note-1',
    })
    const editing = mobileTaskReducer(selected, { type: 'open-selected-note' })
    expect(editing.openSheet).toBe('selected-note')
    expect(
      mobileTaskReducer(editing, { type: 'clear-note-selection' }),
    ).toMatchObject({
      openSheet: null,
      selectedNoteId: null,
    })
  })

  it('does not open a selected-note sheet without a selection', () => {
    expect(
      mobileTaskReducer(initialMobileTaskState, { type: 'open-selected-note' }),
    ).toBe(initialMobileTaskState)
  })

  it('opens shortcut help without changing the active task', () => {
    expect(
      mobileTaskReducer(
        { ...initialMobileTaskState, activeTask: 'tools' },
        { type: 'open-help' },
      ),
    ).toMatchObject({ activeTask: 'tools', openSheet: 'help' })
  })
})
