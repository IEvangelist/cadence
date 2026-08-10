/**
 * Instrument registry — a thin facade over the Plugin SDK host.
 *
 * Instruments used to live here as a hard-coded array. They are now contributed
 * by the core plugin (see `plugins/builtins/instruments.ts`) and resolved
 * through {@link defaultPluginHost}, so plugin-provided instruments appear here
 * automatically. This module keeps the small, audio-free metadata API the rest
 * of the UI already imports, plus the drum-map helpers.
 */
import { defaultPluginHost } from '../plugins/defaultHost'
import type {
  InstrumentContribution,
  InstrumentDefinition,
  InstrumentKind,
} from '../plugins/types'

export type { InstrumentDefinition, InstrumentKind }

const FALLBACK_ID = 'poly-synth'

function toDefinition(c: InstrumentContribution): InstrumentDefinition {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description,
    polyphonic: c.polyphonic,
    group: c.group,
  }
}

/** All currently selectable instruments (built-in + active plugins). */
export function listInstruments(): InstrumentDefinition[] {
  return defaultPluginHost.instruments().map(toDefinition)
}

/**
 * Resolve an instrument's full contribution (metadata + voice factory), falling
 * back to the poly synth when the id is unknown.
 */
export function getInstrumentContribution(id: string): InstrumentContribution {
  const all = defaultPluginHost.instruments()
  return (
    all.find((c) => c.id === id) ??
    all.find((c) => c.id === FALLBACK_ID) ??
    all[0]
  )
}

/** Look up an instrument's metadata, falling back to the poly synth. */
export function getInstrument(id: string): InstrumentDefinition {
  return toDefinition(getInstrumentContribution(id))
}

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
