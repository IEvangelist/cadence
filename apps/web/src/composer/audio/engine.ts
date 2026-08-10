/**
 * Tone.js audio engine.
 *
 * All scheduling is driven by the Web Audio clock via `Tone.Transport` (never
 * `setInterval`): notes are placed on the transport timeline as Tone Parts, so
 * playback stays sample-accurate and follows tempo/loop changes. The rest of the
 * app talks to the small {@link AudioEngine} interface, so instruments/effects
 * can grow later and the engine can be swapped or mocked in tests.
 */
import * as Tone from 'tone'
import {
  type InstrumentId,
  type LoopRegion,
  type Note,
  type Project,
  type Track,
} from '../model/project'
import { getInstrumentContribution } from '../instruments/registry'
import { defaultPluginHost } from '../plugins/defaultHost'
import { connectEffectChain } from '../plugins/effectChain'
import type { EffectNode, InstrumentVoice } from '../plugins/types'
import { createMixerGraph, type MixerGraph } from './mixerGraph'
import { createMixerController, type MixerController } from './mixerController'
import {
  beatsToBarsBeatsSixteenths,
  beatsToSeconds,
  secondsToBeats,
} from '../timing/timing'

export type TransportState = 'stopped' | 'playing' | 'paused'

export interface AudioEngine {
  readonly state: TransportState
  /** The #44 mixer: per-track gain/pan/solo, inserts, master bus + automation. */
  readonly mixer: MixerController
  /** Start (or resume) playback. Resolves once the audio context is running. */
  play(): Promise<void>
  pause(): void
  stop(): void
  setTempo(bpm: number): void
  setLoop(loop: LoopRegion): void
  /** Rebuild instruments + scheduled parts from the project. */
  setProject(project: Project): void
  /** Current transport position in beats (wraps within an active loop). */
  positionBeats(): number
  /** Audition a single note immediately (for keyboard/preview feedback). */
  previewNote(track: Track, pitch: number, durationBeats?: number): void
  /** Subscribe to transport state changes; returns an unsubscribe function. */
  onStateChange(listener: (state: TransportState) => void): () => void
  /**
   * Rebuild the audio graph if it has been disposed. React StrictMode (dev)
   * mounts, unmounts — disposing the engine — then remounts the *same* instance;
   * calling this on remount revives the graph so playback is never left silent
   * on dead nodes (#97). It is a no-op while the engine is alive.
   */
  ensureAlive(): void
  dispose(): void
}

/** A playable voice for one track. Times are absolute audio-context seconds. */
type Voice = InstrumentVoice

type ToneOutput = Tone.Gain

interface ScheduledEvent {
  time: string
  note: Note
}

export class ToneAudioEngine implements AudioEngine {
  private master!: ToneOutput
  // Voices connect to this bus; the bus routes through the master effect chain.
  private voiceBus!: ToneOutput
  private readonly effectNodes: EffectNode[] = []
  // The #44 mixer graph sits between the voices and the master bus.
  private mixerGraph!: MixerGraph
  private _mixer!: MixerController
  // Voices and parts are keyed by track id so edits touch only what changed.
  private readonly voices = new Map<string, Voice>()
  private readonly parts = new Map<string, Tone.Part<ScheduledEvent>>()
  // Last-seen instrument per track, to detect when a voice must be rebuilt.
  private readonly trackInstruments = new Map<string, InstrumentId>()
  private tempo = 120
  private loop: LoopRegion = { enabled: false, start: 0, end: 16 }
  private _state: TransportState = 'stopped'
  // True once dispose() has torn down the graph; guards ensureAlive() rebuilds.
  private disposed = false
  private readonly listeners = new Set<(state: TransportState) => void>()

  constructor() {
    this.build()
  }

  /**
   * Construct (or reconstruct) the audio graph: master bus, voice bus, master
   * effect chain, and the #44 mixer overlay. Split out of the constructor so the
   * engine can be revived after {@link dispose} — see {@link ensureAlive}.
   */
  private build(): void {
    this.master = new Tone.Gain(0.9).toDestination()
    this.voiceBus = new Tone.Gain(1)
    this.buildEffectChain()
    // Route the mixer's master output into the existing voice bus so the mixer is
    // an additive stage; with default (transparent) settings the sound is unchanged.
    this.mixerGraph = createMixerGraph()
    this.mixerGraph.output.connect(this.voiceBus)
    this._mixer = createMixerController({
      graph: this.mixerGraph,
      createEffect: (effectId) => this.createInsertNode(effectId),
    })
    Tone.getTransport().bpm.value = this.tempo
    this.disposed = false
  }

