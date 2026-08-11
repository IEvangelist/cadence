import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useMidiInput } from './useMidiInput'
import {
  type MidiAccessLike,
  type MidiInputLike,
  type MidiMessageLike,
} from '../midi/webMidi'

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

class FakeAccess implements MidiAccessLike {
  onstatechange: ((event: unknown) => void) | null = null
  private list: FakeInput[]
  constructor(list: FakeInput[]) {
    this.list = list
  }
  get inputs(): { forEach(cb: (input: MidiInputLike) => void): void } {
    const list = this.list
    return { forEach: (cb) => list.forEach((input) => cb(input)) }
  }
  connect(input: FakeInput): void {
    this.list.push(input)
    this.onstatechange?.({})
  }
  disconnect(id: string): void {
    this.list = this.list.filter((input) => input.id !== id)
    this.onstatechange?.({})
  }
}

describe('useMidiInput', () => {
  it('reports unsupported and stays dormant when Web MIDI is absent', () => {
    const { result } = renderHook(() => useMidiInput())
    expect(result.current.supported).toBe(false)
    expect(result.current.ready).toBe(false)
    expect(result.current.inputs).toEqual([])
  })

  it('enumerates inputs and auto-selects the first device', async () => {
    const access = new FakeAccess([new FakeInput('a', 'A'), new FakeInput('b', 'B')])
    const requestAccess = vi.fn().mockResolvedValue(access)
    const { result } = renderHook(() => useMidiInput({ requestAccess }))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.supported).toBe(true)
    expect(result.current.inputs).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ])
    expect(result.current.selectedInputId).toBe('a')
    expect(result.current.connected).toBe(true)
  })

  it('forwards note-on/off (incl. running status) from the selected input', async () => {
    const inputA = new FakeInput('a', 'A')
    const access = new FakeAccess([inputA])
    const requestAccess = vi.fn().mockResolvedValue(access)
    const onNoteOn = vi.fn()
    const onNoteOff = vi.fn()
    const onControlChange = vi.fn()
    renderHook(() => useMidiInput({ requestAccess, onNoteOn, onNoteOff, onControlChange }))

    await waitFor(() => expect(inputA.onmidimessage).toBeTypeOf('function'))

    act(() => inputA.send([0x90, 60, 100]))
    expect(onNoteOn).toHaveBeenCalledWith(60, 100)
    // Running status: a data-first message reuses the prior note-on status.
    act(() => inputA.send([62, 90]))
    expect(onNoteOn).toHaveBeenCalledWith(62, 90)

    act(() => inputA.send([0x80, 60, 0]))
    expect(onNoteOff).toHaveBeenCalledWith(60)

    act(() => inputA.send([0xb0, 7, 127]))
    expect(onControlChange).toHaveBeenCalledWith(7, 127)
  })

  it('re-subscribes when the user picks another device', async () => {
    const inputA = new FakeInput('a', 'A')
    const inputB = new FakeInput('b', 'B')
    const access = new FakeAccess([inputA, inputB])
    const requestAccess = vi.fn().mockResolvedValue(access)
    const onNoteOn = vi.fn()
    const { result } = renderHook(() => useMidiInput({ requestAccess, onNoteOn }))

    await waitFor(() => expect(inputA.onmidimessage).toBeTypeOf('function'))
    act(() => result.current.selectInput('b'))
    await waitFor(() => expect(inputB.onmidimessage).toBeTypeOf('function'))

    // The previous input is detached, the new one is live.
    expect(inputA.onmidimessage).toBeNull()
    act(() => inputB.send([0x90, 48, 80]))
    expect(onNoteOn).toHaveBeenCalledWith(48, 80)
  })

  it('follows hot-plug: reconnect enumerates, disconnect drops connectivity', async () => {
    const inputA = new FakeInput('a', 'A')
    const access = new FakeAccess([inputA])
    const requestAccess = vi.fn().mockResolvedValue(access)
    const { result } = renderHook(() => useMidiInput({ requestAccess }))

    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.connected).toBe(true)

    act(() => access.connect(new FakeInput('b', 'B')))
    await waitFor(() => expect(result.current.inputs).toHaveLength(2))
    // The user's original selection is preserved (no selection stealing).
    expect(result.current.selectedInputId).toBe('a')

    act(() => access.disconnect('a'))
    await waitFor(() => expect(result.current.connected).toBe(false))
  })

  it('does nothing when disabled', async () => {
    const requestAccess = vi.fn().mockResolvedValue(new FakeAccess([new FakeInput('a', 'A')]))
    const { result } = renderHook(() => useMidiInput({ requestAccess, enabled: false }))
    // Give any (suppressed) async acquire a chance to run.
    await Promise.resolve()
    expect(result.current.ready).toBe(false)
    expect(result.current.inputs).toEqual([])
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it('stays not-ready when access is denied', async () => {
    const requestAccess = vi.fn().mockResolvedValue(null)
    const { result } = renderHook(() => useMidiInput({ requestAccess }))
    await waitFor(() => expect(requestAccess).toHaveBeenCalled())
    expect(result.current.ready).toBe(false)
    expect(result.current.connected).toBe(false)
  })
})
