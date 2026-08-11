/**
 * Record-path timing math: turn a captured MIDI note (a note-on paired with its
 * note-off, timed against the transport) into a project note.
 *
 * Kept pure and free of React/audio so the transport-relative timing — including
 * the optional, opt-in quantize and the loop-wrap guard — is trivially
 * unit-testable. The composer controller feeds the results straight into the
 * existing `insert-notes` reducer action, so undo/serialize/collab are unchanged.
 */
import { MIN_NOTE_DURATION } from '../model/reducer'
import { snap } from '../timing/timing'
import { normalizeVelocity } from './webMidi'

/** A note-on held open, awaiting its note-off. Times are transport beats. */
export interface MidiCapture {
  /** Track the note-on landed on (selection can change before the note-off). */
  trackId: string
  pitch: number
  /** Transport position (beats) at note-on. */
  startBeat: number
  /** Raw MIDI velocity (0–127) from the note-on. */
  velocity: number
}

/** Opt-in quantize for the record path. Off by default — feel is preserved. */
export interface RecordQuantize {
  enabled: boolean
  /** Grid in beats (reuses the transport snap value, e.g. 0.25 = 1/16). */
  grid: number
}

/** A note ready for the `insert-notes` reducer path (velocity normalized 0–1). */
export interface RecordedNote {
  pitch: number
  start: number
  duration: number
  velocity: number
}

/**
 * Build a project note from a capture and the transport beat at note-off.
 *
 * - `start` is the capture's transport-relative beat, snapped to the grid only
 *   when the user has opted into quantize.
 * - `duration` is the played length (end − start), floored to
 *   {@link MIN_NOTE_DURATION}. If the transport looped between on and off (so the
 *   end wrapped behind the start), we fall back to the minimum length rather than
 *   inventing a negative/gigantic note.
 * - `velocity` is the note-on velocity normalized to 0–1.
 */
export function recordedNoteFrom(
  capture: MidiCapture,
  endBeat: number,
  quantize: RecordQuantize = { enabled: false, grid: 0.25 },
): RecordedNote {
  const rawStart = Math.max(0, capture.startBeat)
  const start = quantize.enabled ? snap(rawStart, quantize.grid) : rawStart
  const playedLength = endBeat - rawStart
  const duration =
    playedLength > MIN_NOTE_DURATION ? playedLength : MIN_NOTE_DURATION
  return {
    pitch: capture.pitch,
    start,
    duration,
    velocity: normalizeVelocity(capture.velocity),
  }
}