  /**
   * Rebuild the graph if it was disposed. StrictMode (dev) disposes the engine on
   * the throwaway first mount, then remounts the same instance; without this the
   * revived UI would drive dead audio nodes and play nothing (#97). Voices/parts
   * are re-populated by the subsequent `setProject`, whose maps `dispose` cleared.
   */
  ensureAlive(): void {
    if (this.disposed) this.build()
  }

  get mixer(): MixerController {
    return this._mixer
  }

  /** Build an insert node for a mixer effect id via the plugin host (or null). */
  private createInsertNode(effectId: string): EffectNode | null {
    const contribution = defaultPluginHost.effects().find((effect) => effect.id === effectId)
    return contribution ? contribution.createNode({ tempo: this.tempo }) : null
  }

  /**
   * Build the master effect chain from the plugin host's active effects
   * (`enabledByDefault`) and route `voiceBus → effects → master`. With no active
   * effects the bus connects straight to master, so the default path is unchanged.
   * Runtime enable/disable of effects is a documented follow-up (see docs/plugins.md).
   */
  private buildEffectChain(): void {
    const active = defaultPluginHost.effects().filter((e) => e.enabledByDefault)
    for (const contribution of active) {
      this.effectNodes.push(contribution.createNode({ tempo: this.tempo }))
    }
    connectEffectChain(this.voiceBus, this.effectNodes, this.master)
  }

  get state(): TransportState {
    return this._state
  }

  /** Resolve and build the voice for a track through the plugin host. */
  private buildVoice(track: Track, output: ToneOutput = this.mixerGraph.channelInput(track.id)): Voice {
    return getInstrumentContribution(track.instrumentId).createVoice({
      output,
      track,
      tempo: this.tempo,
    })
  }

  private setState(state: TransportState): void {
    if (state === this._state) return
    this._state = state
    for (const listener of this.listeners) listener(state)
  }

