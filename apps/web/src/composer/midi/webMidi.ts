/**
 * Web MIDI live-input integration — pure and DOM-thin so the message parser and
 * access helpers are unit-testable without a real device (or even a browser).
 *
 * This module owns the *hardware* side of #111: feature-detecting the Web MIDI
 * API, requesting access, enumerating inputs, and decoding raw `MIDIMessageEvent`
 * bytes into note/CC events. The React adapter ({@link useMidiInput}) and the
 * record→notes timing math ({@link recordedNoteFrom}) live in sibling modules so
 * this file stays free of framework and project-model concerns.
 *
 * It deliberately never touches the audio engine: live monitoring and recording
 * are wired by the composer controller through the EXISTING preview/reducer seams
 * (#97-safe), not from here.
 */

/** MIDI status nibbles (high nibble of the status byte) we decode. */
const NOTE_OFF = 0x80
const NOTE_ON = 0x90
const CONTROL_CHANGE = 0xb0
/** System messages (0xF0–0xFF) never carry a channel and cancel running status. */
const SYSTEM = 0xf0

/** A decoded MIDI channel-voice message. Velocity/values stay raw (0–127). */
export type MidiEvent =
  | { type: 'noteon'; note: number; velocity: number; channel: number }
  | { type: 'noteoff'; note: number; velocity: number; channel: number }
  | { type: 'cc'; controller: number; value: number; channel: number }

/** Result of decoding one message, carrying the status byte forward. */
export interface MidiParseResult {
  /** The decoded event, or `null` for messages we don't route (system, etc.). */
  event: MidiEvent | null
  /**
   * Status byte to reuse for the next message when it arrives header-less
   * (MIDI "running status"), or `null` once a system message has cleared it.
   */
  runningStatus: number | null
}

/**
 * Decode a single MIDI message.
 *
 * Handles the three shapes the parser is required to cover:
 *  - note-on `0x9n` / note-off `0x8n` with velocity,
 *  - note-on with velocity 0 (treated as a note-off, as devices commonly send),
 *  - "running status", where a data-first message reuses the previous status
 *    byte (pass the prior result's `runningStatus`).
 *
 * Anything else (system messages, unsupported commands) decodes to a `null`
 * event; system messages additionally clear the running status.
 */
export function parseMidiMessage(
  data: ArrayLike<number> | null | undefined,
  runningStatus: number | null = null,
): MidiParseResult {
  if (!data || data.length === 0) return { event: null, runningStatus }

  const first = data[0]
  let status: number
  let offset: number

  if (first >= 0x80) {
    // A real status byte leads the message.
    if (first >= SYSTEM) {
      // System common/real-time: no channel, and it cancels running status.
      return { event: null, runningStatus: null }
    }
    status = first
    offset = 1
  } else if (runningStatus !== null) {
    // Data-first byte: reuse the previous channel-voice status (running status).
    status = runningStatus
    offset = 0
  } else {
    // A stray data byte with no status to attach it to — ignore.
    return { event: null, runningStatus }
  }

  const command = status & 0xf0
  const channel = status & 0x0f
  const data1 = data[offset] ?? 0
  const data2 = data[offset + 1] ?? 0

  switch (command) {
    case NOTE_ON:
      // A note-on at velocity 0 is the idiomatic "note-off" many controllers send.
      return {
        event:
          data2 === 0
            ? { type: 'noteoff', note: data1, velocity: 0, channel }
            : { type: 'noteon', note: data1, velocity: data2, channel },
        runningStatus: status,
      }
    case NOTE_OFF:
      return {
        event: { type: 'noteoff', note: data1, velocity: data2, channel },
        runningStatus: status,
      }
    case CONTROL_CHANGE:
      return {
        event: { type: 'cc', controller: data1, value: data2, channel },
        runningStatus: status,
      }
    default:
      // Recognized channel-voice status (e.g. pitch bend) we don't route; keep it
      // as the running status so a following data-first message still resolves.
      return { event: null, runningStatus: status }
  }
}

/** Normalize a raw MIDI velocity (0–127) to the model's 0–1 range. */
export function normalizeVelocity(raw: number): number {
  return Math.min(1, Math.max(0, raw / 127))
}

// ---------------------------------------------------------------------------
// Access layer
// ---------------------------------------------------------------------------

/** Minimal structural view of a `MIDIMessageEvent` (just the bytes we read). */
export interface MidiMessageLike {
  readonly data: Uint8Array | null
}

/** Minimal structural view of a `MIDIInput` port we subscribe to. */
export interface MidiInputLike {
  readonly id: string
  readonly name?: string | null
  readonly manufacturer?: string | null
  onmidimessage: ((event: MidiMessageLike) => void) | null
}

/** Minimal structural view of `MIDIAccess` (a real one is assignable to this). */
export interface MidiAccessLike {
  readonly inputs: { forEach(callback: (input: MidiInputLike) => void): void }
  onstatechange: ((event: unknown) => void) | null
}

/** UI-facing description of an available input device. */
export interface MidiInputInfo {
  id: string
  name: string
}

/** Options for {@link requestMidiAccess}. */
export interface RequestMidiAccessOptions {
  /** Request System Exclusive access. Off by default — we never need sysex. */
  sysex?: boolean
  /** Injectable navigator for tests / non-DOM environments. */
  navigator?: Navigator
}

type NavigatorLike = Navigator | undefined

function resolveNavigator(override?: Navigator): NavigatorLike {
  return override ?? (globalThis.navigator as NavigatorLike)
}

/**
 * True when the runtime exposes the Web MIDI API. Web MIDI is Chromium-only
 * (Firefox/Safari lack it), and it's absent under SSR/jsdom, so every entry point
 * feature-detects through here before touching `requestMIDIAccess`.
 */
export function isWebMidiSupported(navigatorOverride?: Navigator): boolean {
  const nav = resolveNavigator(navigatorOverride)
  return typeof nav?.requestMIDIAccess === 'function'
}

/**
 * Request MIDI access, or resolve `null` when Web MIDI is unsupported or the user
 * denies permission. Never throws, so callers can await it unconditionally and
 * app load is never blocked on MIDI.
 *
 * The concrete DOM `MIDIAccess` is adapted to {@link MidiAccessLike} at this one
 * boundary (a single cast), which keeps the rest of the module — and its tests —
 * free of DOM event types.
 */
export async function requestMidiAccess(
  options: RequestMidiAccessOptions = {},
): Promise<MidiAccessLike | null> {
  const nav = resolveNavigator(options.navigator)
  if (typeof nav?.requestMIDIAccess !== 'function') return null
  try {
    const access = await nav.requestMIDIAccess({ sysex: options.sysex ?? false })
    return access as unknown as MidiAccessLike
  } catch {
    return null
  }
}

/** Enumerate an access object's input ports into UI-facing descriptions. */
export function listInputs(access: MidiAccessLike): MidiInputInfo[] {
  const inputs: MidiInputInfo[] = []
  access.inputs.forEach((input) => {
    inputs.push({ id: input.id, name: input.name?.trim() || 'MIDI input' })
  })
  return inputs
}

/** Look up a live input port by id (for subscribing to its messages). */
export function findInput(access: MidiAccessLike, id: string): MidiInputLike | null {
  let found: MidiInputLike | null = null
  access.inputs.forEach((input) => {
    if (input.id === id) found = input
  })
  return found
}
