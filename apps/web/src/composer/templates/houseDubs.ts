/**
 * The built-in **house dubs** — six professionally arranged, multi-track,
 * multi-bar quick-start songs. Each is a finished-sounding groove (drums, bass,
 * chords/keys and a melodic lead across ~8 bars) that a newcomer can load in one
 * click and immediately play, then remix per track.
 *
 * This module is pure data + tiny music helpers. It only *consumes* instrument
 * ids from the #109 built-in library (via string ids that resolve through
 * `getInstrument`); it never imports or edits `plugins/builtins/**`, so the
 * template lane and the instrument-library lane stay fully decoupled.
 *
 * Every template's `build()` returns a fresh {@link Project} (new note/track/
 * project ids each call) shaped exactly like the reducer's `load-project`
 * expects, with a `loop.end` that already covers the full arrangement.
 */
import {
  BEATS_PER_BAR,
  DEFAULT_PPQ,
  SCHEMA_VERSION,
  type Note,
  type Project,
  type Track,
  createNote,
  createTrack,
  newId,
  trackColorForIndex,
} from '../model/project'
import type { SongTemplate } from './types'

// ---------------------------------------------------------------------------
// Music helpers — keep the arrangements readable and correct.
// ---------------------------------------------------------------------------

/** A pitch given as a MIDI number or a note name like `'C4'`/`'F#3'`/`'Bb2'`. */
type PitchLike = number | string

const PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6,
  Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

/** Convert a note name (`'C4'` = MIDI 60) to a MIDI number. */
function midi(name: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim())
  if (!match) throw new Error(`Invalid note name: "${name}"`)
  const [, letter, accidental, octaveStr] = match
  const pitchClass = PITCH_CLASSES[`${letter.toUpperCase()}${accidental}`]
  return 12 * (Number(octaveStr) + 1) + pitchClass
}

/** Resolve a {@link PitchLike} to a MIDI number. */
const pitch = (value: PitchLike): number =>
  typeof value === 'number' ? value : midi(value)

/** A note before it is materialized (no id yet) — the authoring unit. */
interface NoteSeed {
  pitch: PitchLike
  start: number
  duration: number
  velocity?: number
}

/** One note. */
const n = (
  p: PitchLike,
  start: number,
  duration: number,
  velocity = 0.8,
): NoteSeed => ({ pitch: p, start, duration, velocity })

/** A stacked chord: `root` plus semitone `intervals`, all sharing start/length. */
function chord(
  root: PitchLike,
  intervals: readonly number[],
  start: number,
  duration: number,
  velocity = 0.65,
): NoteSeed[] {
  const base = pitch(root)
  return intervals.map((iv) => ({ pitch: base + iv, start, duration, velocity }))
}

/** Tile a one-bar seed pattern across `bars`, shifting each copy by a bar. */
function tile(pattern: readonly NoteSeed[], bars: number, barLen = BEATS_PER_BAR): NoteSeed[] {
  const out: NoteSeed[] = []
  for (let bar = 0; bar < bars; bar += 1) {
    const offset = bar * barLen
    for (const seed of pattern) out.push({ ...seed, start: seed.start + offset })
  }
  return out
}

/** Shift a whole phrase to start at `offset` beats (e.g. drop a lead in at bar 5). */
const at = (offset: number, seeds: readonly NoteSeed[]): NoteSeed[] =>
  seeds.map((seed) => ({ ...seed, start: seed.start + offset }))

// Chord shapes (semitone intervals from the root).
const MIN = [0, 3, 7]
const MAJ = [0, 4, 7]
const MIN7 = [0, 3, 7, 10]
const MAJ7 = [0, 4, 7, 11]
const DOM7 = [0, 4, 7, 10]
const MIN9 = [0, 3, 7, 10, 14]
const MAJ9 = [0, 4, 7, 11, 14]
const SIX9 = [0, 4, 7, 9, 14]
const SUS4_7 = [0, 5, 7, 10]
const ADD_OCT = [0, 3, 7, 12]