  onStateChange(listener: (state: TransportState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setTempo(bpm: number): void {
    this.tempo = bpm
    Tone.getTransport().bpm.value = bpm
  }

  setLoop(loop: LoopRegion): void {
    this.loop = loop
    const transport = Tone.getTransport()
    transport.loop = loop.enabled
    if (loop.enabled) {
      transport.loopStart = beatsToBarsBeatsSixteenths(loop.start)
      transport.loopEnd = beatsToBarsBeatsSixteenths(loop.end)
    }
    for (const part of this.parts.values()) {
      part.loop = loop.enabled
      if (loop.enabled) {
        part.loopStart = beatsToBarsBeatsSixteenths(loop.start)
        part.loopEnd = beatsToBarsBeatsSixteenths(loop.end)
      }
    }
  }

  /**
   * Reconcile the engine with a new project. Instruments are only (re)built when
   * a track is added or its `instrumentId` changes; when only note data changes
   * (add/move/resize — potentially ~60×/s during a drag), the existing
   * `Tone.Part` events are replaced in place so sounding voices are never
   * disposed mid-play.
   */
  setProject(project: Project): void {
    this.setTempo(project.tempo)
    const seen = new Set<string>()

    for (const track of project.tracks) {
      seen.add(track.id)
      const voiceIsStale =
        !this.voices.has(track.id) ||
        this.trackInstruments.get(track.id) !== track.instrumentId

      if (voiceIsStale) {
        this.voices.get(track.id)?.dispose()
        this.voices.set(track.id, this.buildVoice(track))
        this.trackInstruments.set(track.id, track.instrumentId)
      }
      // Rebuild the part only when the voice changed (so its callback binds the
      // new voice); otherwise just replace the scheduled events.
      this.reschedule(track, this.voices.get(track.id)!, voiceIsStale)
    }

    // Drop voices/parts for tracks that no longer exist.
    for (const id of [...this.voices.keys()]) {
      if (seen.has(id)) continue
      this.parts.get(id)?.dispose()
      this.parts.delete(id)
      this.voices.get(id)?.dispose()
      this.voices.delete(id)
      this.trackInstruments.delete(id)
    }

    // Reconcile the mixer overlay: ensure a channel per track, mirror Track.muted,
    // and dispose channels for removed tracks (after their voices are torn down).
    this._mixer.syncTracks(project.tracks.map((track) => ({ id: track.id, muted: track.muted })))

    this.setLoop(project.loop)
  }

  private reschedule(track: Track, voice: Voice, rebuild: boolean): void {
    const existing = this.parts.get(track.id)
    if (track.muted || track.notes.length === 0) {
      existing?.dispose()
      this.parts.delete(track.id)
      return
    }

    const events: ScheduledEvent[] = track.notes.map((note) => ({
      time: beatsToBarsBeatsSixteenths(note.start),
      note,
    }))

    if (existing && !rebuild) {
      // Only note data changed: swap the events without touching the instrument.
      existing.clear()
      for (const event of events) existing.add(event.time, event)
      return
    }

    existing?.dispose()
    const part = new Tone.Part<ScheduledEvent>((time, event) => {
      const duration = beatsToSeconds(event.note.duration, this.tempo)
      voice.trigger(event.note.pitch, duration, time, event.note.velocity)
    }, events)
    part.start(0)
    this.parts.set(track.id, part)
  }

  async play(): Promise<void> {
    await Tone.start()
    Tone.getTransport().start()
    this.setState('playing')
  }

  pause(): void {
    Tone.getTransport().pause()
    this.setState('paused')
  }

  stop(): void {
    const transport = Tone.getTransport()
    transport.stop()
    transport.position = 0
    this.setState('stopped')
  }

  positionBeats(): number {
    const seconds = Tone.getTransport().seconds
    const beats = secondsToBeats(seconds, this.tempo)
    if (this.loop.enabled && this.loop.end > this.loop.start) {
      const span = this.loop.end - this.loop.start
      if (beats >= this.loop.start) {
        return this.loop.start + ((beats - this.loop.start) % span)
      }
    }
    return beats
  }

  previewNote(track: Track, pitch: number, durationBeats = 0.5): void {
    // Auditions come from a user gesture, so it is safe (and required on first
    // interaction) to resume the audio context before triggering the voice.
    void Tone.start()
    // Route the preview past the mixer (straight to the voice bus) so an audition
    // is always audible regardless of the track's mute/solo/gain state.
    const voice = this.buildVoice(track, this.voiceBus)
    const duration = beatsToSeconds(durationBeats, this.tempo)
    voice.trigger(pitch, duration, Tone.now(), 0.9)
    // Free the one-shot preview voice after it has rung out.
    setTimeout(() => voice.dispose(), (duration + 0.5) * 1000)
  }

  private disposeVoicesAndParts(): void {
    for (const part of this.parts.values()) part.dispose()
    for (const voice of this.voices.values()) voice.dispose()
    this.parts.clear()
    this.voices.clear()
    this.trackInstruments.clear()
  }

  dispose(): void {
    this.stop()
    Tone.getTransport().cancel()
    this.disposeVoicesAndParts()
    // Disposes the mixer graph (channels, inserts, limiter, master + output).
    this._mixer.dispose()
    for (const effect of this.effectNodes) effect.dispose()
    this.effectNodes.length = 0
    this.voiceBus.dispose()
    this.master.dispose()
    this.listeners.clear()
    this.disposed = true
  }
}

/** Factory for the default engine (kept as a seam for tests/alternate engines). */
export function createAudioEngine(): AudioEngine {
  return isAudioSupported() ? new ToneAudioEngine() : new SilentAudioEngine()
}

/** True when the runtime exposes the Web Audio API. */
export function isAudioSupported(): boolean {
  const g = globalThis as {
    AudioContext?: unknown
    webkitAudioContext?: unknown
  }
  return typeof g.AudioContext !== 'undefined' || typeof g.webkitAudioContext !== 'undefined'
}

/**
 * A no-op engine used when Web Audio is unavailable (SSR, tests, headless).
 * It keeps the UI fully functional — editing, persistence, MIDI — without sound.
 */
export class SilentAudioEngine implements AudioEngine {
  private _state: TransportState = 'stopped'
  private readonly listeners = new Set<(state: TransportState) => void>()
  // A state-only mixer (no audio graph): the panel stays fully interactive.
  private readonly _mixer: MixerController = createMixerController()

  get state(): TransportState {
    return this._state
  }

  get mixer(): MixerController {
    return this._mixer
  }

  private setState(state: TransportState): void {
    if (state === this._state) return
    this._state = state
    for (const listener of this.listeners) listener(state)
  }

  async play(): Promise<void> {
    this.setState('playing')
  }
  pause(): void {
    this.setState('paused')
  }
  stop(): void {
    this.setState('stopped')
  }
  setTempo(): void {}
  setLoop(): void {}
  setProject(project: Project): void {
    this._mixer.syncTracks(project.tracks.map((track) => ({ id: track.id, muted: track.muted })))
  }
  positionBeats(): number {
    return 0
  }
  previewNote(): void {}
  onStateChange(listener: (state: TransportState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  // No audio graph to rebuild — the silent engine is always "alive".
  ensureAlive(): void {}
  dispose(): void {
    this._mixer.dispose()
    this.listeners.clear()
  }
}
