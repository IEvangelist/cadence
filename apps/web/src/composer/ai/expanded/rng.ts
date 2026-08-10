/**
 * Tiny, dependency-free deterministic randomness.
 *
 * The expanded-AI features (text→motif, groove humanization) need *reproducible*
 * variation: the same prompt or seed must always yield the same music so results
 * are testable and a user can re-run and get the same idea. We therefore avoid
 * `Math.random()` entirely and derive every "random" choice from a seed via a
 * small PRNG. No TensorFlow, no model download — this is pure arithmetic.
 */

/**
 * FNV-1a 32-bit string hash → unsigned 32-bit int. Stable across platforms and
 * runs (unlike `Math.random`), so a text prompt maps to a fixed seed.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    // 32-bit FNV prime multiply via Math.imul to stay in int range.
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * mulberry32: a fast, well-distributed seeded PRNG. Returns a function that
 * yields floats in [0, 1). Deterministic for a given seed.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer in [min, max] inclusive, drawn from a `mulberry32` stream. */
export function randInt(next: () => number, min: number, max: number): number {
  if (max <= min) return min
  return min + Math.floor(next() * (max - min + 1))
}

/** Pick a member of `items` from a `mulberry32` stream (never empty input). */
export function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length) % items.length]
}