// Drum-map pitches the built-in kits respond to (kick ≤ 36, snare/clap 37–40,
// everything above is a hat/cymbal voice).
const KICK = 36
const SNARE = 38
const CLAP = 39
const HAT = 42
const OPEN_HAT = 46
const CRASH = 49

// ---------------------------------------------------------------------------
// Template assembly
// ---------------------------------------------------------------------------

interface TrackSpec {
  name: string
  instrumentId: string
  notes: NoteSeed[]
}

interface DubSpec {
  id: string
  name: string
  description: string
  genre: string
  tempo: number
  tracks: TrackSpec[]
}

function materializeTrack(spec: TrackSpec, index: number): Track {
  const notes: Note[] = spec.notes.map((seed) =>
    createNote({
      pitch: pitch(seed.pitch),
      start: seed.start,
      duration: seed.duration,
      velocity: seed.velocity ?? 0.8,
    }),
  )
  return createTrack({
    name: spec.name,
    instrumentId: spec.instrumentId,
    color: trackColorForIndex(index),
    notes,
  })
}

function buildProject(spec: DubSpec): Project {
  const tracks = spec.tracks.map(materializeTrack)
  const contentEnd = tracks.reduce((max, track) => {
    for (const note of track.notes) {
      const end = note.start + note.duration
      if (end > max) max = end
    }
    return max
  }, 0)
  // Round up to a whole bar so the timeline and the whole-song loop cover every
  // note (the reducer self-heals this too, but we ship it correct — #107).
  const lengthBeats = Math.max(
    BEATS_PER_BAR,
    Math.ceil(contentEnd / BEATS_PER_BAR) * BEATS_PER_BAR,
  )
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId('project'),
    name: spec.name,
    tempo: spec.tempo,
    ppq: DEFAULT_PPQ,
    lengthBeats,
    loop: { enabled: true, start: 0, end: lengthBeats },
    tracks,
  }
}

function toTemplate(spec: DubSpec): SongTemplate {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    genre: spec.genre,
    tempo: spec.tempo,
    build: () => buildProject(spec),
  }
}

// ---------------------------------------------------------------------------
// 1. Lo-Fi Hip-Hop — "Midnight Tape"
// ---------------------------------------------------------------------------
// A dusty Am7–D7–Gmaj7–Cmaj7 loop on a Rhodes over brushed drums and a rounded
// upright-ish bass; a vibraphone motif drifts in for the second pass.

