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
  type LoopRegion,
  type Note,
  type Project,
  type Track,
  pitchToName,
} from '../model/project'
import { getInstrument } from '../instruments/registry'
import {
  beatsToBarsBeatsSixteenths,
  beatsToSeconds,
  secondsToBeats,
} from '../timing/timing'

export type TransportState = 'stopped' | 'playing' | 'paused'

export interface AudioEngine {
  readonly state: TransportState
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
  dispose(): void
}

/** A playable voice for one track. Times are absolute audio-context seconds. */
interface Voice {
  trigger(pitch: number, durationSeconds: number, time: number, velocity: number): void
  dispose(): void
}

type ToneOutput = Tone.Gain

function createSynthVoice(track: Track, output: ToneOutput): Voice {
  // Each branch constructs a concrete voice so Tone can infer the correct
  // PolySynth type (FMSynth is not a Synth subclass, so a union would not type).
  const synth =
    track.instrumentId === 'fm-synth'
      ? new Tone.PolySynth(Tone.FMSynth).connect(output)
      : new Tone.PolySynth(Tone.Synth).connect(output)
  synth.volume.value = -8
  return {
    trigger: (pitch, duration, time, velocity) => {
      synth.triggerAttackRelease(pitchToName(pitch), duration, time, velocity)
    },
    dispose: () => synth.dispose(),
  }
}

function createDrumVoice(output: ToneOutput): Voice {
  const kick = new Tone.MembraneSynth().connect(output)
  const noise = new Tone.NoiseSynth().connect(output)
  return {
    trigger: (pitch, duration, time, velocity) => {
      if (pitch <= 36) {
        kick.triggerAttackRelease('C1', duration, time, velocity)
      } else {
        // snares, claps, and hats all use the noise voice in the MVP kit.
        noise.triggerAttackRelease(duration, time, velocity)
      }
    },
    dispose: () => {
      kick.dispose()
      noise.dispose()
    },
  }
}

function createVoice(track: Track, output: ToneOutput): Voice {
  const def = getInstrument(track.instrumentId)
  if (def.kind === 'drum') return createDrumVoice(output)
  return createSynthVoice(track, output)
}

interface ScheduledEvent {
  time: string
  note: Note
}

export class ToneAudioEngine implements AudioEngine {
  private readonly master: ToneOutput
  private voices: Voice[] = []
  private parts: Tone.Part<ScheduledEvent>[] = []
  private tempo = 120
  private loop: LoopRegion = { enabled: false, start: 0, end: 16 }
  private _state: TransportState = 'stopped'
  private readonly listeners = new Set<(state: TransportState) => void>()

  constructor() {
    this.master = new Tone.Gain(0.9).toDestination()
    Tone.getTransport().bpm.value = this.tempo
  }

  get state(): TransportState {
    return this._state
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
    for (const part of this.parts) {
      part.loop = loop.enabled
      if (loop.enabled) {
        part.loopStart = beatsToBarsBeatsSixteenths(loop.start)
        part.loopEnd = beatsToBarsBeatsSixteenths(loop.end)
      }
    }
  }

  setProject(project: Project): void {
    this.disposeVoicesAndParts()
    this.setTempo(project.tempo)

    project.tracks.forEach((track) => {
      const voice = createVoice(track, this.master)
      this.voices.push(voice)
      if (track.muted || track.notes.length === 0) return

      const events: ScheduledEvent[] = track.notes.map((note) => ({
        time: beatsToBarsBeatsSixteenths(note.start),
        note,
      }))
      const part = new Tone.Part<ScheduledEvent>((time, event) => {
        const duration = beatsToSeconds(event.note.duration, this.tempo)
        voice.trigger(event.note.pitch, duration, time, event.note.velocity)
      }, events)
      part.start(0)
      this.parts.push(part)
    })

    this.setLoop(project.loop)
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
    const voice = createVoice(track, this.master)
    const duration = beatsToSeconds(durationBeats, this.tempo)
    voice.trigger(pitch, duration, Tone.now(), 0.9)
    // Free the one-shot preview voice after it has rung out.
    setTimeout(() => voice.dispose(), (duration + 0.5) * 1000)
  }

  private disposeVoicesAndParts(): void {
    for (const part of this.parts) part.dispose()
    for (const voice of this.voices) voice.dispose()
    this.parts = []
    this.voices = []
  }

  dispose(): void {
    this.stop()
    Tone.getTransport().cancel()
    this.disposeVoicesAndParts()
    this.master.dispose()
    this.listeners.clear()
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

  get state(): TransportState {
    return this._state
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
  setProject(): void {}
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
  dispose(): void {
    this.listeners.clear()
  }
}
