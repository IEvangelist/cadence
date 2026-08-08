import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAssistant } from './useAssistant'
import { useComposer, type ComposerController } from './useComposer'
import { SilentAudioEngine } from '../audio/engine'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, createNote, createTrack } from '../model/project'
import { MockAssistant } from '../ai/mockProvider'
import type {
  AssistantProgress,
  AssistantRequest,
  AssistantSuggestion,
  CompositionAssistant,
} from '../ai/types'

function projectWithMelody() {
  const project = createEmptyProject('p')
  project.tracks = [
    createTrack(
      {
        name: 'Lead',
        notes: [
          createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.8 }, 'n1'),
          createNote({ pitch: 62, start: 1, duration: 1, velocity: 0.8 }, 'n2'),
        ],
      },
      't1',
    ),
  ]
  return project
}

function useHarness(provider: CompositionAssistant, withMelody = true) {
  const controller = useComposer({
    createEngine: () => new SilentAudioEngine(),
    store: new LocalStorageProjectStore(new MemoryStorage()),
    initialProject: withMelody ? projectWithMelody() : createEmptyProject('p'),
    autosaveDelay: 0,
  })
  const assistant = useAssistant(controller, { provider })
  return { controller, assistant }
}

describe('useAssistant', () => {
  it('generates a suggestion and exposes preview notes', async () => {
    const { result } = renderHook(() => useHarness(new MockAssistant()))

    await act(async () => {
      await result.current.assistant.generate()
    })

    expect(result.current.assistant.suggestion).not.toBeNull()
    expect(result.current.assistant.previewNotes.length).toBeGreaterThan(0)
    expect(result.current.assistant.phase).toBe('done')
  })

  it('accepts a suggestion, inserting notes into the selected track via the reducer', async () => {
    const { result } = renderHook(() => useHarness(new MockAssistant()))
    const before = countNotes(result.current.controller, 't1')

    await act(async () => {
      await result.current.assistant.generate()
    })
    const suggested = result.current.assistant.previewNotes.length

    act(() => {
      result.current.assistant.accept()
    })

    expect(countNotes(result.current.controller, 't1')).toBe(before + suggested)
    // Suggestion is cleared after accepting.
    expect(result.current.assistant.suggestion).toBeNull()
    expect(result.current.assistant.previewNotes).toEqual([])
  })

  it('clamps out-of-range accepted notes through the reducer', async () => {
    const wild: CompositionAssistant = {
      id: 'wild',
      capabilities: ['continue', 'generate', 'harmonize'],
      async generate(): Promise<AssistantSuggestion> {
        return {
          action: 'generate',
          label: 'wild',
          notes: [
            // Deliberately invalid: out-of-range pitch, negative start,
            // zero duration, super-unity velocity.
            { pitch: 999, start: -5, duration: 0, velocity: 9 },
          ],
        }
      },
    }
    const { result } = renderHook(() => useHarness(wild))

    await act(async () => {
      await result.current.assistant.generate()
    })
    act(() => {
      result.current.assistant.accept()
    })

    const notes = trackNotes(result.current.controller, 't1')
    const inserted = notes[notes.length - 1]
    expect(inserted.pitch).toBe(127)
    expect(inserted.start).toBe(0)
    expect(inserted.duration).toBeGreaterThanOrEqual(1 / 16)
    expect(inserted.velocity).toBeLessThanOrEqual(1)
    expect(inserted.velocity).toBeGreaterThanOrEqual(0)
  })

  it('discards a suggestion without inserting notes', async () => {
    const { result } = renderHook(() => useHarness(new MockAssistant()))
    const before = countNotes(result.current.controller, 't1')

    await act(async () => {
      await result.current.assistant.generate()
    })
    act(() => {
      result.current.assistant.discard()
    })

    expect(result.current.assistant.suggestion).toBeNull()
    expect(countNotes(result.current.controller, 't1')).toBe(before)
  })

  it('cannot generate a continuation with no seed notes', () => {
    const { result } = renderHook(() => useHarness(new MockAssistant(), false))
    // Empty project, action defaults to "continue" → nothing to continue from.
    expect(result.current.assistant.canGenerate).toBe(false)

    act(() => {
      result.current.assistant.setAction('generate')
    })
    // "generate" can start from an empty region.
    expect(result.current.assistant.canGenerate).toBe(true)
  })

  it('cancels an in-flight generation with an abort, leaving no suggestion', async () => {
    let abortListener: (() => void) | undefined
    const stalling: CompositionAssistant = {
      id: 'stall',
      capabilities: ['continue', 'generate', 'harmonize'],
      generate(request: AssistantRequest, onProgress?: (p: AssistantProgress) => void) {
        onProgress?.({ phase: 'loading-model' })
        return new Promise<AssistantSuggestion>((_resolve, reject) => {
          abortListener = () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }
          request.signal?.addEventListener('abort', abortListener)
        })
      },
    }
    const { result } = renderHook(() => useHarness(stalling))

    let generation: Promise<void>
    act(() => {
      generation = result.current.assistant.generate()
    })
    await waitFor(() => expect(result.current.assistant.isBusy).toBe(true))

    act(() => {
      result.current.assistant.cancel()
    })
    await act(async () => {
      await generation
    })

    expect(result.current.assistant.suggestion).toBeNull()
    expect(result.current.assistant.phase).toBe('idle')
  })

  it('cancel clears any pending audition preview timers', async () => {
    const { result } = renderHook(() => useHarness(new MockAssistant()))

    await act(async () => {
      await result.current.assistant.generate()
    })
    // Schedule preview playback timers.
    act(() => {
      result.current.assistant.audition()
    })

    const clearSpy = vi.spyOn(window, 'clearTimeout')
    act(() => {
      result.current.assistant.cancel()
    })
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})

function trackNotes(controller: ComposerController, trackId: string) {
  return controller.project.tracks.find((t) => t.id === trackId)?.notes ?? []
}
function countNotes(controller: ComposerController, trackId: string): number {
  return trackNotes(controller, trackId).length
}
