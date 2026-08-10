import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyProject,
  createNote,
  createTrack,
  type Project,
} from '../model/project'

/** Shared spies/state the mocked `tone` module writes to. */
const h = vi.hoisted(() => {
  const transport = {
    bpm: { value: 120 },
    loop: false,
    loopStart: 0 as unknown,
    loopEnd: 0 as unknown,
    seconds: 0,
    position: 0 as unknown,
    start: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }
  return {
    transport,
    trigger: vi.fn(),
    partStart: vi.fn(),
    partDispose: vi.fn(),
    voiceDispose: vi.fn(),
    synthCreate: vi.fn(),
    startAudio: vi.fn(() => Promise.resolve()),
    parts: [] as Array<{ callback: (time: number, event: unknown) => void; events: unknown[] }>,
  }
})

vi.mock('tone', () => {
  class Gain {
    gain = { value: 0.9 }
    toDestination() {
      return this
    }
    connect() {
      return this
    }
    disconnect() {
      return this
    }
    dispose = vi.fn()
  }
  class Panner {
    pan = { value: 0 }
    connect() {
      return this
    }
    disconnect() {
      return this
    }
    dispose = vi.fn()
  }
  class Limiter {
    threshold = { value: 0 }
    connect() {
      return this
    }
    disconnect() {
      return this
    }
    dispose = vi.fn()
  }
  class PolySynth {
    volume = { value: 0 }
    voice: unknown
    constructor(voice?: unknown) {
      this.voice = voice
      h.synthCreate('poly')
    }
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.trigger('poly', ...args)
    }
    dispose() {
      h.voiceDispose()
    }
  }
  class Synth {}
  class FMSynth {}
  class MembraneSynth {
    constructor() {
      h.synthCreate('kick')
    }
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.trigger('kick', ...args)
    }
    dispose() {
      h.voiceDispose()
    }
  }
  class NoiseSynth {
    constructor() {
      h.synthCreate('noise')
    }
    connect() {
      return this
    }
    triggerAttackRelease(...args: unknown[]) {
      h.trigger('noise', ...args)
    }
    dispose() {
      h.voiceDispose()
    }
  }
  class Part {
    loop = false
    loopStart: unknown = 0
    loopEnd: unknown = 0
    callback: (time: number, event: unknown) => void
    events: unknown[]
    constructor(callback: (time: number, event: unknown) => void, events: unknown[]) {
      this.callback = callback
      this.events = events
      h.parts.push(this)
    }
    start(...args: unknown[]) {
      h.partStart(...args)
      return this
    }
    clear() {
      this.events = []
      return this
    }
    add(_time: unknown, value: unknown) {
      this.events.push(value)
      return this
    }
    dispose() {
      h.partDispose()
    }
  }
  return {
    Gain,
    Panner,
    Limiter,
    PolySynth,
    Synth,
    FMSynth,
    MembraneSynth,
    NoiseSynth,
    Part,
    getTransport: () => h.transport,
    getDestination: () => ({}),
    start: h.startAudio,
    now: () => 0,
  }
})

// Imported after the mock is registered.
const { ToneAudioEngine, createAudioEngine, SilentAudioEngine, isAudioSupported } =
  await import('./engine')

function projectWithTracks(): Project {
  const project = createEmptyProject('p')
  project.tempo = 100
  project.tracks = [
    createTrack(
      {
        name: 'Synth',
        instrumentId: 'poly-synth',
        notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.7 }, 'n1')],
      },
      'ts',
    ),
    createTrack(
      {
        name: 'FM',
        instrumentId: 'fm-synth',
        notes: [createNote({ pitch: 64, start: 1, duration: 1 }, 'n2')],
      },
      'tf',
    ),
    createTrack(
      {
        name: 'Drums',
        instrumentId: 'drum-kit',
        notes: [
          createNote({ pitch: 36, start: 0, duration: 0.5, velocity: 0.9 }, 'k'),
          createNote({ pitch: 38, start: 1, duration: 0.5, velocity: 0.8 }, 's'),
        ],
      },
      'td',
    ),
    createTrack(
      { name: 'Muted', instrumentId: 'poly-synth', notes: [createNote({ pitch: 72, start: 0 }, 'm')], muted: true },
      'tm',
    ),
    createTrack({ name: 'Empty', instrumentId: 'poly-synth', notes: [] }, 'te'),
  ]
  return project
}

