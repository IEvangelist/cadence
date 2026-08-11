import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useComposer } from './useComposer'
import { type AudioEngine, type TransportState } from '../audio/engine'
import { createMixerController, type MixerController } from '../audio/mixerController'
import { LocalStorageProjectStore, MemoryStorage } from '../model/storage'
import { createEmptyProject, type Track } from '../model/project'
import {
  type MidiAccessLike,
  type MidiInputLike,
  type MidiMessageLike,
} from '../midi/webMidi'

class RecordEngine implements AudioEngine {
  state: TransportState = 'stopped'
  pos = 0
  preview: Array<{ pitch: number; duration: number; velocity: number }> = []
  readonly mixer: MixerController = createMixerController()
  private listeners = new Set<(s: TransportState) => void>()
  private emit(): void {
    for (const listener of this.listeners) listener(this.state)
  }
  async play(): Promise<void> {
    this.state = 'playing'
    this.emit()
  }
  pause(): void {
    this.state = 'paused'
    this.emit()
  }
  stop(): void {
    this.state = 'stopped'
    this.emit()
  }
  setTempo(): void {}
  setLoop(): void {}
  setProject(): void {}
  positionBeats(): number {
    return this.pos
  }
  previewNote(_track: Track, pitch: number, durationBeats = 0.5, velocity = 0.9): void {
    this.preview.push({ pitch, duration: durationBeats, velocity })
  }
  onStateChange(listener: (s: TransportState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  ensureAlive(): void {}
  dispose(): void {}
}

class FakeInput implements MidiInputLike {
  onmidimessage: ((event: MidiMessageLike) => void) | null = null
  id: string
  name: string
  constructor(id: string, name: string) {
    this.id = id
    this.name = name
  }
  send(bytes: number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

function fakeAccess(input: FakeInput): MidiAccessLike {
  return {
    inputs: { forEach: (cb) => cb(input) },
    onstatechange: null,
  }
}

function setup() {
  const engine = new RecordEngine()
  const input = new FakeInput('kbd', 'Test Keyboard')
  const requestMidiAccess = vi.fn().mockResolvedValue(fakeAccess(input))
  const hook = renderHook(() =>
    useComposer({
      createEngine: () => engine,
      store: new LocalStorageProjectStore(new MemoryStorage()),
      initialProject: createEmptyProject('p'),
      autosaveDelay: 0,
      requestMidiAccess,
    }),
  )
  return { engine, input, hook }
}

const firstTrackNotes = (hook: ReturnType<typeof setup>['hook']) =>
  hook.result.current.project.tracks[0].notes

describe('useComposer — live MIDI record path (#111)', () => {
  it('monitors every note-on through engine.previewNote with the incoming velocity', async () => {
    const { engine, input } = setup()
    await waitFor(() => expect(input.onmidimessage).toBeTypeOf('function'))

    act(() => input.send([0x90, 64, 127]))
    expect(engine.preview.at(-1)).toEqual({ pitch: 64, duration: 0.5, velocity: 1 })
  })

  it('records a played note into the selected track at transport-relative beats', async () => {
    const { engine, input, hook } = setup()
    await waitFor(() => expect(input.onmidimessage).toBeTypeOf('function'))

    act(() => hook.result.current.midi.toggleArmed())
    await act(async () => {
      await hook.result.current.play()
    })

    engine.pos = 2
    act(() => input.send([0x90, 60, 100]))
    engine.pos = 4
    act(() => input.send([0x80, 60, 0]))

    const notes = firstTrackNotes(hook)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ pitch: 60, start: 2, duration: 2 })
    expect(notes[0].velocity).toBeCloseTo(100 / 127, 3)
  })

  it('monitors but does not record when not armed', async () => {
    const { engine, input, hook } = setup()
    await waitFor(() => expect(input.onmidimessage).toBeTypeOf('function'))

    await act(async () => {
      await hook.result.current.play()
    })
    engine.pos = 1
    act(() => input.send([0x90, 60, 100]))
    act(() => input.send([0x80, 60, 0]))

    expect(firstTrackNotes(hook)).toHaveLength(0)
    expect(engine.preview).toHaveLength(1)
  })

  it('does not record when armed but the transport is stopped', async () => {
    const { engine, input, hook } = setup()
    await waitFor(() => expect(input.onmidimessage).toBeTypeOf('function'))

    act(() => hook.result.current.midi.toggleArmed())
    engine.pos = 1
    act(() => input.send([0x90, 60, 100]))
    act(() => input.send([0x80, 60, 0]))

    expect(firstTrackNotes(hook)).toHaveLength(0)
  })

  it('snaps the recorded start to the grid only when quantize is opted in', async () => {
    const { engine, input, hook } = setup()
    await waitFor(() => expect(input.onmidimessage).toBeTypeOf('function'))

    act(() => hook.result.current.setSnap(1))
    act(() => hook.result.current.midi.setQuantize(true))
    act(() => hook.result.current.midi.toggleArmed())
    await act(async () => {
      await hook.result.current.play()
    })

    engine.pos = 2.4
    act(() => input.send([0x90, 55, 90]))
    engine.pos = 4
    act(() => input.send([0x80, 55, 0]))

    const notes = firstTrackNotes(hook)
    expect(notes).toHaveLength(1)
    expect(notes[0].start).toBe(2)
  })
})
