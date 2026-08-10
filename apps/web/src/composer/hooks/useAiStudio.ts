/**
 * useAiStudio — orchestrates the expanded-AI feature set for the UI.
 *
 * Like `useAssistant`, this hook talks only to the composer's *public* controller
 * surface ({@link ComposerController}: `project`, `selectedTrackId`, `insertNotes`,
 * `updateNote`, `notify`) — it never reaches into the reducer, store or engine.
 * That keeps the expanded features fully decoupled from the composer core (no
 * hot-file edits) and means every note it writes is sanitized by the same reducer
 * as user edits.
 *
 * All four features are pure/deterministic and run in-browser with no model
 * download, so the hook stays synchronous and side-effect-free beyond the
 * controller calls it makes.
 */
import { useCallback, useMemo, useState } from 'react'
import type { Entitlements } from '../../billing/entitlementsClient'
import type { ComposerController } from './useComposer'
import {
  type AiFeatureId,
  type GroovePresetId,
  type MasteringReport,
  type StyleId,
  type SuggestedNote,
  GROOVE_PRESETS,
  MOTIF_LENGTH_RANGE,
  analyzeMastering,
  applyGroove,
  applyStyle,
  canUseFeature,
  describeParams,
  findGroovePreset,
  findStyle,
  generateMotif,
  hashString,
  interpretPrompt,
  isUnlimited,
} from '../ai/expanded'

export interface UseAiStudioOptions {
  /** Server-authoritative entitlements; `null`/omitted resolves to the free tier. */
  entitlements?: Entitlements | null
}

export interface AiStudioController {
  /** True when the current budget is unlimited (paid) — drives the panel badge. */
  unlimited: boolean
  feature: AiFeatureId
  setFeature: (feature: AiFeatureId) => void
  /** True when the current budget unlocks the given feature. */
  canUse: (feature: AiFeatureId) => boolean

  // Text → motif
  prompt: string
  setPrompt: (value: string) => void
  motifLength: number
  setMotifLength: (beats: number) => void
  createMotif: () => void

  // Style transfer
  styleId: StyleId
  setStyleId: (id: StyleId) => void
  applyStyleToTrack: () => void

  // Groove / humanize
  groovePresetId: GroovePresetId
  setGroovePresetId: (id: GroovePresetId) => void
  grooveIntensity: number
  setGrooveIntensity: (value: number) => void
  applyGrooveToTrack: () => void

  // Auto-mastering
  report: MasteringReport | null
  analyze: () => void

  status: string
}

