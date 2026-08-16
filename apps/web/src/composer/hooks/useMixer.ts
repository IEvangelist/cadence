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
import type { MasterBusState, TrackInsert } from '../contract/mixing'
import type { AutomationLane, AutomationTarget } from '../model/automation'
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
  /** Project length in beats — the automation lane's horizontal span. */
  lengthBeats: number
  /** Editing grid (beats) automation points snap to. */
  snap: number
  /** The project's persisted automation lanes (source of truth for the lane UI). */
  automation: readonly AutomationLane[]

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

  /** Write the track's current gain as a point at the playhead. */
  writeTrackGainAutomation: (trackId: string) => void
  /** Write the track's current pan as a point at the playhead. */
  writeTrackPanAutomation: (trackId: string) => void
  /** Write the master's current gain as a point at the playhead. */
  writeMasterGainAutomation: () => void
  /** Add or replace an automation point at an explicit beat/value (lane drawing). */
  writeAutomationPoint: (
    target: AutomationTarget,
    trackId: string | undefined,
    beat: number,
    value: number,
  ) => void
  /** Remove the automation point at `beat` from a lane. */
  removeAutomationPoint: (
    target: AutomationTarget,
    trackId: string | undefined,
    beat: number,
  ) => void
  /** Clear an entire automation lane. */
  clearAutomationLane: (target: AutomationTarget, trackId?: string) => void
  stopHistoryCapture: () => void
}

const listEffectOptions = (): MixerEffectOption[] =>
  defaultPluginHost.effects().map((effect) => ({ id: effect.id, name: effect.name }))

const laneMatchesTrack = (lane: AutomationLane, trackId: string): boolean =>
  (lane.target === 'trackGain' || lane.target === 'trackPan') && lane.trackId === trackId

