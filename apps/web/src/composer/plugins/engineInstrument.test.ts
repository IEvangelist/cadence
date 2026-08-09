import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject, createNote, createTrack } from '../model/project'

/** Minimal Tone mock: only the nodes the engine constructs in this test. */
const h = vi.hoisted(() => ({
  parts: [] as Array<{ callback: (t: number, e: unknown) => void; events: unknown[] }>,
  transport: {
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
  },
}))

vi.mock('tone', () => {
  class Gain {
    gain = { value: 0.9 }
    toDestination() {
      return this
    }
    connect() {
      return this
    }
    dispose = vi.fn()
  }
  class Part {
    loop = false
    loopStart: unknown = 0
    loopEnd: unknown = 0
    callback: (t: number, e: unknown) => void
    events: unknown[]
    constructor(callback: (t: number, e: unknown) => void, events: unknown[]) {
      this.callback = callback
      this.events = events
      h.parts.push(this)
    }
    start() {
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
    dispose() {}
  }
  return {
    Gain,
    Part,
    getTransport: () => h.transport,
    start: () => Promise.resolve(),
    now: () => 0,
  }
})

const { ToneAudioEngine } = await import('../audio/engine')
const { defaultPluginHost } = await import('./defaultHost')
const { listInstruments } = await import('../instruments/registry')

describe('a plugin-contributed instrument through the engine seam', () => {
  it('is selectable and sounds when scheduled', () => {
    const trigger = vi.fn()
    defaultPluginHost.use({
      manifest: { id: 'test.inst', name: 'Test Inst', version: '1.0.0' },
      contributes: {
        instruments: [
          {
            id: 'test-inst',
            name: 'Test Inst',
            kind: 'synth',
            description: 'A stub instrument for the seam test.',
            polyphonic: false,
            createVoice: () => ({ trigger, dispose: vi.fn() }),
          },
        ],
      },
    })

    // (a) selectable: it shows up in the instrument list the UI renders.
    expect(listInstruments().some((i) => i.id === 'test-inst')).toBe(true)

    // (b) sounds: the engine resolves the plugin voice and triggers it.
    const engine = new ToneAudioEngine()
    const project = createEmptyProject('p')
    project.tracks = [
      createTrack(
        {
          instrumentId: 'test-inst',
          notes: [createNote({ pitch: 60, start: 0, duration: 1, velocity: 0.5 }, 'n')],
        },
        't',
      ),
    ]
    engine.setProject(project)
    h.parts[0].callback(0, h.parts[0].events[0])
    expect(trigger).toHaveBeenCalledWith(60, expect.any(Number), 0, 0.5)
  })

  it('can override a built-in instrument id (last registration wins)', () => {
    const trigger = vi.fn()
    defaultPluginHost.use({
      manifest: { id: 'test.override', name: 'Override', version: '1.0.0' },
      contributes: {
        instruments: [
          {
            id: 'poly-synth',
            name: 'My Poly',
            kind: 'synth',
            description: 'Overrides the built-in poly synth.',
            polyphonic: true,
            createVoice: () => ({ trigger, dispose: vi.fn() }),
          },
        ],
      },
    })

    // The override replaces the built-in metadata under the same id.
    expect(listInstruments().find((i) => i.id === 'poly-synth')?.name).toBe('My Poly')

    const engine = new ToneAudioEngine()
    const project = createEmptyProject('p')
    project.tracks = [
      createTrack(
        {
          instrumentId: 'poly-synth',
          notes: [createNote({ pitch: 64, start: 0, duration: 1, velocity: 0.4 }, 'n')],
        },
        't',
      ),
    ]
    engine.setProject(project)
    const part = h.parts[h.parts.length - 1]
    part.callback(0, part.events[0])
    expect(trigger).toHaveBeenCalledWith(64, expect.any(Number), 0, 0.4)
  })
})
