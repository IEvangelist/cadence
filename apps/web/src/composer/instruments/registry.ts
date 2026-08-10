/**
 * Instrument registry — a thin facade over the Plugin SDK host.
 *
 * Instruments used to live here as a hard-coded array. They are now contributed
 * by the core plugin (see `plugins/builtins/instruments.ts`) and resolved
 * through {@link defaultPluginHost}, so plugin-provided instruments appear here
 * automatically. The audio-free lookup helpers live in `./lookup` (side-effect
 * free) so low-level modules pulled in *during* host initialization (persistence,
 * MIDI) can resolve instruments without triggering the eager `INSTRUMENTS`
 * snapshot below. This module re-exports those helpers and adds the load-time
 * snapshot plus the drum-map helpers for the UI, tests, and the published
 * composer contract.
 */
import type { InstrumentDefinition, InstrumentKind } from '../plugins/types'
import { listInstruments } from './lookup'

export {
  listInstruments,
  getInstrument,
  getInstrumentContribution,
} from './lookup'
export type { InstrumentDefinition, InstrumentKind }

/** All currently selectable instruments (built-in + active plugins). */
export const INSTRUMENTS: readonly InstrumentDefinition[] = listInstruments()

/** General-MIDI-style names for the drum map pitches the kit responds to. */
export const DRUM_MAP: Readonly<Record<number, string>> = {
  35: 'Acoustic Bass Drum',
  36: 'Kick',
  38: 'Snare',
  39: 'Clap',
  42: 'Closed Hat',
  46: 'Open Hat',
  49: 'Crash',
  51: 'Ride',
}

/** Human label for a pitch on a given instrument (drum name or note name). */
export function drumLabel(pitch: number): string | undefined {
  return DRUM_MAP[pitch]
}
