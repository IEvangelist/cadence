/**
 * Text-prompt → musical parameters.
 *
 * A deliberately small, rule-based natural-language mapper: it scans a prompt
 * for mood, energy, register, density and key cues and distills them into
 * {@link MotifParams}. It is 100% deterministic (same prompt → same params) and
 * needs no model, so it runs instantly in the browser and is trivially testable.
 * Unknown prompts still produce musically valid params seeded from the text.
 */
import { hashString } from './rng'
import { type MotifParams, type ScaleId, PITCH_CLASSES, SCALES } from './types'

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** Words that imply a scale/mode. First match wins. */
const SCALE_HINTS: Array<{ words: readonly string[]; scale: ScaleId }> = [
  { words: ['dorian'], scale: 'dorian' },
  { words: ['mixolydian'], scale: 'mixolydian' },
  { words: ['pentatonic', 'folk'], scale: 'pentatonic' },
  { words: ['blues', 'bluesy'], scale: 'blues' },
  { words: ['minor', 'sad', 'dark', 'melancholy', 'somber', 'moody', 'tense'], scale: 'minor' },
  { words: ['major', 'happy', 'bright', 'uplifting', 'cheerful', 'sunny'], scale: 'major' },
  { words: ['jazz', 'jazzy', 'smooth', 'mellow'], scale: 'dorian' },
]

const HIGH_ENERGY = ['energetic', 'fast', 'intense', 'driving', 'powerful', 'epic', 'aggressive', 'frantic']
const LOW_ENERGY = ['calm', 'slow', 'gentle', 'soft', 'ambient', 'mellow', 'sparse', 'peaceful', 'dreamy']
const HIGH_REGISTER = ['high', 'bright', 'treble', 'sparkle', 'airy', 'soprano']
const LOW_REGISTER = ['low', 'deep', 'bass', 'sub', 'dark', 'heavy', 'rumbling']
const DENSE = ['busy', 'dense', 'fast', 'complex', 'frantic', 'rapid']
const SPARSE = ['sparse', 'minimal', 'slow', 'simple', 'spacious', 'ambient']

const hasAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((word) => haystack.includes(word))

const NOTE_LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

function pitchClassFromMatch(letter: string, accidental: string | undefined): number {
  let pc = NOTE_LETTERS[letter]
  if (accidental === '#' || accidental === 's') pc += 1
  else if (accidental === 'b') pc -= 1
  return ((pc % 12) + 12) % 12
}

/**
 * Parse an explicit key, but only when the text gives real musical context — a
 * note letter directly followed by a scale word ("d minor", "f# dorian") or the
 * phrase "key of X". This deliberately avoids matching stray note-letters inside
 * ordinary words (the "a" in "a bright melody" is not the key of A).
 */
function parseKey(normalized: string): number | null {
  const withScale =
    /\b([a-g])(#|b|s)?\s+(?:major|minor|dorian|mixolydian|pentatonic|blues)\b/.exec(normalized)
  if (withScale) return pitchClassFromMatch(withScale[1], withScale[2])

  const keyOf = /\bkey of\s+([a-g])(#|b|s)?\b/.exec(normalized)
  if (keyOf) return pitchClassFromMatch(keyOf[1], keyOf[2])

  return null
}

/**
 * Interpret a free-text prompt into deterministic {@link MotifParams}. The seed
 * is derived from the normalized prompt, so regenerating with the same words
 * reproduces the same motif.
 */
export function interpretPrompt(text: string): MotifParams {
  const normalized = text.trim().toLowerCase()
  const seed = hashString(normalized || 'cadence')

  const scale = SCALE_HINTS.find((hint) => hasAny(normalized, hint.words))?.scale ?? 'major'

  let energy = 0.5
  if (hasAny(normalized, HIGH_ENERGY)) energy += 0.3
  if (hasAny(normalized, LOW_ENERGY)) energy -= 0.3
  energy = clamp(energy, 0.1, 1)

  let octave = 4
  if (hasAny(normalized, HIGH_REGISTER)) octave = 5
  if (hasAny(normalized, LOW_REGISTER)) octave = 3

  let density = Math.round(1 + energy * 2) // 1–3 baseline from energy
  if (hasAny(normalized, DENSE)) density += 1
  if (hasAny(normalized, SPARSE)) density -= 1
  density = clamp(density, 1, 4)

  // Explicit key wins; otherwise pick a stable root from the seed.
  const root = parseKey(normalized) ?? seed % 12

  let lengthBeats = 8
  if (normalized.includes('short')) lengthBeats = 4
  if (normalized.includes('long')) lengthBeats = 16

  return { root, scale, octave, density, lengthBeats, energy, seed }
}

/** Human-readable key name for a {@link MotifParams} (e.g. "D minor"). */
export function describeParams(params: MotifParams): string {
  const scaleName = params.scale.charAt(0).toUpperCase() + params.scale.slice(1)
  return `${PITCH_CLASSES[params.root]} ${scaleName}`
}

/** Exposed for tests: the scale table is the source of truth for pitch sets. */
export const SUPPORTED_SCALES = Object.keys(SCALES) as ScaleId[]
