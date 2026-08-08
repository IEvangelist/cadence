/**
 * Pure, model-agnostic assembly of a MusicRNN generation into composer notes.
 *
 * This is the worker↔Magenta contract, extracted from the Web Worker so it can
 * be unit-tested with a stub model (the real worker downloads checkpoints and
 * can't run under jsdom). Keeping it pure also documents the single most
 * error-prone fact about Magenta's `continueSequence`:
 *
 *   `continueSequence(primer, steps, temperature)` returns ONLY the generated
 *   continuation, indexed from step 0 — the primer/seed is NOT included in the
 *   output.
 *
 * So for `continue` we anchor the whole output at the *end* of the seed, and for
 * `generate`/empty-seed we anchor the whole output at the region origin. We must
 * never filter the output by the seed length (that drops every real note).
 */
import {
  type NoteSequence,
  noteSequenceToNotes,
  notesToNoteSequence,
  beatsToSteps,
  stepsToBeats,
} from './noteSequence'
import type { AssistantAction, AssistantParams, SuggestedNote } from './types'

/** Structural subset of Magenta's `MusicRNN` used by the worker + tests. */
export interface MusicRNNLike {
  initialize(): Promise<void>
  continueSequence(
    sequence: NoteSequence,
    steps: number,
    temperature?: number,
  ): Promise<NoteSequence>
  isInitialized(): boolean
  dispose(): void
}

export interface GenerateRequest {
  action: AssistantAction
  seedNotes: SuggestedNote[]
  regionStart: number
  tempo: number
  params: AssistantParams
}

/** Absolute beat where the seed notes end (or a fallback when there are none). */
function seedEnd(notes: SuggestedNote[], fallback: number): number {
  if (notes.length === 0) return fallback
  return Math.max(...notes.map((n) => n.start + n.duration))
}

/**
 * Run the model and place its output at the correct absolute beat position.
 * `rnn` is injected so this can be tested with a deterministic stub.
 */
export async function generateNotes(
  rnn: MusicRNNLike,
  request: GenerateRequest,
): Promise<SuggestedNote[]> {
  const steps = Math.max(1, beatsToSteps(Math.round(request.params.lengthBeats)))
  const temperature = request.params.temperature

  if (request.action === 'generate' || request.seedNotes.length === 0) {
    // Prime with a single tonic note at the region origin. The output is the
    // continuation only, indexed from step 0, so anchor it AT the origin —
    // keeping the first generated note (never drop step 0).
    const origin =
      request.action === 'generate'
        ? request.regionStart
        : seedEnd(request.seedNotes, request.regionStart)
    const seed = notesToNoteSequence(
      [{ pitch: 60, start: origin, duration: 0.25, velocity: 0.8 }],
      { originBeats: origin, tempo: request.tempo },
    )
    const out = await rnn.continueSequence(seed, steps, temperature)
    return noteSequenceToNotes(out, { originBeats: origin })
  }

  // continue: the output is the tail only (indexed from step 0), so anchor it at
  // the seed's END. Do NOT filter by seed length — that would drop the whole
  // continuation whenever it is no longer than the seed (the common case).
  const origin = Math.min(...request.seedNotes.map((n) => n.start))
  const seedSeq = notesToNoteSequence(request.seedNotes, {
    originBeats: origin,
    tempo: request.tempo,
  })
  const tailStartBeats = origin + stepsToBeats(seedSeq.totalQuantizedSteps)
  const out = await rnn.continueSequence(seedSeq, steps, temperature)
  return noteSequenceToNotes(out, { originBeats: tailStartBeats })
}
