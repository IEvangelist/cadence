/**
 * Locks the worker↔Magenta contract: `MusicRNN.continueSequence` returns ONLY
 * the generated continuation, indexed from step 0 (the primer is NOT included).
 * The stub below mirrors that exactly, so these tests fail if the assembly ever
 * regresses to the old (broken) "filter by seed length" behaviour.
 */
import { describe, expect, it, vi } from 'vitest'
import { generateNotes, type MusicRNNLike, type GenerateRequest } from './generation'
import { STEPS_PER_QUARTER, type NoteSequence } from './noteSequence'
import { DEFAULT_PARAMS } from './types'

/**
 * A stub that behaves like real Magenta: it ignores the primer and returns a
 * fresh continuation whose notes are indexed from step 0. `spy` records the
 * `steps` argument so we can assert length plumbing.
 */
function makeStubRnn(spy?: (steps: number) => void): MusicRNNLike {
  return {
    initialize: vi.fn(async () => {}),
    isInitialized: () => true,
    dispose: vi.fn(),
    continueSequence: vi.fn(async (_seq: NoteSequence, steps: number): Promise<NoteSequence> => {
      spy?.(steps)
      // Three notes at steps 0, 4, 8 — indexed from 0, primer absent.
      const notes = [0, 4, 8].map((s) => ({
        pitch: 67,
        quantizedStartStep: s,
        quantizedEndStep: s + 2,
        velocity: 100,
      }))
      return {
        notes,
        quantizationInfo: { stepsPerQuarter: STEPS_PER_QUARTER },
        totalQuantizedSteps: steps,
      }
    }),
  }
}

const baseRequest = (overrides: Partial<GenerateRequest>): GenerateRequest => ({
  action: 'continue',
  seedNotes: [],
  regionStart: 0,
  tempo: 120,
  params: { ...DEFAULT_PARAMS },
  ...overrides,
})

describe('generateNotes (worker↔Magenta contract)', () => {
  it('continue: places the continuation AFTER the seed, never filtered to empty', async () => {
    // Seed spans beats 0..2 → 8 quantized steps (the exact case the old bug
    // filtered away, because the continuation is not longer than the seed).
    const seedNotes = [
      { pitch: 60, start: 0, duration: 1, velocity: 0.8 },
      { pitch: 64, start: 1, duration: 1, velocity: 0.8 },
    ]
    const notes = await generateNotes(
      makeStubRnn(),
      baseRequest({ action: 'continue', seedNotes, params: { temperature: 1, lengthBeats: 2 } }),
    )

    expect(notes).toHaveLength(3) // nothing filtered out
    const starts = notes.map((n) => n.start)
    // Seed ends at beat 2; the tail must begin exactly there, never on top of it.
    expect(Math.min(...starts)).toBe(2)
    expect(starts.every((s) => s >= 2)).toBe(true)
    // Steps 0,4,8 → beats 0,1,2 → anchored at 2 → 2,3,4.
    expect(starts.sort((a, b) => a - b)).toEqual([2, 3, 4])
  })

  it('continue: seed offset from origin still anchors the tail at the seed end', async () => {
    const seedNotes = [{ pitch: 60, start: 4, duration: 2, velocity: 0.8 }]
    const notes = await generateNotes(
      makeStubRnn(),
      baseRequest({ action: 'continue', seedNotes, params: { temperature: 1, lengthBeats: 4 } }),
    )
    // Seed at beats 4..6 → tail starts at beat 6.
    expect(Math.min(...notes.map((n) => n.start))).toBe(6)
  })

  it('generate: keeps the first generated note, anchored at the region origin', async () => {
    const notes = await generateNotes(
      makeStubRnn(),
      baseRequest({ action: 'generate', seedNotes: [], regionStart: 8, params: { temperature: 1, lengthBeats: 4 } }),
    )

    expect(notes).toHaveLength(3) // first note (step 0) NOT dropped
    const starts = notes.map((n) => n.start).sort((a, b) => a - b)
    // Steps 0,4,8 anchored at regionStart 8 → 8,9,10.
    expect(starts[0]).toBe(8)
    expect(starts).toEqual([8, 9, 10])
  })

  it('continue with an empty seed falls back to generating from the region start', async () => {
    const notes = await generateNotes(
      makeStubRnn(),
      baseRequest({ action: 'continue', seedNotes: [], regionStart: 12, params: { temperature: 1, lengthBeats: 4 } }),
    )
    expect(notes).toHaveLength(3)
    expect(Math.min(...notes.map((n) => n.start))).toBe(12)
  })

  it('passes the requested length through to the model as steps', async () => {
    const seen: number[] = []
    await generateNotes(
      makeStubRnn((steps) => seen.push(steps)),
      baseRequest({ action: 'generate', seedNotes: [], params: { temperature: 1, lengthBeats: 4 } }),
    )
    // 4 beats × 4 steps/quarter = 16 steps.
    expect(seen).toEqual([16])
  })
})