beforeEach(() => {
  vi.clearAllMocks()
  h.parts.length = 0
  h.transport.loop = false
  h.transport.seconds = 0
  h.transport.bpm.value = 120
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToneAudioEngine transport', () => {
  it('starts the audio context and transport on play', async () => {
    const engine = new ToneAudioEngine()
    const states: string[] = []
    engine.onStateChange((s) => states.push(s))
    await engine.play()
    expect(h.startAudio).toHaveBeenCalled()
    expect(h.transport.start).toHaveBeenCalled()
    expect(engine.state).toBe('playing')
    expect(states).toContain('playing')
  })

  it('pauses and stops, resetting position', async () => {
    const engine = new ToneAudioEngine()
    await engine.play()
    engine.pause()
    expect(engine.state).toBe('paused')
    engine.stop()
    expect(h.transport.stop).toHaveBeenCalled()
    expect(h.transport.position).toBe(0)
    expect(engine.state).toBe('stopped')
  })

  it('does not notify listeners when the state is unchanged', () => {
    const engine = new ToneAudioEngine()
    const listener = vi.fn()
    engine.onStateChange(listener)
    engine.stop() // already stopped
    expect(listener).not.toHaveBeenCalled()
  })

  it('supports unsubscribing from state changes', async () => {
    const engine = new ToneAudioEngine()
    const listener = vi.fn()
    const off = engine.onStateChange(listener)
    off()
    await engine.play()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('ToneAudioEngine tempo + loop', () => {
  it('sets tempo on the transport', () => {
    const engine = new ToneAudioEngine()
    engine.setTempo(140)
    expect(h.transport.bpm.value).toBe(140)
  })

  it('enables and configures looping on the transport', () => {
    const engine = new ToneAudioEngine()
    engine.setLoop({ enabled: true, start: 0, end: 8 })
    expect(h.transport.loop).toBe(true)
    expect(h.transport.loopStart).toBe('0:0:0')
    expect(h.transport.loopEnd).toBe('2:0:0')
  })

  it('disables looping', () => {
    const engine = new ToneAudioEngine()
    engine.setLoop({ enabled: false, start: 0, end: 8 })
    expect(h.transport.loop).toBe(false)
  })
})

describe('ToneAudioEngine scheduling', () => {
  it('builds a part per audible track and skips muted/empty tracks', () => {
    const engine = new ToneAudioEngine()
    engine.setProject(projectWithTracks())
    // synth + fm + drums = 3 parts; muted and empty tracks contribute none.
    expect(h.parts).toHaveLength(3)
    expect(h.partStart).toHaveBeenCalledTimes(3)
    expect(h.transport.bpm.value).toBe(100)
  })

  it('routes scheduled events to the right voice', () => {
    const engine = new ToneAudioEngine()
    engine.setProject(projectWithTracks())

    // Fire each part's first event through its callback.
    for (const part of h.parts) {
      part.callback(0, part.events[0])
    }
    const kinds = h.trigger.mock.calls.map((c) => c[0])
    expect(kinds).toContain('poly') // synth / fm
    expect(kinds).toContain('kick') // drum pitch 36
  })

  it('routes non-kick drum pitches to the noise voice', () => {
    const engine = new ToneAudioEngine()
    engine.setProject(projectWithTracks())
    const drumPart = h.parts[2]
    drumPart.callback(0, drumPart.events[1]) // pitch 38 snare
    expect(h.trigger.mock.calls.some((c) => c[0] === 'noise')).toBe(true)
  })

  it('rebuilds parts on a subsequent setProject, disposing the old ones', () => {
    const engine = new ToneAudioEngine()
    engine.setProject(projectWithTracks())
    h.partDispose.mockClear()
    engine.setProject(createEmptyProject('p2'))
    expect(h.partDispose).toHaveBeenCalled()
  })

  it('reuses instruments across note edits and only rebuilds on instrument change', () => {
    const engine = new ToneAudioEngine()
    const base = createEmptyProject('p')
    base.tracks = [createTrack({ instrumentId: 'poly-synth', notes: [] }, 't1')]
    engine.setProject(base)

    // From here, only note data changes: add, move, then resize the same note.
    h.synthCreate.mockClear()
    h.voiceDispose.mockClear()

    const withNote = {
      ...base,
      tracks: [{ ...base.tracks[0], notes: [createNote({ pitch: 60, start: 0, duration: 1 }, 'n1')] }],
    }
    engine.setProject(withNote)
    const moved = {
      ...withNote,
      tracks: [{ ...withNote.tracks[0], notes: [createNote({ pitch: 62, start: 1, duration: 1 }, 'n1')] }],
    }
    engine.setProject(moved)
    const resized = {
      ...moved,
      tracks: [{ ...moved.tracks[0], notes: [createNote({ pitch: 62, start: 1, duration: 2 }, 'n1')] }],
    }
    engine.setProject(resized)

    // Note edits must NOT reallocate or dispose the instrument graph.
    expect(h.synthCreate).not.toHaveBeenCalled()
    expect(h.voiceDispose).not.toHaveBeenCalled()

    // Changing the track's instrument DOES rebuild the voice.
    const changed = {
      ...resized,
      tracks: [{ ...resized.tracks[0], instrumentId: 'drum-kit' as const }],
    }
    engine.setProject(changed)
    expect(h.synthCreate).toHaveBeenCalled()
    expect(h.voiceDispose).toHaveBeenCalled()
  })
})

describe('ToneAudioEngine position', () => {
  it('reports linear position in beats', () => {
    const engine = new ToneAudioEngine()
    engine.setTempo(120)
    h.transport.seconds = 1 // 1s at 120bpm = 2 beats
    expect(engine.positionBeats()).toBe(2)
  })

  it('wraps position within an active loop', () => {
    const engine = new ToneAudioEngine()
    engine.setTempo(120)
    engine.setLoop({ enabled: true, start: 4, end: 8 })
    h.transport.seconds = 5 // 10 beats -> 4 + ((10-4)%4) = 6
    expect(engine.positionBeats()).toBe(6)
  })

  it('does not wrap before the loop start', () => {
    const engine = new ToneAudioEngine()
    engine.setTempo(120)
    engine.setLoop({ enabled: true, start: 4, end: 8 })
    h.transport.seconds = 1 // 2 beats, before loop start
    expect(engine.positionBeats()).toBe(2)
  })
})

describe('ToneAudioEngine preview + dispose', () => {
  it('auditions a note and disposes the one-shot voice later', () => {
    vi.useFakeTimers()
    const engine = new ToneAudioEngine()
    const track = createTrack({ instrumentId: 'poly-synth' }, 't')
    engine.previewNote(track, 60)
    expect(h.trigger).toHaveBeenCalledWith('poly', 'C4', expect.any(Number), 0, 0.9)
    h.voiceDispose.mockClear()
    vi.runAllTimers()
    expect(h.voiceDispose).toHaveBeenCalled()
  })

  it('resumes the audio context before auditioning a preview', () => {
    const engine = new ToneAudioEngine()
    const track = createTrack({ instrumentId: 'poly-synth' }, 't')
    engine.previewNote(track, 60)
    // Previews come from a user gesture; the context must resume so first-run
    // previews are audible without pressing play first.
    expect(h.startAudio).toHaveBeenCalled()
  })

  it('tears everything down on dispose', () => {
    const engine = new ToneAudioEngine()
    engine.setProject(projectWithTracks())
    engine.dispose()
    expect(h.transport.stop).toHaveBeenCalled()
    expect(h.transport.cancel).toHaveBeenCalled()
    expect(h.partDispose).toHaveBeenCalled()
  })
})

describe('createAudioEngine', () => {
  it('returns a working engine instance', () => {
    const engine = createAudioEngine()
    expect(typeof engine.play).toBe('function')
    expect(engine.state).toBe('stopped')
  })

  it('falls back to a silent engine when Web Audio is unavailable', () => {
    // jsdom does not implement AudioContext, so the factory picks the silent engine.
    expect(isAudioSupported()).toBe(false)
    const engine = createAudioEngine()
    expect(engine).toBeInstanceOf(SilentAudioEngine)
  })

  it('reports audio support when AudioContext exists', () => {
    vi.stubGlobal('AudioContext', class {})
    expect(isAudioSupported()).toBe(true)
    vi.unstubAllGlobals()
  })
})

describe('SilentAudioEngine', () => {
  it('is a no-op that still tracks transport state', async () => {
    const engine = new SilentAudioEngine()
    const states: string[] = []
    const off = engine.onStateChange((s) => states.push(s))
    await engine.play()
    engine.pause()
    engine.stop()
    // no-op methods should not throw
    engine.setTempo()
    engine.setLoop()
    engine.setProject(createEmptyProject('s'))
    engine.previewNote()
    expect(engine.positionBeats()).toBe(0)
    expect(states).toEqual(['playing', 'paused', 'stopped'])
    off()
    engine.dispose()
  })
})
