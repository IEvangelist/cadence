/**
 * MixerController — the stateful bridge between the mixer UI and the audio graph.
 *
 * Implements the frozen `contract/mixing.ts` {@link MixerContract} surface
 * (`getSnapshot`, `setTrackGain/Pan/Solo`, `setMaster`, `listInserts`) and adds
 * the additive runtime surface the panel/hook need (subscribe, insert add/remove,
 * automation authoring, and playback application). It owns the mixer's *state*;
 * the optional {@link MixerGraph} owns the Tone nodes. In environments without
 * Web Audio (jsdom, the silent engine) the graph is omitted and the controller is
 * a fully-functional, state-only store — so the UI works everywhere.
 *
 * Mute is NOT owned here: `Track.muted` is the single source of truth (toggled via
 * the composer's public `toggleMute`). {@link syncTracks} mirrors it into the
 * snapshot and folds it — with solo — into per-channel audibility.
 */
import type {
  AutomationLane,
  AutomationPoint,
  MasterBusState,
  MixerController as MixerContract,
  MixerSnapshot,
  TrackInsert,
  TrackMixerState,
} from '../contract/mixing'
import type { EffectNode } from '../plugins/types'
import { newId } from '../model/project'
import { sampleAutomation, upsertPoint } from './automation'
import type { MixerGraph } from './mixerGraph'

/** Automation targets the mixer authors (the contract also allows other strings). */
export type AutomationTarget = 'trackGain' | 'trackPan' | 'masterGain'

/** The cached, referentially-stable view the React hook subscribes to. */
export interface MixerView {
  snapshot: MixerSnapshot
  insertsByTrack: Readonly<Record<string, readonly TrackInsert[]>>
  automation: readonly AutomationLane[]
}

/** The runtime mixer controller: the frozen contract plus additive extensions. */
export interface MixerController extends MixerContract {
  /** Subscribe to state changes; returns an unsubscribe fn (for useSyncExternalStore). */
  subscribe(listener: () => void): () => void
  /** The current cached view (stable between mutations). */
  getView(): MixerView
  /** Reconcile the track set + mirror `Track.muted`; drives channel lifecycle. */
  syncTracks(tracks: readonly { id: string; muted: boolean }[]): void
  addInsert(trackId: string, effectId: string): void
  removeInsert(trackId: string, insertId: string): void
  setInsertEnabled(trackId: string, insertId: string, enabled: boolean): void
  /** Write (or replace) an automation point at a beat for a target. */
  writeAutomationPoint(target: AutomationTarget, trackId: string | undefined, point: AutomationPoint): void
  clearAutomationLane(target: AutomationTarget, trackId?: string): void
  /** Replace the whole automation set (mirrors the project document for playback). */
  setAutomation(lanes: readonly AutomationLane[]): void
  /** Apply interpolated automation for `beat` to the graph (playback). */
  applyAutomationAt(beat: number): void
  /** Restore manual (snapshot) values to the graph after automated playback. */
  releaseAutomation(): void
  dispose(): void
}

export interface MixerControllerDeps {
  /** The audio graph to drive. Omit for a state-only controller (no Web Audio). */
  graph?: MixerGraph | null
  /** Build an effect node for an insert's effect id (from the plugin host). */
  createEffect?: (effectId: string) => EffectNode | null
}

const GAIN_MIN = -60
const GAIN_MAX = 6
const THRESHOLD_MIN = -60
const THRESHOLD_MAX = 0

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const DEFAULT_MASTER: MasterBusState = {
  gainDb: 0,
  limiterEnabled: false,
  limiterThresholdDb: -1,
}

const defaultTrack = (trackId: string): TrackMixerState => ({
  trackId,
  gainDb: 0,
  pan: 0,
  solo: false,
  muted: false,
})

const EMPTY_INSERTS: readonly TrackInsert[] = Object.freeze([])

