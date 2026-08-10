/**
 * useMixer — orchestrates the #44 mixer for the UI.
 *
 * Talks only to the composer's *public* controller surface: it subscribes to the
 * contract {@link MixerController} via `useSyncExternalStore`, merges the mixer
 * overlay with the project's tracks (name/color, and `muted` — still owned by the
 * project), and exposes the insert palette from the plugin host. It also owns the
 * playback glue: while the transport plays it pushes interpolated automation onto
 * the mixer, and releases back to manual values when it stops. Keeping that here
 * means the composer core (engine/reducer/store) needs no automation-specific edits.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { AutomationLane, MasterBusState, TrackInsert } from '../contract/mixing'
import { defaultPluginHost } from '../plugins/defaultHost'
import type { ComposerController } from './useComposer'

/** A per-track mixer strip, merged from the project track + mixer overlay. */
export interface MixerTrackView {
  id: string
  name: string
  color: string
  gainDb: number
  pan: number
  solo: boolean
  muted: boolean
  inserts: readonly TrackInsert[]
  /** True when this track has any automation lane. */
  automated: boolean
}

/** An insert effect the mixer can add to a track. */
export interface MixerEffectOption {
  id: string
  name: string
}

export interface MixerViewModel {
  tracks: MixerTrackView[]
  master: MasterBusState
  masterAutomated: boolean
  availableEffects: MixerEffectOption[]
  /** Human label for an effect id (falls back to the id). */
  effectName: (effectId: string) => string
  /** Current playhead in beats (for the "write at playhead" affordances). */
  positionBeats: number

  setTrackGain: (trackId: string, gainDb: number) => void
  setTrackPan: (trackId: string, pan: number) => void
  toggleSolo: (trackId: string) => void
  toggleMute: (trackId: string) => void

  addInsert: (trackId: string, effectId: string) => void
  removeInsert: (trackId: string, insertId: string) => void
  toggleInsert: (trackId: string, insertId: string) => void

  setMasterGain: (gainDb: number) => void
  setLimiterEnabled: (enabled: boolean) => void
  setLimiterThreshold: (thresholdDb: number) => void

  writeTrackGainAutomation: (trackId: string) => void
  writeTrackPanAutomation: (trackId: string) => void
  clearTrackAutomation: (trackId: string) => void
  writeMasterGainAutomation: () => void
  clearMasterAutomation: () => void
}

const listEffectOptions = (): MixerEffectOption[] =>
  defaultPluginHost.effects().map((effect) => ({ id: effect.id, name: effect.name }))

const laneMatchesTrack = (lane: AutomationLane, trackId: string): boolean =>
  (lane.target === 'trackGain' || lane.target === 'trackPan') && lane.trackId === trackId

