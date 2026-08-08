/**
 * Instrument registry — pure metadata describing the selectable instruments.
 *
 * Only descriptive data lives here so the registry stays trivially testable and
 * free of any audio dependency. The audio engine reads these ids to build the
 * matching Tone.js voices. Adding an instrument later is a two-step change:
 * append an entry here, then handle its id in the engine's voice factory.
 */
import { type InstrumentId } from '../model/project'

/** How an instrument interprets pitch: melodic (pitched) or a drum map. */
export type InstrumentKind = 'synth' | 'drum'

export interface InstrumentDefinition {
  id: InstrumentId
  name: string
  kind: InstrumentKind
  description: string
  /** True when the instrument plays multiple simultaneous notes. */
  polyphonic: boolean
}

export const INSTRUMENTS: readonly InstrumentDefinition[] = [
  {
    id: 'poly-synth',
    name: 'Poly Synth',
    kind: 'synth',
    description: 'A warm polyphonic subtractive synth — chords and pads.',
    polyphonic: true,
  },
  {
    id: 'fm-synth',
    name: 'FM Synth',
    kind: 'synth',
    description: 'A bright FM voice for leads, bells, and plucks.',
    polyphonic: true,
  },
  {
    id: 'drum-kit',
    name: 'Drum Kit',
    kind: 'drum',
    description: 'A basic sampler-style kit: kick, snare, and hats.',
    polyphonic: true,
  },
] as const

const BY_ID = new Map<InstrumentId, InstrumentDefinition>(
  INSTRUMENTS.map((i) => [i.id, i]),
)

/** Look up an instrument definition, falling back to the poly synth. */
export function getInstrument(id: InstrumentId): InstrumentDefinition {
  return BY_ID.get(id) ?? INSTRUMENTS[0]
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