/** Build a mixer controller, optionally bound to an audio graph. */
export function createMixerController(deps: MixerControllerDeps = {}): MixerController {
  const graph = deps.graph ?? null
  const createEffect = deps.createEffect ?? (() => null)

  const trackStates = new Map<string, TrackMixerState>()
  const insertsByTrack = new Map<string, TrackInsert[]>()
  let master: MasterBusState = { ...DEFAULT_MASTER }
  let lanes: AutomationLane[] = []
  const listeners = new Set<() => void>()
  let view: MixerView = buildView()

  function buildView(): MixerView {
    const tracks: Record<string, TrackMixerState> = {}
    for (const [id, state] of trackStates) tracks[id] = { ...state }
    const inserts: Record<string, readonly TrackInsert[]> = {}
    for (const [id, list] of insertsByTrack) inserts[id] = list.map((insert) => ({ ...insert }))
    return {
      snapshot: { tracks, master: { ...master } },
      insertsByTrack: inserts,
      automation: lanes.map((lane) => ({ ...lane, points: [...lane.points] })),
    }
  }

  function commit(): void {
    view = buildView()
    for (const listener of listeners) listener()
  }

  function ensureTrack(trackId: string, isNew = false): TrackMixerState {
    let state = trackStates.get(trackId)
    if (!state) {
      state = defaultTrack(trackId)
      trackStates.set(trackId, state)
      if (graph) {
        graph.ensureChannel(trackId)
        graph.setTrackGain(trackId, state.gainDb)
        graph.setTrackPan(trackId, state.pan)
      }
    } else if (isNew && graph) {
      graph.ensureChannel(trackId)
    }
    return state
  }

  /** Audibility folds mute + solo: silence when muted, or when another track solos. */
  function applyAudibility(): void {
    if (!graph) return
    const anySolo = [...trackStates.values()].some((state) => state.solo)
    for (const [id, state] of trackStates) {
      graph.setChannelAudible(id, !state.muted && (!anySolo || state.solo))
    }
  }

  function rebuildGraphInserts(trackId: string): void {
    if (!graph) return
    const list = insertsByTrack.get(trackId) ?? []
    const nodes: EffectNode[] = []
    for (const insert of list) {
      if (!insert.enabled) continue
      const node = createEffect(insert.effectId)
      if (node) nodes.push(node)
    }
    graph.setTrackInserts(trackId, nodes)
  }

  function findLane(target: AutomationTarget, trackId?: string): AutomationLane | undefined {
    return lanes.find((lane) => lane.target === target && lane.trackId === trackId)
  }

  return {
    getSnapshot(): MixerSnapshot {
      return view.snapshot
    },
    getView(): MixerView {
      return view
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    syncTracks(tracks) {
      const nextIds = new Set(tracks.map((track) => track.id))
      // Drop channels/state for tracks that no longer exist.
      for (const id of [...trackStates.keys()]) {
        if (nextIds.has(id)) continue
        trackStates.delete(id)
        insertsByTrack.delete(id)
        graph?.disposeChannel(id)
      }
      // Ensure state + mirror mute for the current tracks.
      for (const track of tracks) {
        const state = ensureTrack(track.id, true)
        state.muted = track.muted
      }
      applyAudibility()
      commit()
    },
    setTrackGain(trackId, gainDb) {
      const state = ensureTrack(trackId)
      state.gainDb = clamp(gainDb, GAIN_MIN, GAIN_MAX)
      graph?.setTrackGain(trackId, state.gainDb)
      commit()
    },
    setTrackPan(trackId, pan) {
      const state = ensureTrack(trackId)
      state.pan = clamp(pan, -1, 1)
      graph?.setTrackPan(trackId, state.pan)
      commit()
    },
    setTrackSolo(trackId, solo) {
      ensureTrack(trackId).solo = solo
      applyAudibility()
      commit()
    },
    setMaster(next) {
      master = {
        gainDb: clamp(next.gainDb ?? master.gainDb, GAIN_MIN, GAIN_MAX),
        limiterEnabled: next.limiterEnabled ?? master.limiterEnabled,
        limiterThresholdDb: clamp(
          next.limiterThresholdDb ?? master.limiterThresholdDb,
          THRESHOLD_MIN,
          THRESHOLD_MAX,
        ),
      }
      graph?.setMasterGain(master.gainDb)
      graph?.setLimiter(master.limiterEnabled, master.limiterThresholdDb)
      commit()
    },
    listInserts(trackId) {
      return view.insertsByTrack[trackId] ?? EMPTY_INSERTS
    },
    addInsert(trackId, effectId) {
      ensureTrack(trackId)
      const list = insertsByTrack.get(trackId) ?? []
      list.push({ id: newId('insert'), effectId, enabled: true, params: {} })
      insertsByTrack.set(trackId, list)
      rebuildGraphInserts(trackId)
      commit()
    },
    removeInsert(trackId, insertId) {
      const list = insertsByTrack.get(trackId)
      if (!list) return
      insertsByTrack.set(
        trackId,
        list.filter((insert) => insert.id !== insertId),
      )
      rebuildGraphInserts(trackId)
      commit()
    },
    setInsertEnabled(trackId, insertId, enabled) {
      const list = insertsByTrack.get(trackId)
      if (!list) return
      const insert = list.find((entry) => entry.id === insertId)
      if (!insert) return
      insert.enabled = enabled
      rebuildGraphInserts(trackId)
      commit()
    },
    writeAutomationPoint(target, trackId, point) {
      const lane = findLane(target, trackId)
      if (lane) {
        lane.points = upsertPoint(lane.points, point)
      } else {
        lanes = [...lanes, { target, trackId, points: [point] }]
      }
      commit()
    },
    clearAutomationLane(target, trackId) {
      lanes = lanes.filter((lane) => !(lane.target === target && lane.trackId === trackId))
      commit()
    },
    setAutomation(next) {
      // Replace the playback mirror wholesale; clone so external edits can't mutate
      // our copy. The project (via the reducer) remains the source of truth.
      lanes = next.map((lane) => ({ ...lane, points: [...lane.points] }))
      commit()
    },
    applyAutomationAt(beat) {
      if (!graph) return
      const frame = sampleAutomation(lanes, beat)
      for (const [id, value] of frame.trackGain) graph.setTrackGain(id, value)
      for (const [id, value] of frame.trackPan) graph.setTrackPan(id, value)
      if (frame.masterGain !== null) graph.setMasterGain(frame.masterGain)
    },
    releaseAutomation() {
      if (!graph) return
      for (const [id, state] of trackStates) {
        graph.setTrackGain(id, state.gainDb)
        graph.setTrackPan(id, state.pan)
      }
      graph.setMasterGain(master.gainDb)
    },
    dispose() {
      listeners.clear()
      graph?.dispose()
    },
  }
}
