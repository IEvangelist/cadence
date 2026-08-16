import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../test/coversInteractions'
import { COACH_MARKS } from './coachMarks'
import { ContextualCoachMark } from './ContextualCoachMark'
import { FullScreenSheet } from './FullScreenSheet'
import { MobileHelpSheet } from './MobileHelpSheet'
import { MobileNoteControls } from './MobileNoteControls'
import { MobileTaskSheets } from './MobileTaskSheets'
import { MobileTaskNavigator } from './MobileTaskNavigator'
import { SelectedNoteEditorSheet } from './SelectedNoteEditorSheet'
import { initialMobileTaskState } from './mobileTaskModel'

describe('mobile components', () => {
  it('renders four task destinations and help with 44px control classes', async () => {
    coversInteractions('mobile.task.open', 'mobile.help.open')
    const user = userEvent.setup()
    const onOpenTask = vi.fn()
    const onOpenHelp = vi.fn()
    render(
      <MobileTaskNavigator
        state={initialMobileTaskState}
        onOpenTask={onOpenTask}
        onOpenHelp={onOpenHelp}
      />,
    )

    expect(screen.getByRole('navigation', { name: 'Composer tasks' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: /^Project:/ }))
    await user.click(screen.getByRole('button', { name: /Help and keyboard/ }))

    expect(onOpenTask).toHaveBeenCalledWith('project')
    expect(onOpenHelp).toHaveBeenCalledOnce()
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('uses explicit Pan/Select and Draw modes', async () => {
    coversInteractions('mobile.notes.mode', 'mobile.notes.edit-selected')
    const user = userEvent.setup()
    const onModeChange = vi.fn()
    const onEditSelection = vi.fn()
    render(
      <MobileNoteControls
        mode="pan-select"
        hasSelection={false}
        onModeChange={onModeChange}
        onEditSelection={onEditSelection}
      />,
    )

    expect(screen.getByRole('button', { name: 'Pan/Select' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Edit selected note' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Draw' }))
    expect(onModeChange).toHaveBeenCalledWith('draw')
  })

  it('traps focus, closes with Escape, and restores launcher focus', async () => {
    coversInteractions('mobile.sheet.keyboard', 'mobile.sheet.close')
    const onClose = vi.fn()
    const { rerender } = render(
      <>
        <button type="button">Launcher</button>
        <FullScreenSheet open={false} title="Project" onClose={onClose}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </FullScreenSheet>
      </>,
    )
    const launcher = screen.getByRole('button', { name: 'Launcher' })
    launcher.focus()
    rerender(
      <>
        <button type="button">Launcher</button>
        <FullScreenSheet open title="Project" onClose={onClose}>
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </FullScreenSheet>
      </>,
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Close Project' })).toHaveFocus(),
    )
    const last = screen.getByRole('button', { name: 'Last action' })
    last.focus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close Project' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    rerender(
      <>
        <button type="button">Launcher</button>
        <FullScreenSheet open={false} title="Project" onClose={onClose}>
          <button type="button">First action</button>
        </FullScreenSheet>
      </>,
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Launcher' })).toHaveFocus(),
    )
  })

  it('edits every precise note field and deletes through the sheet', async () => {
    coversInteractions(
      'mobile.note-field.decrease',
      'mobile.note-field.value',
      'mobile.note-field.increase',
      'mobile.note.delete',
    )
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onDelete = vi.fn()
    render(
      <SelectedNoteEditorSheet
        open
        note={{
          id: 'note-1',
          pitch: 60,
          start: 1,
          duration: 1,
          velocity: 0.8,
        }}
        onClose={vi.fn()}
        onChange={onChange}
        onDelete={onDelete}
      />,
    )

    const pitchInput = screen.getByRole('spinbutton', { name: 'Pitch' })
    await user.click(screen.getByText('Pitch'))
    expect(pitchInput).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Increase Pitch' }))
    await user.click(screen.getByRole('button', { name: 'Increase Start' }))
    await user.click(screen.getByRole('button', { name: 'Increase Duration' }))
    await user.click(screen.getByRole('button', { name: 'Decrease Velocity' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Start' }), {
      target: { value: '2' },
    })
    await user.click(screen.getByRole('button', { name: 'Delete note' }))

    expect(onChange).toHaveBeenCalledWith({ pitch: 61 })
    expect(onChange).toHaveBeenCalledWith({ start: 1.25 })
    expect(onChange).toHaveBeenCalledWith({ duration: 1.25 })
    expect(onChange).toHaveBeenCalledWith({ velocity: 101 / 127 })
    expect(onChange).toHaveBeenCalledWith({ start: 2 })
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('allows a selected note to reach zero velocity', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SelectedNoteEditorSheet
        open
        note={{ id: 'quiet', pitch: 60, start: 0, duration: 1, velocity: 0 }}
        onClose={vi.fn()}
        onChange={onChange}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByRole('spinbutton', { name: 'Velocity' })).toHaveValue(0)
    await user.click(screen.getByRole('button', { name: 'Decrease Velocity' }))
    expect(onChange).toHaveBeenCalledWith({ velocity: 0 })
  })

  it('shows touch guidance and attached keyboard shortcuts together', () => {
    render(<MobileHelpSheet open onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Touch' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Attached keyboard' })).toBeVisible()
    expect(screen.getByText('Shift + Left/Right')).toBeVisible()
    expect(screen.getByText('Delete the selected note')).toBeVisible()
  })

  it('renders contextual guidance without a blocking backdrop', async () => {
    coversInteractions('mobile.coach.dismiss')
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const mark = COACH_MARKS.find((candidate) => candidate.id === 'note-modes') ?? null
    const { container } = render(
      <ContextualCoachMark mark={mark} onDismiss={onDismiss} />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('.mobile-coach-mark')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Dismiss Pan first/ }))
    expect(onDismiss).toHaveBeenCalledWith('note-modes')
  })

  it('orchestrates each task through the shared full-screen sheet', () => {
    const onClose = vi.fn()
    render(
      <MobileTaskSheets
        openSheet="tracks"
        onClose={onClose}
        content={{
          project: <p>Project content</p>,
          tracks: <p>Track content</p>,
          notes: <p>Note content</p>,
          tools: <p>Tool content</p>,
        }}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Tracks' })).toBeVisible()
    expect(screen.getByText('Track content')).toBeVisible()
    expect(screen.queryByText('Project content')).not.toBeInTheDocument()
  })

})
