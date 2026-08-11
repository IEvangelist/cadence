/**
 * Cadence composer — typed project model.
 *
 * The model is intentionally plain data (no class instances) so it serializes
 * cleanly to storage/MIDI and stays trivial to reason about and test. A real
 * database/backend can persist these same shapes later without a rewrite.
 */
import type { AutomationLane } from './automation'

/** MIDI note number, 0–127. Middle C (C4) is 60. */
export type Pitch = number

/**
 * Identifier of a selectable instrument.
 *
 * This is an open set (`string`) so plugins can contribute new instruments
 * through the Plugin SDK. The built-in ids are `poly-synth`, `fm-synth`, and
 * `drum-kit`; persistence coerces unknown ids back to a built-in on load.
 */
export type InstrumentId = string

/** A single note event. Times are in beats (quarter notes) from the timeline start. */
export interface Note {
  id: string
  /** MIDI note number (0–127). */
  pitch: Pitch
  /** Start position in beats. */
  start: number
  /** Length in beats (must be > 0). */
  duration: number
  /** Normalized velocity 0–1. */
  velocity: number
}

/** A track owns an ordered set of notes played by one instrument. */
export interface Track {
  id: string
  name: string
  instrumentId: InstrumentId
  notes: Note[]
  muted: boolean
  /** CSS color used to render the track's notes. */
  color: string
}

/** A/B loop region on the timeline, measured in beats. */
export interface LoopRegion {
  enabled: boolean
  start: number
  end: number
}

/** The full composition. `schemaVersion` gates persistence migrations. */
export interface Project {
  schemaVersion: number
  id: string
  name: string
  /** Tempo in beats per minute. */
  tempo: number
  /** Pulses per quarter note — MIDI export resolution. */
  ppq: number
  /** Total timeline length in beats. */
  lengthBeats: number
  loop: LoopRegion
  tracks: Track[]
  /**
   * Mixer/track parameter automation over the transport timeline (track volume,
   * track pan, master gain). Optional and additive: legacy documents omit it and
   * are migrated to `[]`. Applied on the #44 mixer side during playback, never on
   * the note-playback seam.
   */
  automation?: AutomationLane[]
}

/** Current persistence schema version. Bump when the shape changes. */
export const SCHEMA_VERSION = 2

/** Pulses-per-quarter used for MIDI export/import. */
export const DEFAULT_PPQ = 480

/** Beats per bar (Composer MVP is 4/4). */
export const BEATS_PER_BAR = 4

/** Default project tempo. */
export const DEFAULT_TEMPO = 120

/** Lowest pitch shown in the piano roll (A0). */
export const MIN_PITCH = 21

/** Highest pitch shown in the piano roll (C8). */
export const MAX_PITCH = 108

/** The palette used to auto-color new tracks. */
export const TRACK_COLORS = [
  '#7a2ff0',
  '#12bddc',
  '#2563eb',
  '#a26bff',
  '#0e9db8',
] as const

const PITCH_CLASS_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

/** Pitch classes (0–11) that render as black keys. */
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

/** Generate a reasonably unique id with a readable prefix. */
export function newId(prefix = 'id'): string {
  const c = globalThis.crypto
  const uuid =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : Math.random().toString(36).slice(2, 12)
  return `${prefix}_${uuid}`
}

/** Human-readable note name for a MIDI pitch, e.g. 60 → "C4". */
export function pitchToName(pitch: Pitch): string {
  const name = PITCH_CLASS_NAMES[((pitch % 12) + 12) % 12]
  const octave = Math.floor(pitch / 12) - 1
  return `${name}${octave}`
}

/** True when the pitch corresponds to a black piano key. */
export function isBlackKey(pitch: Pitch): boolean {
  return BLACK_KEYS.has(((pitch % 12) + 12) % 12)
}

/** Build a fully-formed {@link Note}, filling defaults and a fresh id. */
export function createNote(
  input: { pitch: Pitch; start: number; duration?: number; velocity?: number },
  id: string = newId('note'),
): Note {
  return {
    id,
    pitch: input.pitch,
    start: input.start,
    duration: input.duration ?? 1,
    velocity: input.velocity ?? 0.8,
  }
}

/** Build an empty track for the given instrument. */
export function createTrack(
  input: {
    name?: string
    instrumentId?: InstrumentId
    color?: string
    notes?: Note[]
    muted?: boolean
  } = {},
  id: string = newId('track'),
): Track {
  return {
    id,
    name: input.name ?? 'New track',
    instrumentId: input.instrumentId ?? 'poly-synth',
    notes: input.notes ?? [],
    muted: input.muted ?? false,
    color: input.color ?? TRACK_COLORS[0],
  }
}

/** Pick a track color that cycles through the palette by index. */
export function trackColorForIndex(index: number): string {
  return TRACK_COLORS[index % TRACK_COLORS.length]
}

/** A blank project with a single empty synth track. */
export function createEmptyProject(id: string = newId('project')): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: 'Untitled',
    tempo: DEFAULT_TEMPO,
    ppq: DEFAULT_PPQ,
    lengthBeats: BEATS_PER_BAR * 4,
    loop: { enabled: false, start: 0, end: BEATS_PER_BAR * 4 },
    tracks: [createTrack({ name: 'Synth', instrumentId: 'poly-synth' })],
    automation: [],
  }
}

/**
 * A tiny demo so first-run isn't blank: a two-bar C-major chord progression on
 * a synth plus a basic kick/snare/hat drum pattern.
 */
export function createDemoProject(id: string = newId('project')): Project {
  const chord = (root: Pitch, start: number): Note[] =>
    [root, root + 4, root + 7].map((pitch) =>
      createNote({ pitch, start, duration: 2, velocity: 0.7 }),
    )

  const synthNotes: Note[] = [
    ...chord(60, 0), // C major
    ...chord(65, 2), // F major
    ...chord(67, 4), // G major
    ...chord(60, 6), // C major
  ]

  // Drum mapping: 36 = kick, 38 = snare, 42 = closed hat.
  const drumNotes: Note[] = []
  for (let beat = 0; beat < 8; beat += 1) {
    drumNotes.push(createNote({ pitch: 36, start: beat, duration: 0.5, velocity: 0.9 }))
    if (beat % 2 === 1) {
      drumNotes.push(createNote({ pitch: 38, start: beat, duration: 0.5, velocity: 0.8 }))
    }
    drumNotes.push(createNote({ pitch: 42, start: beat + 0.5, duration: 0.25, velocity: 0.5 }))
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: 'Demo — Every idea, resolved',
    tempo: DEFAULT_TEMPO,
    ppq: DEFAULT_PPQ,
    lengthBeats: BEATS_PER_BAR * 2,
    loop: { enabled: true, start: 0, end: BEATS_PER_BAR * 2 },
    tracks: [
      createTrack({ name: 'Synth', instrumentId: 'poly-synth', notes: synthNotes }),
      createTrack({
        name: 'Drums',
        instrumentId: 'drum-kit',
        notes: drumNotes,
        color: TRACK_COLORS[1],
      }),
    ],
    automation: [],
  }
}