const midnightTape: DubSpec = {
  id: 'lofi-midnight-tape',
  name: 'Midnight Tape',
  description: 'Dusty Rhodes chords, brushed drums and a late-night vibraphone drift.',
  genre: 'Lo-Fi Hip-Hop',
  tempo: 78,
  tracks: [
    {
      name: 'Rhodes',
      instrumentId: 'rhodes',
      notes: tile(
        [
          ...chord('A3', MIN7, 0, 3.6, 0.5),
          ...chord('A3', MIN7, 2.5, 1.4, 0.42),
          ...chord('D3', DOM7, 4, 3.6, 0.5),
          ...chord('D3', DOM7, 6.5, 1.4, 0.42),
          ...chord('G3', MAJ7, 8, 3.6, 0.5),
          ...chord('G3', MAJ7, 10.5, 1.4, 0.42),
          ...chord('C4', MAJ7, 12, 3.6, 0.5),
          ...chord('C4', MAJ7, 14.5, 1.4, 0.42),
        ],
        2,
        16,
      ),
    },
    {
      name: 'Upright Bass',
      instrumentId: 'upright-bass',
      notes: tile(
        [
          n('A2', 0, 1.6, 0.85), n('E3', 2.5, 0.8, 0.72),
          n('D2', 4, 1.6, 0.85), n('A2', 6.5, 0.8, 0.72),
          n('G2', 8, 1.6, 0.85), n('D3', 10.5, 0.8, 0.72),
          n('C3', 12, 1.6, 0.85), n('G2', 14.5, 0.8, 0.72),
        ],
        2,
        16,
      ),
    },
    {
      name: 'Vibraphone',
      instrumentId: 'vibraphone',
      // Enters on the second pass (bar 5) so the tune develops rather than loops.
      notes: at(16, [
        n('E5', 0, 1, 0.6), n('G5', 1, 0.5, 0.55), n('A5', 1.5, 1.5, 0.6),
        n('C6', 4, 1, 0.6), n('A5', 5, 0.5, 0.5), n('G5', 5.5, 1.5, 0.58),
        n('D5', 8, 1, 0.58), n('E5', 9, 0.5, 0.5), n('G5', 9.5, 2, 0.6),
        n('E5', 12, 1.5, 0.58), n('D5', 13.5, 0.5, 0.5), n('C5', 14, 2, 0.62),
      ]),
    },
    {
      name: 'Brush Kit',
      instrumentId: 'drum-kit-jazz-brushes',
      notes: [
        ...tile(
          [
            n(KICK, 0, 0.3, 0.9), n(KICK, 2.5, 0.3, 0.82),
            n(SNARE, 1, 0.3, 0.7), n(SNARE, 3, 0.3, 0.72),
            n(HAT, 0, 0.2, 0.34), n(HAT, 0.5, 0.2, 0.3), n(HAT, 1, 0.2, 0.34),
            n(HAT, 1.5, 0.2, 0.3), n(HAT, 2, 0.2, 0.34), n(HAT, 2.5, 0.2, 0.3),
            n(HAT, 3, 0.2, 0.34), n(OPEN_HAT, 3.5, 0.2, 0.34),
          ],
          8,
        ),
        // Little ghost-snare pickup into the last bar's turnaround.
        n(SNARE, 30.75, 0.2, 0.4), n(SNARE, 31.25, 0.2, 0.5), n(SNARE, 31.5, 0.2, 0.58),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 2. House — "Sunset Boulevard"
// ---------------------------------------------------------------------------
// Four-on-the-floor 808, off-beat sub bass and warm electric-piano stabs through
// a deep-house Fm9–Dbmaj7–Ab6/9–Eb7 turnaround, with a saw pluck up top.

const sunsetBoulevard: DubSpec = {
  id: 'house-sunset-boulevard',
  name: 'Sunset Boulevard',
  description: 'Four-on-the-floor house with off-beat sub bass and warm piano stabs.',
  genre: 'House',
  tempo: 122,
  tracks: [
    {
      name: 'Electric Piano',
      instrumentId: 'electric-piano',
      notes: tile(
        [
          ...chord('F3', MIN9, 0.5, 0.35, 0.6), ...chord('F3', MIN9, 1.5, 0.35, 0.5),
          ...chord('F3', MIN9, 2.5, 0.35, 0.6), ...chord('F3', MIN9, 3.5, 0.35, 0.5),
          ...chord('Db3', MAJ7, 4.5, 0.35, 0.6), ...chord('Db3', MAJ7, 5.5, 0.35, 0.5),
          ...chord('Db3', MAJ7, 6.5, 0.35, 0.6), ...chord('Db3', MAJ7, 7.5, 0.35, 0.5),
          ...chord('Ab3', SIX9, 8.5, 0.35, 0.6), ...chord('Ab3', SIX9, 9.5, 0.35, 0.5),
          ...chord('Ab3', SIX9, 10.5, 0.35, 0.6), ...chord('Ab3', SIX9, 11.5, 0.35, 0.5),
          ...chord('Eb3', DOM7, 12.5, 0.35, 0.6), ...chord('Eb3', DOM7, 13.5, 0.35, 0.5),
          ...chord('Eb3', DOM7, 14.5, 0.35, 0.6), ...chord('Eb3', DOM7, 15.5, 0.35, 0.55),
        ],
        2,
        16,
      ),
    },
    {
      name: 'Sub Bass',
      instrumentId: 'sub-bass',
      notes: tile(
        [
          ...tile([n('F2', 0.5, 0.4, 0.9), n('F2', 1.5, 0.4, 0.86), n('F2', 2.5, 0.4, 0.9), n('F2', 3.5, 0.4, 0.86)], 1),
          n('Db2', 4.5, 0.4, 0.9), n('Db2', 5.5, 0.4, 0.86), n('Db2', 6.5, 0.4, 0.9), n('Db2', 7.5, 0.4, 0.86),
          n('Ab2', 8.5, 0.4, 0.9), n('Ab2', 9.5, 0.4, 0.86), n('Ab2', 10.5, 0.4, 0.9), n('Ab2', 11.5, 0.4, 0.86),
          n('Eb2', 12.5, 0.4, 0.9), n('Eb2', 13.5, 0.4, 0.86), n('Eb2', 14.5, 0.4, 0.9), n('Eb2', 15.5, 0.4, 0.86),
        ],
        2,
        16,
      ),
    },
    {
      name: 'Saw Pluck',
      instrumentId: 'saw-lead',
      notes: at(16, [
        n('Ab4', 0, 0.4, 0.62), n('C5', 0.5, 0.4, 0.6), n('F5', 1.5, 0.6, 0.66),
        n('Eb5', 2.5, 0.4, 0.6), n('C5', 3, 0.5, 0.58),
        n('Ab4', 4, 0.4, 0.62), n('Db5', 4.5, 0.4, 0.6), n('F5', 5.5, 0.6, 0.66),
        n('Ab5', 6.5, 0.5, 0.66), n('G5', 7, 0.5, 0.6),
        n('Eb5', 8, 0.4, 0.6), n('Ab4', 8.5, 0.4, 0.58), n('C5', 9.5, 0.6, 0.62),
        n('Eb5', 10.5, 0.5, 0.62), n('F5', 11, 0.5, 0.6),
        n('Eb5', 12, 0.5, 0.62), n('Bb4', 12.5, 0.5, 0.58), n('G4', 13.5, 0.5, 0.58),
        n('Bb4', 14, 0.5, 0.6), n('Eb5', 14.5, 1, 0.66),
      ]),
    },
    {
      name: '808 Kit',
      instrumentId: 'drum-kit-808',
      notes: [
        n(CRASH, 0, 0.4, 0.6),
        ...tile(
          [
            n(KICK, 0, 0.3, 0.96), n(KICK, 1, 0.3, 0.94), n(KICK, 2, 0.3, 0.96), n(KICK, 3, 0.3, 0.94),
            n(CLAP, 1, 0.3, 0.8), n(CLAP, 3, 0.3, 0.8),
            n(OPEN_HAT, 0.5, 0.2, 0.5), n(OPEN_HAT, 1.5, 0.2, 0.5),
            n(OPEN_HAT, 2.5, 0.2, 0.5), n(OPEN_HAT, 3.5, 0.2, 0.5),
            n(HAT, 0, 0.15, 0.32), n(HAT, 1, 0.15, 0.32), n(HAT, 2, 0.15, 0.32), n(HAT, 3, 0.15, 0.32),
          ],
          8,
        ),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 3. Trap — "Concrete Jungle"
// ---------------------------------------------------------------------------
// Dark half-time F-minor piano over sliding 808 sub, rattling trap hats and a
// marimba counter-line — booming and cinematic.

const concreteJungle: DubSpec = {
  id: 'trap-concrete-jungle',
  name: 'Concrete Jungle',
  description: 'Dark half-time trap: sliding 808s, rattling hats and a minor piano hook.',
  genre: 'Trap',
  tempo: 140,
  tracks: [
    {
      name: 'Grand Piano',
      instrumentId: 'grand-piano',
      notes: tile(
        [
          // Fm arpeggio hook.
          n('F4', 0, 0.5, 0.72), n('Ab4', 0.5, 0.5, 0.64), n('C5', 1, 0.5, 0.68),
          n('Ab4', 1.5, 0.5, 0.6), n('Db5', 2, 0.75, 0.7), n('C5', 2.75, 0.5, 0.62),
          n('Ab4', 3.25, 0.75, 0.6),
          // Answering Cm shape.
          n('Eb4', 4, 0.5, 0.7), n('G4', 4.5, 0.5, 0.62), n('C5', 5, 0.5, 0.68),
          n('G4', 5.5, 0.5, 0.6), n('Bb4', 6, 0.75, 0.7), n('C5', 6.75, 0.5, 0.62),
          n('G4', 7.25, 0.75, 0.6),
        ],
        4,
        8,
      ),
    },
    {
      name: '808 Sub',
      instrumentId: 'sub-bass',
      notes: tile(
        [
          n('F1', 0, 1.75, 0.96), n('F1', 2, 0.5, 0.8), n('Ab1', 2.75, 1.25, 0.9),
          n('Eb1', 4, 1.75, 0.96), n('Eb1', 6, 0.5, 0.8), n('Db1', 6.75, 1.25, 0.9),
        ],
        4,
        8,
      ),
    },
    {
      name: 'Marimba',
      instrumentId: 'marimba',
      notes: at(16, [
        n('F5', 0, 0.5, 0.66), n('C6', 0.75, 0.5, 0.6), n('Ab5', 1.5, 0.5, 0.62),
        n('Db6', 2.5, 0.75, 0.66), n('C6', 3.5, 0.5, 0.58),
        n('Eb5', 4, 0.5, 0.64), n('Bb5', 4.75, 0.5, 0.6), n('G5', 5.5, 0.5, 0.62),
        n('C6', 6.5, 1, 0.66),
        n('F5', 8, 0.5, 0.66), n('Ab5', 8.75, 0.5, 0.6), n('C6', 9.5, 0.5, 0.62),
        n('Eb6', 10.5, 1, 0.68), n('C6', 11.75, 0.5, 0.58),
        n('Db6', 12, 0.75, 0.66), n('C6', 13, 0.5, 0.6), n('Ab5', 13.75, 0.5, 0.6),
        n('F5', 14.5, 1.5, 0.66),
      ]),
    },
    {
      name: 'Trap Kit',
      instrumentId: 'drum-kit-trap',
      notes: [
        ...tile(
          [
            n(KICK, 0, 0.3, 0.96), n(KICK, 2.75, 0.3, 0.9), n(KICK, 3.5, 0.3, 0.88),
            n(SNARE, 2, 0.3, 0.86),
            n(HAT, 0, 0.15, 0.42), n(HAT, 0.5, 0.15, 0.36), n(HAT, 1, 0.15, 0.42),
            n(HAT, 1.5, 0.15, 0.36), n(HAT, 2, 0.15, 0.42), n(HAT, 2.5, 0.15, 0.36),
            n(HAT, 3, 0.15, 0.42),
          ],
          8,
        ),
        // 16th-note hat rolls into bars 4 and 8 (trap signature).
        ...at(12, [n(HAT, 3, 0.12, 0.4), n(HAT, 3.25, 0.12, 0.44), n(HAT, 3.5, 0.12, 0.48), n(HAT, 3.75, 0.12, 0.52)]),
        ...at(28, [n(HAT, 3, 0.1, 0.4), n(HAT, 3.2, 0.1, 0.42), n(HAT, 3.4, 0.1, 0.46), n(HAT, 3.6, 0.1, 0.5), n(HAT, 3.8, 0.1, 0.54)]),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 4. Ambient — "Weightless Drift"
// ---------------------------------------------------------------------------
// A slow, drum-free wash: warm pad and string ensemble breathe through a
// Dmaj9–Bm9–Gmaj9–A7sus progression over a deep sub pedal, with a music-box
// figure floating above.

const weightlessDrift: DubSpec = {
  id: 'ambient-weightless-drift',
  name: 'Weightless Drift',
  description: 'A slow, drum-free wash of pads, strings and a floating music box.',
  genre: 'Ambient',
  tempo: 68,
  tracks: [
    {
      name: 'Warm Pad',
      instrumentId: 'warm-pad',
      notes: [
        ...chord('D3', MAJ9, 0, 7.6, 0.5),
        ...chord('B2', MIN9, 8, 7.6, 0.5),
        ...chord('G2', MAJ9, 16, 7.6, 0.5),
        ...chord('A2', SUS4_7, 24, 7.6, 0.5),
      ],
    },
    {
      name: 'String Ensemble',
      instrumentId: 'string-ensemble',
      // Upper harmony enters from bar 3 and swells to the end.
      notes: at(8, [
        ...chord('D4', MAJ, 0, 7.5, 0.42),
        ...chord('B3', MIN, 8, 7.5, 0.46),
        ...chord('G3', MAJ, 16, 7.5, 0.5),
      ]),
    },
    {
      name: 'Music Box',
      instrumentId: 'music-box',
      notes: at(8, [
        n('A5', 0, 1.5, 0.55), n('F#5', 1.5, 1, 0.48), n('D5', 3, 2, 0.5),
        n('E5', 6, 1.5, 0.5),
        n('B5', 8, 1.5, 0.55), n('A5', 9.5, 1, 0.48), n('F#5', 11, 2, 0.5),
        n('D5', 14, 1.5, 0.5),
        n('G5', 16, 1.5, 0.52), n('B5', 17.5, 1, 0.5), n('A5', 19, 2, 0.52),
        n('D6', 22, 2, 0.55),
      ]),
    },
    {
      name: 'Sub Bass',
      instrumentId: 'sub-bass',
      notes: [
        n('D2', 0, 7.8, 0.8), n('B1', 8, 7.8, 0.8),
        n('G1', 16, 7.8, 0.8), n('A1', 24, 7.8, 0.8),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 5. Funk — "Pocket Change"
// ---------------------------------------------------------------------------
// Tight E-minor funk: clavinet chops, a slap-bass line that pops the octave,
// an acoustic backbeat and stabbing horn hits in the second half.

const pocketChange: DubSpec = {
  id: 'funk-pocket-change',
  name: 'Pocket Change',
  description: 'Tight funk: clavinet chops, popping slap bass and stabbing horns.',
  genre: 'Funk',
  tempo: 112,
  tracks: [
    {
      name: 'Clavinet',
      instrumentId: 'clavinet',
      notes: tile(
        [
          ...chord('E3', MIN7, 0, 0.2, 0.62), ...chord('E3', MIN7, 0.75, 0.2, 0.5),
          ...chord('E3', MIN7, 1.5, 0.2, 0.6), ...chord('E3', MIN7, 2.25, 0.2, 0.48),
          ...chord('A3', DOM7, 3, 0.2, 0.6), ...chord('E3', MIN7, 3.75, 0.2, 0.5),
        ],
        8,
      ),
    },
    {
      name: 'Slap Bass',
      instrumentId: 'slap-bass',
      notes: tile(
        [
          n('E2', 0, 0.35, 0.9), n('E3', 0.5, 0.25, 0.7), n('E2', 1, 0.3, 0.8),
          n('G2', 1.5, 0.3, 0.82), n('A2', 2.25, 0.3, 0.85), n('E3', 2.75, 0.25, 0.68),
          n('B2', 3, 0.3, 0.82), n('D3', 3.5, 0.5, 0.8),
        ],
        8,
      ),
    },
    {
      name: 'Brass Section',
      instrumentId: 'brass-section',
      // Horn stabs answer the groove from bar 5 on.
      notes: at(16, [
        ...chord('E4', MIN, 0, 0.4, 0.7), ...chord('E4', MIN, 1.5, 0.3, 0.6),
        ...chord('G4', MAJ, 2.5, 0.5, 0.72),
        ...chord('A4', MAJ, 4.5, 0.4, 0.72), ...chord('B4', MAJ, 6, 0.6, 0.74),
        ...chord('E4', MIN, 8, 0.4, 0.7), ...chord('E4', MIN, 9.5, 0.3, 0.6),
        ...chord('D4', MAJ, 10.5, 0.5, 0.72),
        ...chord('A4', MAJ, 12.5, 0.4, 0.7), ...chord('B4', MAJ, 13.5, 0.4, 0.72),
        ...chord('E5', MIN, 14.5, 1.2, 0.78),
      ]),
    },
    {
      name: 'Acoustic Kit',
      instrumentId: 'drum-kit-acoustic',
      notes: [
        ...tile(
          [
            n(KICK, 0, 0.3, 0.95), n(KICK, 0.75, 0.3, 0.8), n(KICK, 2.5, 0.3, 0.9),
            n(SNARE, 1, 0.3, 0.86), n(SNARE, 3, 0.3, 0.86),
            n(SNARE, 1.75, 0.2, 0.38), n(SNARE, 2.75, 0.2, 0.4),
            n(HAT, 0, 0.15, 0.42), n(HAT, 0.5, 0.15, 0.34), n(HAT, 1, 0.15, 0.42),
            n(HAT, 1.5, 0.15, 0.34), n(HAT, 2, 0.15, 0.42), n(HAT, 2.5, 0.15, 0.34),
            n(HAT, 3, 0.15, 0.42), n(HAT, 3.5, 0.15, 0.34),
          ],
          8,
        ),
        // Bar-8 tom/snare fill into the turnaround.
        n(SNARE, 30, 0.2, 0.6), n(SNARE, 30.5, 0.2, 0.66), n(SNARE, 31, 0.2, 0.74),
        n(SNARE, 31.5, 0.2, 0.82), n(CRASH, 32 - 0.001, 0.3, 0.6),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 6. Cinematic — "Nocturne Rising"
// ---------------------------------------------------------------------------
// A building D-minor score: cinematic strings and cello swell under a soaring
// French-horn theme, punctuated by tuned timpani booms.

const nocturneRising: DubSpec = {
  id: 'cinematic-nocturne-rising',
  name: 'Nocturne Rising',
  description: 'A building minor film score: swelling strings, French horn and timpani booms.',
  genre: 'Cinematic',
  tempo: 84,
  tracks: [
    {
      name: 'Cinematic Strings',
      instrumentId: 'cinematic-strings',
      notes: [
        ...chord('D3', ADD_OCT, 0, 7.5, 0.5),
        ...chord('Bb2', MAJ, 8, 7.5, 0.56),
        ...chord('F2', MAJ, 16, 7.5, 0.62),
        ...chord('A2', DOM7, 24, 7.5, 0.68),
      ],
    },
    {
      name: 'Cello',
      instrumentId: 'cello',
      notes: [
        n('D2', 0, 3.5, 0.6), n('A2', 4, 3.5, 0.58),
        n('Bb1', 8, 3.5, 0.62), n('F2', 12, 3.5, 0.6),
        n('F1', 16, 3.5, 0.64), n('C2', 20, 3.5, 0.62),
        // Rising counter-line into the climax.
        n('A1', 24, 2, 0.66), n('C2', 26, 2, 0.68), n('E2', 28, 2, 0.72), n('A2', 30, 2, 0.76),
      ],
    },
    {
      name: 'French Horn',
      instrumentId: 'french-horn',
      // The theme rises from bar 5.
      notes: at(16, [
        n('D4', 0, 1.5, 0.6), n('E4', 1.5, 0.5, 0.58), n('F4', 2, 2, 0.66),
        n('A4', 4, 1.5, 0.7), n('G4', 5.5, 0.5, 0.62), n('F4', 6, 2, 0.66),
        n('A4', 8, 1, 0.72), n('D5', 9, 1.5, 0.78), n('C5', 10.5, 0.5, 0.66),
        n('Bb4', 11, 1, 0.7), n('A4', 12, 2, 0.72),
        n('F4', 14, 1, 0.66), n('A4', 15, 1, 0.74),
      ]),
    },
    {
      name: 'Timpani',
      instrumentId: 'timpani',
      notes: [
        n('D2', 0, 1, 0.8), n('D2', 8, 1, 0.78), n('F1', 16, 1, 0.82), n('A1', 24, 1, 0.84),
        // Accelerating roll into the final downbeat.
        n('D2', 28, 0.5, 0.6), n('D2', 29, 0.5, 0.66), n('A1', 30, 0.5, 0.72),
        n('D2', 30.75, 0.4, 0.78), n('D2', 31.5, 0.5, 0.88),
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const DUB_SPECS: DubSpec[] = [
  midnightTape,
  sunsetBoulevard,
  concreteJungle,
  weightlessDrift,
  pocketChange,
  nocturneRising,
]

/** The built-in house dubs, in gallery order. */
export const HOUSE_DUBS: SongTemplate[] = DUB_SPECS.map(toTemplate)
