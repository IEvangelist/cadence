import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coversInteractions } from '../../test/coversInteractions'
import { Composer } from '../Composer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, createNote, createTrack } from '../model/project'
import { MockAssistant } from '../ai/mockProvider'
import type {
  AssistantRequest,
  AssistantSuggestion,
  CompositionAssistant,
} from '../ai/types'

function renderComposer(
  provider: CompositionAssistant = new MockAssistant(),
  engine: SilentAudioEngine = new SilentAudioEngine(),
) {
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
        createEngine: () => engine,
        store: new LocalStorageProjectStore(new MemoryStorage()),
        initialProject: project,
        autosaveDelay: 0,
      }}
      assistantOptions={{ provider }}
    />,
  )
}

function assistantRegion() {
  const inspector = screen.getByRole('button', { name: 'Inspector' })
  if (inspector.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(inspector)
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Assistant' }))
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
    coversInteractions('studio.assistant.action.select', 'studio.assistant.generate')
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

  it('updates generation temperature and length and passes them to the provider', async () => {
    coversInteractions('studio.assistant.temperature', 'studio.assistant.length')
    const generate = vi.fn(
      async (request: AssistantRequest): Promise<AssistantSuggestion> => ({
        action: request.action,
        notes: [{ pitch: 64, start: 1, duration: 1, velocity: 0.8 }],
        label: 'Captured parameters',
      }),
    )
    const provider: CompositionAssistant = {
      id: 'parameter-capture',
      capabilities: ['continue', 'generate', 'harmonize'],
      generate,
    }
    renderComposer(provider)
    const panel = assistantRegion()
    const temperature = within(panel).getByRole('slider', { name: /Temperature/ })
    const length = within(panel).getByRole('slider', { name: /Length/ })

    fireEvent.change(temperature, { target: { value: '1.7' } })
    fireEvent.change(length, { target: { value: '12' } })

    expect(temperature).toHaveValue('1.7')
    expect(length).toHaveValue('12')
    expect(within(temperature.closest('label')!).getByText('1.7')).toBeInTheDocument()
    expect(within(length.closest('label')!).getByText('12')).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: 'Generate' }))
    await waitFor(() => expect(generate).toHaveBeenCalledOnce())
    expect(generate.mock.calls[0][0].params).toEqual({
      temperature: 1.7,
      lengthBeats: 12,
    })
  })

  it('runs the full generate → preview → accept flow, inserting notes', async () => {
    coversInteractions('studio.assistant.preview', 'studio.assistant.accept')
    const engine = new SilentAudioEngine()
    const previewNote = vi.spyOn(engine, 'previewNote')
    const { container } = renderComposer(new MockAssistant(), engine)
    const panel = assistantRegion()

    const notesBefore = container.querySelectorAll('.pr-note:not(.is-preview)').length

    fireEvent.click(within(panel).getByRole('button', { name: 'Generate' }))

    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Accept' })).toBeInTheDocument(),
    )

    // Ghost preview notes are rendered, visually distinct.
    expect(container.querySelectorAll('.pr-note.is-preview').length).toBeGreaterThan(0)

    fireEvent.click(within(panel).getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(previewNote).toHaveBeenCalled())

    fireEvent.click(within(panel).getByRole('button', { name: 'Accept' }))

    await waitFor(() => {
      const notesAfter = container.querySelectorAll('.pr-note:not(.is-preview)').length
      expect(notesAfter).toBeGreaterThan(notesBefore)
    })
    // Preview ghosts clear after accepting.
    expect(container.querySelectorAll('.pr-note.is-preview').length).toBe(0)
  })

  it('discards a suggestion, removing the preview without inserting notes', async () => {
    coversInteractions('studio.assistant.discard')
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

  it('keeps keyboard focus on the action button when Generate becomes Cancel', async () => {
    // A provider whose generation never settles keeps the panel in the busy
    // state so we can observe the Generate→Cancel swap.
    const stalling: CompositionAssistant = {
      id: 'stall',
      capabilities: ['continue', 'generate', 'harmonize'],
      generate(_request, onProgress) {
        onProgress?.({ phase: 'loading-model' })
        return new Promise<AssistantSuggestion>(() => {})
      },
    }
    renderComposer(stalling)
    const panel = assistantRegion()

    const generate = within(panel).getByRole('button', { name: 'Generate' })
    generate.focus()
    expect(generate).toHaveFocus()
    fireEvent.click(generate)

    const cancel = await within(panel).findByRole('button', { name: 'Cancel' })
    // Same DOM node (not a swapped element) → focus is preserved, not lost to body.
    expect(cancel).toBe(generate)
    expect(cancel).toHaveFocus()
  })
})