export function useMixer(controller: ComposerController): MixerViewModel {
  const {
    mixer,
    project,
    transportState,
    positionBeats,
    snap,
    writeAutomationPoint: dispatchWritePoint,
    removeAutomationPoint: dispatchRemovePoint,
    clearAutomationLane: dispatchClearLane,
    setTrackMix: dispatchTrackMix,
    addMixInsert: dispatchAddInsert,
    removeMixInsert: dispatchRemoveInsert,
    setMixInsertEnabled: dispatchSetInsertEnabled,
    setMasterMix: dispatchMasterMix,
  } = controller
  const view = useSyncExternalStore(mixer.subscribe, mixer.getView, mixer.getView)

  // The project owns automation (persisted + serialized); the controller only
  // mirrors it for playback. Memoize so a project with no lanes stays referentially
  // stable across renders.
  const automation = useMemo<readonly AutomationLane[]>(
    () => project.automation ?? [],
    [project.automation],
  )

  const [availableEffects, setAvailableEffects] = useState<MixerEffectOption[]>(listEffectOptions)
  useEffect(() => {
    return defaultPluginHost.subscribe(() => {
      setAvailableEffects(listEffectOptions())
      mixer.refreshInserts()
    })
  }, [mixer])

  // Keep the latest playhead in a ref so the "write at playhead" callbacks stay
  // stable (they must not be re-created on every animation frame).
  const positionRef = useRef(positionBeats)
  useEffect(() => {
    positionRef.current = positionBeats
  }, [positionBeats])

  // Mirror the project's persisted automation into the controller so playback
  // (applyAutomationAt) samples exactly the lanes the user has drawn and saved.
  // This is the #44 mixer overlay — it never touches the frozen #97 note seam.
  useEffect(() => {
    mixer.setAutomation(automation)
  }, [mixer, automation])

  // Replace the runtime mixer mirror whenever a project is loaded or its durable
  // mix document changes. This stays outside the frozen note scheduling seam.
  useEffect(() => {
    mixer.hydrate(project.mix)
  }, [mixer, project.mix])

  // Drive automation from the transport: apply interpolated values while playing,
  // then release back to the manual snapshot values when playback stops/pauses.
  useEffect(() => {
    if (transportState === 'playing') mixer.applyAutomationAt(positionBeats)
  }, [mixer, transportState, positionBeats])
  useEffect(() => {
    if (transportState !== 'playing') mixer.releaseAutomation()
  }, [mixer, transportState])

  const tracks = useMemo<MixerTrackView[]>(() => {
    const { snapshot, insertsByTrack } = view
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
  }, [view, project.tracks, automation])

  const masterAutomated = useMemo(
    () => automation.some((lane) => lane.target === 'masterGain'),
    [automation],
  )

  const effectLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const effect of availableEffects) map.set(effect.id, effect.name)
    return map
  }, [availableEffects])

  const effectName = useCallback(
    (effectId: string) => effectLabels.get(effectId) ?? `${effectId} (unavailable)`,
    [effectLabels],
  )

  const setTrackGain = useCallback(
    (trackId: string, gainDb: number) => dispatchTrackMix(trackId, { gainDb }),
    [dispatchTrackMix],
  )
  const setTrackPan = useCallback(
    (trackId: string, pan: number) => dispatchTrackMix(trackId, { pan }),
    [dispatchTrackMix],
  )
  const toggleSolo = useCallback(
    (trackId: string) =>
      dispatchTrackMix(trackId, {
        solo: !(project.mix?.tracks[trackId]?.solo ?? false),
      }),
    [dispatchTrackMix, project.mix],
  )
  const toggleMute = useCallback((trackId: string) => controller.toggleMute(trackId), [controller])

  const addInsert = useCallback(
    (trackId: string, effectId: string) => dispatchAddInsert(trackId, effectId),
    [dispatchAddInsert],
  )
  const removeInsert = useCallback(
    (trackId: string, insertId: string) => dispatchRemoveInsert(trackId, insertId),
    [dispatchRemoveInsert],
  )
  const toggleInsert = useCallback(
    (trackId: string, insertId: string) => {
      const insert = project.mix?.tracks[trackId]?.inserts.find((entry) => entry.id === insertId)
      if (insert) dispatchSetInsertEnabled(trackId, insertId, !insert.enabled)
    },
    [dispatchSetInsertEnabled, project.mix],
  )

  const setMasterGain = useCallback(
    (gainDb: number) => dispatchMasterMix({ gainDb }),
    [dispatchMasterMix],
  )
  const setLimiterEnabled = useCallback(
    (enabled: boolean) => dispatchMasterMix({ limiterEnabled: enabled }),
    [dispatchMasterMix],
  )
  const setLimiterThreshold = useCallback(
    (thresholdDb: number) => dispatchMasterMix({ limiterThresholdDb: thresholdDb }),
    [dispatchMasterMix],
  )

  const writeTrackGainAutomation = useCallback(
    (trackId: string) => {
      const value = mixer.getSnapshot().tracks[trackId]?.gainDb ?? 0
      dispatchWritePoint('trackGain', trackId, { beat: positionRef.current, value })
    },
    [mixer, dispatchWritePoint],
  )
  const writeTrackPanAutomation = useCallback(
    (trackId: string) => {
      const value = mixer.getSnapshot().tracks[trackId]?.pan ?? 0
      dispatchWritePoint('trackPan', trackId, { beat: positionRef.current, value })
    },
    [mixer, dispatchWritePoint],
  )
  const writeMasterGainAutomation = useCallback(() => {
    dispatchWritePoint('masterGain', undefined, {
      beat: positionRef.current,
      value: mixer.getSnapshot().master.gainDb,
    })
  }, [mixer, dispatchWritePoint])

  const writeAutomationPoint = useCallback(
    (target: AutomationTarget, trackId: string | undefined, beat: number, value: number) =>
      dispatchWritePoint(target, trackId, { beat, value }),
    [dispatchWritePoint],
  )
  const removeAutomationPoint = useCallback(
    (target: AutomationTarget, trackId: string | undefined, beat: number) =>
      dispatchRemovePoint(target, trackId, beat),
    [dispatchRemovePoint],
  )
  const clearAutomationLane = useCallback(
    (target: AutomationTarget, trackId?: string) => dispatchClearLane(target, trackId),
    [dispatchClearLane],
  )

  return {
    tracks,
    master: view.snapshot.master,
    masterAutomated,
    availableEffects,
    effectName,
    positionBeats,
    lengthBeats: project.lengthBeats,
    snap,
    automation,
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
    writeMasterGainAutomation,
    writeAutomationPoint,
    removeAutomationPoint,
    clearAutomationLane,
    stopHistoryCapture: controller.stopHistoryCapture,
  }
}
