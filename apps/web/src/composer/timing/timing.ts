/**
 * Pure timing + geometry helpers shared by the audio engine and the piano roll.
 *
 * "Beats" are quarter notes. Horizontal position maps beats → pixels; vertical
 * position maps pitch → rows. Keeping this math here (and free of any DOM or
 * audio dependency) lets the scheduling and the UI agree exactly, and makes the
 * tricky bits trivially unit-testable.
 */
import { MAX_PITCH, MIN_PITCH } from '../model/project'

/** Layout constants for the piano roll grid. */
export interface GridLayout {
  /** Horizontal pixels per beat. */
  beatWidth: number
  /** Vertical pixels per pitch row. */
  rowHeight: number
}

export const DEFAULT_LAYOUT: GridLayout = { beatWidth: 48, rowHeight: 16 }

/** Total number of pitch rows rendered (inclusive of both ends). */
export const PITCH_ROWS = MAX_PITCH - MIN_PITCH + 1

/** Seconds per beat at a tempo. */
export function secondsPerBeat(bpm: number): number {
  return 60 / bpm
}

/** Convert a beat position/length to seconds. */
export function beatsToSeconds(beats: number, bpm: number): number {
  return beats * secondsPerBeat(bpm)
}

/** Convert seconds to beats. */
export function secondsToBeats(seconds: number, bpm: number): number {
  return seconds / secondsPerBeat(bpm)
}

/** Snap a beat value to the nearest grid division (e.g. grid = 0.25 → 16ths). */
export function snap(beat: number, grid: number): number {
  if (grid <= 0) return Math.max(0, beat)
  return Math.max(0, Math.round(beat / grid) * grid)
}

/** Snap toward zero (floor) — used when placing a note at a clicked cell. */
export function snapFloor(beat: number, grid: number): number {
  if (grid <= 0) return Math.max(0, beat)
  return Math.max(0, Math.floor(beat / grid) * grid)
}

/**
 * Row index (0 at the top) for a pitch. Higher pitches sit higher on the roll,
 * so the top row is {@link MAX_PITCH}.
 */
export function pitchToRow(pitch: number): number {
  return MAX_PITCH - pitch
}

/** Inverse of {@link pitchToRow}, clamped to the visible piano range. */
export function rowToPitch(row: number): number {
  const pitch = MAX_PITCH - Math.round(row)
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, pitch))
}

/** Convert a clientX-relative x offset (px) to a beat position. */
export function xToBeat(x: number, layout: GridLayout = DEFAULT_LAYOUT): number {
  return Math.max(0, x / layout.beatWidth)
}

/** Convert a beat position to an x offset in px. */
export function beatToX(beat: number, layout: GridLayout = DEFAULT_LAYOUT): number {
  return beat * layout.beatWidth
}

/** Convert a clientY-relative y offset (px) to a pitch. */
export function yToPitch(y: number, layout: GridLayout = DEFAULT_LAYOUT): number {
  return rowToPitch(y / layout.rowHeight)
}

/** Pixel rectangle for a note given the grid layout. */
export interface NoteRect {
  left: number
  top: number
  width: number
  height: number
}

export function noteRect(
  note: { pitch: number; start: number; duration: number },
  layout: GridLayout = DEFAULT_LAYOUT,
): NoteRect {
  return {
    left: beatToX(note.start, layout),
    top: pitchToRow(note.pitch) * layout.rowHeight,
    width: Math.max(2, note.duration * layout.beatWidth),
    height: layout.rowHeight,
  }
}

/**
 * Position of the playhead in beats given elapsed transport seconds. When a
 * loop is active the playhead wraps within [start, end).
 */
export function playheadBeat(
  elapsedSeconds: number,
  bpm: number,
  loop?: { enabled: boolean; start: number; end: number },
): number {
  const beat = secondsToBeats(Math.max(0, elapsedSeconds), bpm)
  if (loop && loop.enabled && loop.end > loop.start) {
    const span = loop.end - loop.start
    if (beat < loop.start) return beat
    return loop.start + ((beat - loop.start) % span)
  }
  return beat
}

/** Available snap divisions offered in the UI, labelled for humans. */
export const SNAP_OPTIONS = [
  { label: '1/1', value: 4 },
  { label: '1/2', value: 2 },
  { label: '1/4', value: 1 },
  { label: '1/8', value: 0.5 },
  { label: '1/16', value: 0.25 },
] as const

/**
 * Format a beat position as Tone.js "Bars:Beats:Sixteenths" transport time so
 * scheduled events follow the audio clock and rescale with tempo changes.
 *
 * `sixteenthDecimals` is a DISPLAY-only convenience: when set, the sixteenth is
 * rounded to that many decimals (e.g. the transport readout passes 3). The
 * scheduler omits it and keeps full precision for sample-accurate Tone.js times.
 */
export function beatsToBarsBeatsSixteenths(
  beats: number,
  beatsPerBar = 4,
  sixteenthDecimals?: number,
): string {
  const totalSixteenths = Math.max(0, beats) * 4
  const sixteenthsPerBar = beatsPerBar * 4
  const bars = Math.floor(totalSixteenths / sixteenthsPerBar)
  const rem = totalSixteenths - bars * sixteenthsPerBar
  const beat = Math.floor(rem / 4)
  const sixteenth = rem - beat * 4
  const shown =
    sixteenthDecimals === undefined ? sixteenth : Number(sixteenth.toFixed(sixteenthDecimals))
  return `${bars}:${beat}:${shown}`
}