const FEATURE_LABELS: Record<AiFeatureId, string> = {
  'text-to-motif': 'Text to motif',
  'style-transfer': 'Style transfer',
  groove: 'Groove',
  'auto-master': 'Auto-master',
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export function useAiStudio(
  controller: ComposerController,
  options: UseAiStudioOptions = {},
): AiStudioController {
  const entitlements = options.entitlements ?? null
  const unlimited = useMemo(() => isUnlimited(entitlements), [entitlements])

  const [feature, setFeature] = useState<AiFeatureId>('text-to-motif')
  const [prompt, setPrompt] = useState('')
  const [motifLength, setMotifLengthState] = useState(8)
  const [styleId, setStyleId] = useState<StyleId>('lofi')
  const [groovePresetId, setGroovePresetId] = useState<GroovePresetId>('swing-8')
  const [grooveIntensity, setGrooveIntensityState] = useState(1)
  const [report, setReport] = useState<MasteringReport | null>(null)
  const [status, setStatus] = useState('Ready')

  const canUse = useCallback(
    (id: AiFeatureId) => canUseFeature(id, entitlements),
    [entitlements],
  )

  const setMotifLength = useCallback((beats: number) => {
    setMotifLengthState(clamp(Math.round(beats), MOTIF_LENGTH_RANGE.min, MOTIF_LENGTH_RANGE.max))
  }, [])

  const setGrooveIntensity = useCallback((value: number) => {
    setGrooveIntensityState(clamp(value, 0, 1))
  }, [])

  /** Guard an action behind its entitlement; announce a lock instead of running. */
  const guard = useCallback(
    (id: AiFeatureId, run: () => void) => {
      if (!canUse(id)) {
        const message = `${FEATURE_LABELS[id]} is a Pro feature — upgrade to unlock it.`
        controller.notify(message)
        setStatus(message)
        return
      }
      run()
    },
    [canUse, controller],
  )

  /** The selected track (always defined — a project has at least one track). */
  const selectedTrack = useMemo(() => {
    const { project, selectedTrackId } = controller
    return project.tracks.find((track) => track.id === selectedTrackId) ?? project.tracks[0]
  }, [controller])

  const toSuggested = (notes: readonly { pitch: number; start: number; duration: number; velocity: number }[]): SuggestedNote[] =>
    notes.map((note) => ({
      pitch: note.pitch,
      start: note.start,
      duration: note.duration,
      velocity: note.velocity,
    }))

  const createMotif = useCallback(() => {
    guard('text-to-motif', () => {
      const params = { ...interpretPrompt(prompt), lengthBeats: motifLength }
      const track = selectedTrack
      const regionStart =
        track.notes.length > 0
          ? Math.max(...track.notes.map((note) => note.start + note.duration))
          : 0
      const notes = generateMotif(params, { regionStart })
      controller.insertNotes(track.id, notes)
      const message = `Added ${notes.length}-note motif in ${describeParams(params)} to ${track.name}.`
      controller.notify(message)
      setStatus(message)
    })
  }, [guard, prompt, motifLength, selectedTrack, controller])

  const applyStyleToTrack = useCallback(() => {
    guard('style-transfer', () => {
      const track = selectedTrack
      if (track.notes.length === 0) {
        setStatus('Add notes to the selected track first, then apply a style.')
        controller.notify('Nothing to restyle — the selected track is empty.')
        return
      }
      const styled = applyStyle(toSuggested(track.notes), styleId)
      track.notes.forEach((note, index) => {
        const next = styled[index]
        controller.updateNote(track.id, note.id, {
          pitch: next.pitch,
          start: next.start,
          duration: next.duration,
          velocity: next.velocity,
        })
      })
      const message = `Applied ${findStyle(styleId)?.name ?? styleId} to ${track.name}.`
      controller.notify(message)
      setStatus(message)
    })
  }, [guard, selectedTrack, styleId, controller])

  const applyGrooveToTrack = useCallback(() => {
    guard('groove', () => {
      const track = selectedTrack
      if (track.notes.length === 0) {
        setStatus('Add notes to the selected track first, then apply a groove.')
        controller.notify('Nothing to groove — the selected track is empty.')
        return
      }
      const preset = findGroovePreset(groovePresetId) ?? GROOVE_PRESETS[0]
      const seed = hashString(`${track.id}:${preset.id}:${grooveIntensity.toFixed(2)}`)
      const grooved = applyGroove(toSuggested(track.notes), {
        swing: preset.swing * grooveIntensity,
        humanizeTiming: preset.humanizeTiming * grooveIntensity,
        humanizeVelocity: preset.humanizeVelocity * grooveIntensity,
        seed,
      })
      track.notes.forEach((note, index) => {
        const next = grooved[index]
        controller.updateNote(track.id, note.id, {
          start: next.start,
          velocity: next.velocity,
        })
      })
      const message = `Applied ${preset.name} groove to ${track.name}.`
      controller.notify(message)
      setStatus(message)
    })
  }, [guard, selectedTrack, groovePresetId, grooveIntensity, controller])

  const analyze = useCallback(() => {
    guard('auto-master', () => {
      const result = analyzeMastering(controller.project)
      setReport(result)
      controller.notify(result.summary)
      setStatus(result.summary)
    })
  }, [guard, controller])

  return {
    unlimited,
    feature,
    setFeature,
    canUse,
    prompt,
    setPrompt,
    motifLength,
    setMotifLength,
    createMotif,
    styleId,
    setStyleId,
    applyStyleToTrack,
    groovePresetId,
    setGroovePresetId,
    grooveIntensity,
    setGrooveIntensity,
    applyGrooveToTrack,
    report,
    analyze,
    status,
  }
}
