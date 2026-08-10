/**
 * Types + musical constants for the expanded-AI feature set (effort #45).
 *
 * These features build on the base {@link CompositionAssistant} (continue /
 * generate / harmonize) with four new, self-contained capabilities that operate
 * purely on the composer's own note vocabulary — no new model runtime, no
 * TensorFlow upgrade. Everything here is plain data so it round-trips through the
 * reducer's sanitizer and is trivially testable.
 */
import type { SuggestedNote } from '../types'
import type { MasteringSuggestion } from '../../contract/ai'

export type { SuggestedNote }

/**
 * The contract-typed mastering directive re-exported for convenience. Auto-master
 * emits this shape (master/limiter/per-track gain) and it targets the mixer
 * overlay in `contract/mixing.ts` — see {@link MasteringReport}. We consume the
 * published contract type rather than forking a parallel one.
 */
export type { MasteringSuggestion }

/** The four expanded-AI capabilities surfaced in the AI Studio panel. */
export type AiFeatureId = 'text-to-motif' | 'style-transfer' | 'groove' | 'auto-master'

/** A diatonic scale/mode, expressed as semitone offsets from a root. */
export type ScaleId = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'pentatonic' | 'blues'

/** Semitone patterns (one octave) for every supported {@link ScaleId}. */
export const SCALES: Record<ScaleId, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
}

/** Pitch-class names, index 0 = C, used to name/parse keys. */
export const PITCH_CLASSES = [
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

/**
 * Musical parameters distilled from a text prompt. Deterministic: the same
 * prompt always yields the same params (see {@link interpretPrompt}).
 */
export interface MotifParams {
  /** Root pitch class 0–11 (0 = C). */
  root: number
  /** Scale/mode the motif is built from. */
  scale: ScaleId
  /** Base MIDI octave for the motif's centre (e.g. 4 ≈ middle C). */
  octave: number
  /** Rhythmic activity, 1 (sparse) … 4 (busy) notes per beat on average. */
  density: number
  /** Total length in beats. */
  lengthBeats: number
  /** 0–1 energy: drives velocity and how adventurous the contour is. */
  energy: number
  /** Seed derived from the prompt for reproducible generation. */
  seed: number
}

/** Bounds for the motif length control (beats). */
export const MOTIF_LENGTH_RANGE = { min: 2, max: 32, step: 1 } as const

/** A named musical style the Style Transfer feature can impose. */
export interface StyleDefinition {
  id: StyleId
  name: string
  /** One-line description shown in the UI. */
  description: string
}

export type StyleId = 'lofi' | 'jazz-swing' | 'cinematic' | 'edm'

/** Groove/humanize parameters. All 0–1; `seed` makes jitter reproducible. */
export interface GrooveParams {
  /** Swing amount applied to off-beat notes (0 = straight, 1 = triplet feel). */
  swing: number
  /** Timing humanization: max random start jitter as a fraction of a beat. */
  humanizeTiming: number
  /** Velocity humanization: max random velocity jitter (0–1). */
  humanizeVelocity: number
  /** Seed for reproducible jitter. */
  seed: number
}

/** A named groove preset (a canned {@link GrooveParams} minus the seed). */
export interface GroovePreset {
  id: GroovePresetId
  name: string
  description: string
  swing: number
  humanizeTiming: number
  humanizeVelocity: number
}

export type GroovePresetId = 'tight' | 'swing-8' | 'swing-16' | 'human' | 'loose'

/** Severity of a single mastering advisory. */
export type MasteringSeverity = 'info' | 'suggestion' | 'warning'

/**
 * One human-readable auto-mastering advisory shown in the panel. This is the
 * plain-language companion to the contract {@link MasteringSuggestion} mix
 * directive: the advisory explains *why*, the suggestion carries the *numbers*.
 */
export interface MasteringAdvisory {
  id: string
  title: string
  detail: string
  severity: MasteringSeverity
}

/** Numeric mix metrics that back the suggestions (all derived, no audio). */
export interface MixMetrics {
  trackCount: number
  noteCount: number
  /** Mean normalized velocity across all notes (0–1), 0 when silent. */
  averageVelocity: number
  /** Peak normalized velocity (0–1). */
  peakVelocity: number
  /** Velocity spread = peak − min (0–1); a proxy for dynamic range. */
  dynamicRange: number
  /** Lowest / highest sounding MIDI pitch (0 when silent). */
  lowestPitch: number
  highestPitch: number
  /** Max simultaneously sounding notes — a headroom/clipping proxy. */
  maxConcurrent: number
  /** Fraction of notes below the bass threshold (0–1). */
  lowEndShare: number
}

/** The full auto-mastering report. */
export interface MasteringReport {
  metrics: MixMetrics
  /**
   * The contract-typed mix directive (master gain, limiter ceiling and
   * per-track gain) that auto-master emits. It targets the mixer overlay in
   * `contract/mixing.ts` — the mixer is its intended consumer.
   */
  suggestion: MasteringSuggestion
  /** Plain-language advisories that explain the directive to the musician. */
  advisories: MasteringAdvisory[]
  /** Short human summary line. */
  summary: string
}
