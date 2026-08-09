/**
 * useAssistant — orchestrates the composition assistant for the UI.
 *
 * Owns the assistant's action/parameters, generation lifecycle (progress,
 * cancel), the pending suggestion, and the preview/accept/discard flow. It talks
 * only to the {@link CompositionAssistant} interface (resolved via the provider
 * factory, or injected in tests) and commits accepted notes through the composer
 * controller — i.e. the existing reducer — so inserted notes are always
 * sanitized and clamped.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComposerController } from './useComposer'
import { selectedTrack as selectSelectedTrack } from '../model/reducer'
import { createAssistant } from '../ai/provider'
import { resolveAssistant } from '../plugins/resolveAssistant'
import { shouldUseMock } from '../ai/provider'
import {
  type AssistantAction,
  type AssistantParams,
  type AssistantProgress,
  type AssistantSuggestion,
  type CompositionAssistant,
  type SuggestedNote,
  DEFAULT_PARAMS,
  isAbortError,
} from '../ai/types'

export interface UseAssistantOptions {
  /** Inject a provider (tests/e2e); defaults to the factory-resolved one. */
  provider?: CompositionAssistant
  /** Preferred provider id (from preferences); ignored when `provider` is set. */
  preferredProviderId?: string | null
}

export interface AssistantController {
  action: AssistantAction
  setAction: (action: AssistantAction) => void
  params: AssistantParams
  setTemperature: (value: number) => void
  setLength: (beats: number) => void

  phase: AssistantProgress['phase']
  statusMessage: string
  isBusy: boolean
  error: string | null

  suggestion: AssistantSuggestion | null
  /** Notes to render as a ghost preview in the piano roll. */
  previewNotes: SuggestedNote[]

  canGenerate: boolean
  generate: () => Promise<void>
  cancel: () => void
  accept: () => void
  discard: () => void
  audition: () => void

  providerId: string
}

const STATUS_BY_PHASE: Record<AssistantProgress['phase'], string> = {
  idle: 'Ready',
  'loading-model': 'Loading model…',
  generating: 'Composing…',
  done: 'Ready',
  error: 'Something went wrong',
}

function toSuggested(notes: { pitch: number; start: number; duration: number; velocity: number }[]): SuggestedNote[] {
  return notes.map((n) => ({
    pitch: n.pitch,
    start: n.start,
    duration: n.duration,
    velocity: n.velocity,
  }))
}

export function useAssistant(
  controller: ComposerController,
  options: UseAssistantOptions = {},
): AssistantController {
  const [provider] = useState<CompositionAssistant>(() => {
    if (options.provider) return options.provider
    // Honor an explicit provider preference; otherwise fall back to the
    // environment default (mock in e2e/tests, Magenta in the app).
    if (options.preferredProviderId) {
      return resolveAssistant({
        preferredId: options.preferredProviderId,
        useMock: shouldUseMock(),
      })
    }
    return createAssistant()
  })

  const [action, setAction] = useState<AssistantAction>('continue')
  const [params, setParams] = useState<AssistantParams>(DEFAULT_PARAMS)
  const [progress, setProgress] = useState<AssistantProgress>({ phase: 'idle' })
  const [suggestion, setSuggestion] = useState<AssistantSuggestion | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const auditionTimers = useRef<number[]>([])

  const track = selectSelectedTrack(controller.state)

  const clearAuditionTimers = useCallback(() => {
    for (const id of auditionTimers.current) clearTimeout(id)
    auditionTimers.current = []
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      clearAuditionTimers()
      provider.dispose?.()
    }
  }, [provider, clearAuditionTimers])

  const setTemperature = useCallback((value: number) => {
    setParams((p) => ({ ...p, temperature: value }))
  }, [])
  const setLength = useCallback((beats: number) => {
    setParams((p) => ({ ...p, lengthBeats: beats }))
  }, [])

  const isBusy = progress.phase === 'loading-model' || progress.phase === 'generating'

  // Harmonize/continue need existing notes; generate can start from nothing.
  const canGenerate =
    !!track && !isBusy && (action === 'generate' || (track.notes.length > 0))

  const generate = useCallback(async () => {
    if (!track) return
    setError(null)
    setSuggestion(null)
    clearAuditionTimers()

    const seedNotes = toSuggested(track.notes)
    const melodyEnd = seedNotes.reduce((max, n) => Math.max(max, n.start + n.duration), 0)

    const abort = new AbortController()
    abortRef.current = abort
    setProgress({ phase: 'loading-model' })

    try {
      const result = await provider.generate(
        {
          action,
          seedNotes,
          regionStart: melodyEnd,
          tempo: controller.project.tempo,
          params,
          signal: abort.signal,
        },
        (p) => setProgress(p),
      )
      setSuggestion(result)
      setProgress({ phase: 'done' })
    } catch (err) {
      if (isAbortError(err)) {
        setProgress({ phase: 'idle' })
      } else {
        setError(err instanceof Error ? err.message : 'Generation failed')
        setProgress({ phase: 'error' })
      }
    } finally {
      abortRef.current = null
    }
  }, [track, provider, action, params, controller.project.tempo, clearAuditionTimers])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    clearAuditionTimers()
  }, [clearAuditionTimers])

  const audition = useCallback(() => {
    if (!suggestion || suggestion.notes.length === 0) return
    clearAuditionTimers()
    const tempo = controller.project.tempo || 120
    const msPerBeat = 60000 / tempo
    const origin = Math.min(...suggestion.notes.map((n) => n.start))
    for (const note of suggestion.notes) {
      const delay = Math.max(0, (note.start - origin) * msPerBeat)
      const id = window.setTimeout(() => controller.previewNote(note.pitch), delay)
      auditionTimers.current.push(id)
    }
  }, [suggestion, controller, clearAuditionTimers])

  const accept = useCallback(() => {
    if (!suggestion || !track) return
    controller.insertNotes(track.id, suggestion.notes)
    clearAuditionTimers()
    setSuggestion(null)
    setProgress({ phase: 'idle' })
  }, [suggestion, track, controller, clearAuditionTimers])

  const discard = useCallback(() => {
    clearAuditionTimers()
    setSuggestion(null)
    setError(null)
    setProgress({ phase: 'idle' })
  }, [clearAuditionTimers])

  const statusMessage = useMemo(() => {
    if (error) return error
    if (suggestion && progress.phase === 'done') return suggestion.label
    return progress.message ?? STATUS_BY_PHASE[progress.phase]
  }, [error, suggestion, progress])

  return {
    action,
    setAction,
    params,
    setTemperature,
    setLength,
    phase: progress.phase,
    statusMessage,
    isBusy,
    error,
    suggestion,
    previewNotes: suggestion?.notes ?? [],
    canGenerate,
    generate,
    cancel,
    accept,
    discard,
    audition,
    providerId: provider.id,
  }
}
