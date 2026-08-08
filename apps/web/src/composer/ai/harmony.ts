/**
 * Theory-based chord harmonization.
 *
 * The melody-oriented Magenta models (MusicRNN) drive `continue`/`generate`;
 * `harmonize` instead derives diatonic triads directly from the melody with a
 * tiny, deterministic music-theory pass. That keeps chord suggestions offline
 * and instant (no extra checkpoint download) while still fitting the same
 * {@link CompositionAssistant} pipeline. A future premium provider can replace
 * this with a learned chord model behind the identical interface.
 */
import type { SuggestedNote } from './types'

/** Semitone offsets of the major scale from its tonic. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]

/** Scale-degree → triad quality is implicit in the diatonic stack of thirds. */
const ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] as const

/** MIDI pitch of the root octave chords are voiced in (C3). */
const CHORD_OCTAVE_BASE = 48

export interface DiatonicTriad {
  /** Roman-numeral label, e.g. "IV". */
  roman: string
  /** The three chord-tone pitch classes (0–11). */
  pitchClasses: [number, number, number]
  /** Scale degree, 0 = tonic. */
  degree: number
}

const mod12 = (n: number): number => ((n % 12) + 12) % 12

/** The seven diatonic triads of the major key rooted at `tonic` (0–11). */
export function diatonicTriads(tonic: number): DiatonicTriad[] {
  return MAJOR_SCALE.map((_, degree) => {
    const root = MAJOR_SCALE[degree]
    const third = MAJOR_SCALE[(degree + 2) % 7]
    const fifth = MAJOR_SCALE[(degree + 4) % 7]
    return {
      roman: ROMAN[degree],
      degree,
      pitchClasses: [mod12(tonic + root), mod12(tonic + third), mod12(tonic + fifth)],
    }
  })
}

/**
 * Estimate the major key of a melody by correlating its (duration-weighted)
 * pitch-class histogram against every major scale, with a bonus for landing the
 * tonic and dominant. Returns the tonic pitch class (0–11).
 */
export function estimateKey(notes: readonly SuggestedNote[]): number {
  const weight = new Array<number>(12).fill(0)
  for (const note of notes) {
    weight[mod12(note.pitch)] += Math.max(note.duration, 0.25)
  }

  let bestTonic = 0
  let bestScore = -Infinity
  for (let tonic = 0; tonic < 12; tonic += 1) {
    const inScale = new Set(MAJOR_SCALE.map((s) => mod12(tonic + s)))
    let score = 0
    for (let pc = 0; pc < 12; pc += 1) {
      if (inScale.has(pc)) score += weight[pc]
    }
    // Prefer keys whose tonic (×1.5) and dominant (×1.2) carry real weight.
    score += weight[tonic] * 0.5 + weight[mod12(tonic + 7)] * 0.2
    if (score > bestScore) {
      bestScore = score
      bestTonic = tonic
    }
  }
  return bestTonic
}

/** Pitch classes of the melody notes sounding within `[start, end)` beats. */
function pitchClassesInRange(
  notes: readonly SuggestedNote[],
  start: number,
  end: number,
): number[] {
  return notes
    .filter((n) => n.start < end && n.start + n.duration > start)
    .map((n) => mod12(n.pitch))
}

/** Choose the diatonic triad whose tones best cover the segment's melody. */
function chooseTriad(triads: DiatonicTriad[], melodyPcs: number[]): DiatonicTriad {
  // Common-practice preference order breaks ties toward the strong functions.
  const preference = [0, 4, 3, 5, 1, 2, 6] // I, V, IV, vi, ii, iii, vii°
  let best = triads[0]
  let bestScore = -Infinity
  for (const triad of triads) {
    const tones = new Set(triad.pitchClasses)
    const overlap = melodyPcs.reduce((acc, pc) => acc + (tones.has(pc) ? 1 : 0), 0)
    const tieBreak = -preference.indexOf(triad.degree)
    const score = overlap * 10 + tieBreak
    if (score > bestScore) {
      bestScore = score
      best = triad
    }
  }
  return best
}

/** Voice a triad's pitch classes as MIDI notes just above {@link CHORD_OCTAVE_BASE}. */
function voiceTriad(triad: DiatonicTriad): number[] {
  const [root, third, fifth] = triad.pitchClasses
  const rootMidi = CHORD_OCTAVE_BASE + root
  // Keep the stack ascending so it reads as a close-position chord.
  const thirdMidi = rootMidi + mod12(third - root)
  const fifthMidi = rootMidi + mod12(fifth - root)
  return [rootMidi, thirdMidi, fifthMidi]
}

export interface HarmonizeOptions {
  /** Chord rhythm: one triad every N beats (default one per bar). */
  beatsPerChord?: number
  /** Velocity for the chord notes (0–1). */
  velocity?: number
}

/**
 * Harmonize a melody with a diatonic triad per `beatsPerChord`-beat segment.
 * Returns chord notes spanning the melody's extent; an empty melody yields no
 * chords. Output notes are always valid (in-range pitch, positive duration).
 */
export function harmonize(
  notes: readonly SuggestedNote[],
  options: HarmonizeOptions = {},
): SuggestedNote[] {
  if (notes.length === 0) return []

  const beatsPerChord = options.beatsPerChord ?? 4
  const velocity = options.velocity ?? 0.55

  const tonic = estimateKey(notes)
  const triads = diatonicTriads(tonic)

  const rangeStart = Math.min(...notes.map((n) => n.start))
  const rangeEnd = Math.max(...notes.map((n) => n.start + n.duration))
  // Snap the first chord to the bar the melody starts in.
  const firstChord = Math.floor(rangeStart / beatsPerChord) * beatsPerChord

  const chords: SuggestedNote[] = []
  for (let start = firstChord; start < rangeEnd; start += beatsPerChord) {
    const end = start + beatsPerChord
    const melodyPcs = pitchClassesInRange(notes, start, end)
    // Segments with no melody borrow the previous chord's context via the tonic.
    const triad = chooseTriad(triads, melodyPcs.length > 0 ? melodyPcs : triads[0].pitchClasses)
    for (const pitch of voiceTriad(triad)) {
      chords.push({ pitch, start, duration: beatsPerChord, velocity })
    }
  }
  return chords
}
