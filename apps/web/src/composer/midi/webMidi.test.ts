import { describe, expect, it, vi } from 'vitest'
import {
  type MidiAccessLike,
  type MidiInputLike,
  findInput,
  isWebMidiSupported,
  listInputs,
  normalizeVelocity,
  parseMidiMessage,
  requestMidiAccess,
} from './webMidi'

describe('parseMidiMessage', () => {
  it('decodes a note-on with velocity and carries the status forward', () => {
    const result = parseMidiMessage([0x90, 60, 100])
    expect(result.event).toEqual({ type: 'noteon', note: 60, velocity: 100, channel: 0 })
    expect(result.runningStatus).toBe(0x90)
  })

  it('decodes a note-off with release velocity', () => {
    const result = parseMidiMessage([0x80, 60, 64])
    expect(result.event).toEqual({ type: 'noteoff', note: 60, velocity: 64, channel: 0 })
    expect(result.runningStatus).toBe(0x80)
  })

  it('treats a note-on at velocity 0 as a note-off', () => {
    const result = parseMidiMessage([0x90, 62, 0])
    expect(result.event).toEqual({ type: 'noteoff', note: 62, velocity: 0, channel: 0 })
    // Running status stays the note-on byte, as the wire byte was 0x90.
    expect(result.runningStatus).toBe(0x90)
  })

  it('reads the channel from the low status nibble', () => {
    expect(parseMidiMessage([0x92, 60, 100]).event).toMatchObject({ channel: 2 })
    expect(parseMidiMessage([0x85, 60, 0]).event).toMatchObject({ type: 'noteoff', channel: 5 })
  })

  it('resolves a data-first message using running status', () => {
    const first = parseMidiMessage([0x90, 60, 100])
    const second = parseMidiMessage([62, 90], first.runningStatus)
    expect(second.event).toEqual({ type: 'noteon', note: 62, velocity: 90, channel: 0 })
    expect(second.runningStatus).toBe(0x90)
  })

  it('decodes control-change messages', () => {
    const result = parseMidiMessage([0xb0, 7, 127])
    expect(result.event).toEqual({ type: 'cc', controller: 7, value: 127, channel: 0 })
  })

  it('ignores system messages and clears running status', () => {
    const result = parseMidiMessage([0xf8], 0x90)
    expect(result.event).toBeNull()
    expect(result.runningStatus).toBeNull()
  })

  it('passes running status through an empty / missing message', () => {
    expect(parseMidiMessage([], 0x90)).toEqual({ event: null, runningStatus: 0x90 })
    expect(parseMidiMessage(null, 0x80)).toEqual({ event: null, runningStatus: 0x80 })
    expect(parseMidiMessage(undefined)).toEqual({ event: null, runningStatus: null })
  })

  it('ignores a stray data byte with no running status to attach it to', () => {
    expect(parseMidiMessage([60, 100])).toEqual({ event: null, runningStatus: null })
  })

  it('keeps an unrouted channel-voice status as running status', () => {
    // Pitch bend (0xE0) is a recognized channel-voice message we do not route,
    // but a following data-first message must still resolve against it.
    const bend = parseMidiMessage([0xe0, 0, 64])
    expect(bend.event).toBeNull()
    expect(bend.runningStatus).toBe(0xe0)
  })
})

describe('normalizeVelocity', () => {
  it('maps 0..127 onto 0..1 and clamps out-of-range input', () => {
    expect(normalizeVelocity(0)).toBe(0)
    expect(normalizeVelocity(127)).toBe(1)
    expect(normalizeVelocity(64)).toBeCloseTo(0.5039, 3)
    expect(normalizeVelocity(200)).toBe(1)
    expect(normalizeVelocity(-5)).toBe(0)
  })
})

describe('isWebMidiSupported', () => {
  it('is true only when the navigator exposes requestMIDIAccess', () => {
    const withMidi = { requestMIDIAccess: () => Promise.resolve({}) } as unknown as Navigator
    expect(isWebMidiSupported(withMidi)).toBe(true)
    expect(isWebMidiSupported({} as Navigator)).toBe(false)
  })

  it('is false under jsdom (no Web MIDI on the global navigator)', () => {
    expect(isWebMidiSupported()).toBe(false)
  })
})

describe('requestMidiAccess', () => {
  it('resolves null when Web MIDI is unsupported', async () => {
    await expect(requestMidiAccess({ navigator: {} as Navigator })).resolves.toBeNull()
  })

  it('returns the granted access and defaults sysex off', async () => {
    const access = { inputs: { forEach: () => {} }, onstatechange: null }
    const requestMIDIAccess = vi.fn().mockResolvedValue(access)
    const navigator = { requestMIDIAccess } as unknown as Navigator
    const result = await requestMidiAccess({ navigator })
    expect(result).toBe(access)
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: false })
  })

  it('forwards an explicit sysex request', async () => {
    const requestMIDIAccess = vi.fn().mockResolvedValue({ inputs: { forEach: () => {} } })
    const navigator = { requestMIDIAccess } as unknown as Navigator
    await requestMidiAccess({ navigator, sysex: true })
    expect(requestMIDIAccess).toHaveBeenCalledWith({ sysex: true })
  })

  it('never throws — a denied/failed request resolves null', async () => {
    const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('denied'))
    const navigator = { requestMIDIAccess } as unknown as Navigator
    await expect(requestMidiAccess({ navigator })).resolves.toBeNull()
  })
})

function accessFromInputs(inputs: MidiInputLike[]): MidiAccessLike {
  return {
    inputs: { forEach: (cb) => inputs.forEach((input) => cb(input)) },
    onstatechange: null,
  }
}

describe('listInputs', () => {
  it('describes each input and falls back for blank names', () => {
    const access = accessFromInputs([
      { id: 'a', name: 'Keystation', onmidimessage: null },
      { id: 'b', name: '   ', onmidimessage: null },
      { id: 'c', name: null, onmidimessage: null },
    ])
    expect(listInputs(access)).toEqual([
      { id: 'a', name: 'Keystation' },
      { id: 'b', name: 'MIDI input' },
      { id: 'c', name: 'MIDI input' },
    ])
  })
})

describe('findInput', () => {
  it('returns the matching port or null', () => {
    const a: MidiInputLike = { id: 'a', name: 'A', onmidimessage: null }
    const b: MidiInputLike = { id: 'b', name: 'B', onmidimessage: null }
    const access = accessFromInputs([a, b])
    expect(findInput(access, 'b')).toBe(b)
    expect(findInput(access, 'missing')).toBeNull()
  })
})
