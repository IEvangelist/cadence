import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Composer } from '../Composer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, createNote, createTrack } from '../model/project'
import { MockAssistant } from '../ai/mockProvider'

function renderComposer() {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack(
      {
        name: 'Lead',
        notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'seed')],
      },
      't1',
    ),
  ]
  return render(
    <Composer
      options={{
        createEngine: () => new SilentAudioEngine(),
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: project,
        autosaveDelay: 0,
      }}
      assistantOptions={{ provider: new MockAssistant() }}
    />,
  )
}

function assistantRegion() {
  return screen.getByRole('region', { name: 'AI Assistant' })
}

describe('<AssistantPanel />', () => {
  it('renders the brand-themed assistant with action choices and params', () => {
    renderComposer()
    const panel = assistantRegion()
    expect(within(panel).getByRole('heading', { name: 'Assistant' })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Continue melody/ })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Generate melody/ })).toBeInTheDocument()
    expect(within(panel).getByRole('radio', { name: /Harmonize/ })).toBeInTheDocument()
    expect(within(panel).getByRole('slider', { name: /Temperature/ })).toBeInTheDocument()
    expect(within(panel).getByRole('slider', { name: /Length/ })).toBeInTheDocument()
  })

  it('is keyboard-operable: selecting an action and generating with the keyboard', async () => {
    renderComposer()
    const panel = assistantRegion()

    const generateAction = within(panel).getByRole('radio', { name: /Generate melody/ })
    generateAction.focus()
    expect(generateAction).toHaveFocus()
    fireEvent.click(generateAction)
    expect(generateAction).toBeChecked()

    const generate = within(panel).getByRole('button', { name: 'Generate' })
    fireEvent.click(generate)

    // A suggestion appears with preview/accept/discard controls.
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Accept' })).toBeInTheDocument(),
    )
  })

  it('runs the full generate → preview → accept flow, inserting notes', async () => {
    const { container } = renderComposer()
    const panel = assistantRegion()

    const notesBefore = container.querySelectorAll('.pr-note:not(.is-preview)').length

    fireEvent.click(within(panel).getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Accept' })).toBeInTheDocument(),
    )

    // Ghost preview notes are rendered, visually distinct.
    expect(container.querySelectorAll('.pr-note.is-preview').length).toBeGreaterThan(0)

    // Preview (audition) does not throw with the silent engine.
    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }))

    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }))

    await waitFor(() => {
      const notesAfter = container.querySelectorAll('.pr-note:not(.is-preview)').length
      expect(notesAfter).toBeGreaterThan(notesBefore)
    })
    // Preview ghosts clear after accepting.
    expect(container.querySelectorAll('.pr-note.is-preview').length).toBe(0)
  })

  it('discards a suggestion, removing the preview without inserting notes', async () => {
    const { container } = renderComposer()
    const panel = assistantRegion()
    const notesBefore = container.querySelectorAll('.pr-note:not(.is-preview)').length

    fireEvent.click(within(panel).getByRole('button', { name: 'Generate' }))
    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Discard' })).toBeInTheDocument(),
    )
    fireEvent.click(within(panel).getByRole('button', { name: 'Discard' }))

    await waitFor(() =>
      expect(within(panel).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument(),
    )
    expect(container.querySelectorAll('.pr-note.is-preview').length).toBe(0)
    expect(container.querySelectorAll('.pr-note:not(.is-preview)').length).toBe(notesBefore)
  })
})