export function useMixer(controller: ComposerController): MixerViewModel {
  const { mixer, project, transportState, positionBeats } = controller
  const view = useSyncExternalStore(mixer.subscribe, mixer.getView, mixer.getView)

  const [availableEffects, setAvailableEffects] = useState<MixerEffectOption[]>(listEffectOptions)
  useEffect(
    () => defaultPluginHost.subscribe(() => setAvailableEffects(listEffectOptions())),
    [],
  )

  // Keep the latest playhead in a ref so the "write at playhead" callbacks stay
  // stable (they must not be re-created on every animation frame).
  const positionRef = useRef(positionBeats)
  useEffect(() => {
    positionRef.current = positionBeats
  }, [positionBeats])

  // Drive automation from the transport: apply interpolated values while playing,
  // then release back to the manual snapshot values when playback stops/pauses.
  useEffect(() => {
    if (transportState === 'playing') mixer.applyAutomationAt(positionBeats)
  }, [mixer, transportState, positionBeats])
  useEffect(() => {
    if (transportState !== 'playing') mixer.releaseAutomation()
  }, [mixer, transportState])

  const tracks = useMemo<MixerTrackView[]>(() => {
    const { snapshot, insertsByTrack, automation } = view
    return project.tracks.map((track) => {
      const state = snapshot.tracks[track.id]
      return {
        id: track.id,
        name: track.name,
        color: track.color,
        gainDb: state?.gainDb ?? 0,
        pan: state?.pan ?? 0,
        solo: state?.solo ?? false,
        muted: track.muted,
        inserts: insertsByTrack[track.id] ?? [],
        automated: automation.some((lane) => laneMatchesTrack(lane, track.id)),
      }
    })
  }, [view, project.tracks])

  const masterAutomated = useMemo(
    () => view.automation.some((lane) => lane.target === 'masterGain'),
    [view.automation],
  )

  const effectLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const effect of availableEffects) map.set(effect.id, effect.name)
    return map
  }, [availableEffects])

  const effectName = useCallback(
    (effectId: string) => effectLabels.get(effectId) ?? effectId,
    [effectLabels],
  )

  const setTrackGain = useCallback((trackId: string, gainDb: number) => mixer.setTrackGain(trackId, gainDb), [mixer])
  const setTrackPan = useCallback((trackId: string, pan: number) => mixer.setTrackPan(trackId, pan), [mixer])
  const toggleSolo = useCallback(
    (trackId: string) => mixer.setTrackSolo(trackId, !(mixer.getSnapshot().tracks[trackId]?.solo ?? false)),
    [mixer],
  )
  const toggleMute = useCallback((trackId: string) => controller.toggleMute(trackId), [controller])

  const addInsert = useCallback((trackId: string, effectId: string) => mixer.addInsert(trackId, effectId), [mixer])
  const removeInsert = useCallback(
    (trackId: string, insertId: string) => mixer.removeInsert(trackId, insertId),
    [mixer],
  )
  const toggleInsert = useCallback(
    (trackId: string, insertId: string) => {
      const insert = mixer.listInserts(trackId).find((entry) => entry.id === insertId)
      if (insert) mixer.setInsertEnabled(trackId, insertId, !insert.enabled)
    },
    [mixer],
  )

  const setMasterGain = useCallback((gainDb: number) => mixer.setMaster({ gainDb }), [mixer])
  const setLimiterEnabled = useCallback(
    (enabled: boolean) => mixer.setMaster({ limiterEnabled: enabled }),
    [mixer],
  )
  const setLimiterThreshold = useCallback(
    (thresholdDb: number) => mixer.setMaster({ limiterThresholdDb: thresholdDb }),
    [mixer],
  )

  const writeTrackGainAutomation = useCallback(
    (trackId: string) => {
      const value = mixer.getSnapshot().tracks[trackId]?.gainDb ?? 0
      mixer.writeAutomationPoint('trackGain', trackId, { beat: positionRef.current, value })
    },
    [mixer],
  )
  const writeTrackPanAutomation = useCallback(
    (trackId: string) => {
      const value = mixer.getSnapshot().tracks[trackId]?.pan ?? 0
      mixer.writeAutomationPoint('trackPan', trackId, { beat: positionRef.current, value })
    },
    [mixer],
  )
  const clearTrackAutomation = useCallback(
    (trackId: string) => {
      mixer.clearAutomationLane('trackGain', trackId)
      mixer.clearAutomationLane('trackPan', trackId)
    },
    [mixer],
  )
  const writeMasterGainAutomation = useCallback(() => {
    mixer.writeAutomationPoint('masterGain', undefined, {
      beat: positionRef.current,
      value: mixer.getSnapshot().master.gainDb,
    })
  }, [mixer])
  const clearMasterAutomation = useCallback(() => mixer.clearAutomationLane('masterGain'), [mixer])

  return {
    tracks,
    master: view.snapshot.master,
    masterAutomated,
    availableEffects,
    effectName,
    positionBeats,
    setTrackGain,
    setTrackPan,
    toggleSolo,
    toggleMute,
    addInsert,
    removeInsert,
    toggleInsert,
    setMasterGain,
    setLimiterEnabled,
    setLimiterThreshold,
    writeTrackGainAutomation,
    writeTrackPanAutomation,
    clearTrackAutomation,
    writeMasterGainAutomation,
    clearMasterAutomation,
  }
}
