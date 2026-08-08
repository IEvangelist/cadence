/**
 * Composition-assistant contracts.
 *
 * This is the extensibility seam for the hybrid-AI plan (docs/plan.md): every
 * assistant — the in-browser Magenta provider shipped now, and a server-side
 * premium provider added later (effort #8) — implements the same
 * {@link CompositionAssistant} interface. The UI talks only to this interface,
 * so a new provider can be dropped in without touching a single component.
 *
 * All types here are plain data in the composer's own vocabulary (beats,
 * MIDI pitch, normalized velocity). The Magenta-specific `NoteSequence` shape
 * lives in `noteSequence.ts`; providers convert at their own boundary.
 */

/** The three assistant actions offered in the UI. */
export type AssistantAction = 'continue' | 'generate' | 'harmonize'

/** A note produced by an assistant, in the composer's units (no id yet). */
export interface SuggestedNote {
  /** MIDI note number (0–127). */
  pitch: number
  /** Start position in beats (quarter notes) from the timeline origin. */
  start: number
  /** Length in beats (> 0). */
  duration: number
  /** Normalized velocity 0–1. */
  velocity: number
}

/** Tunable generation parameters surfaced in the UI. */
export interface AssistantParams {
  /**
   * Sampling temperature. Higher = more adventurous/random, lower = more
   * predictable. Typical range 0.1–2.0.
   */
  temperature: number
  /** How many beats of material to produce. */
  lengthBeats: number
}

/** Sensible defaults for a first click. */
export const DEFAULT_PARAMS: AssistantParams = {
  temperature: 1.0,
  lengthBeats: 8,
}

/** Bounds enforced by the UI controls and clamped by providers. */
export const TEMPERATURE_RANGE = { min: 0.1, max: 2.0, step: 0.1 } as const
export const LENGTH_RANGE = { min: 1, max: 32, step: 1 } as const

/**
 * A unit of work handed to a provider. `seedNotes` is the existing musical
 * context (the selected track's notes, or the notes inside the target region);
 * `regionStart` anchors where produced notes should land on the timeline.
 */
export interface AssistantRequest {
  action: AssistantAction
  /** Existing notes that give the model context (may be empty for `generate`). */
  seedNotes: SuggestedNote[]
  /** Beat position where generated material should begin. */
  regionStart: number
  /** Tempo in BPM (drives seconds↔beats where a provider needs it). */
  tempo: number
  params: AssistantParams
  /** Cooperative cancellation — providers should abort when this fires. */
  signal?: AbortSignal
}

/** The result of a generation: notes to preview, plus a short human label. */
export interface AssistantSuggestion {
  action: AssistantAction
  notes: SuggestedNote[]
  /** e.g. "Continued 8 beats" — shown in the panel status. */
  label: string
}

/** Coarse progress phases reported while a provider works. */
export type AssistantPhase = 'idle' | 'loading-model' | 'generating' | 'done' | 'error'

export interface AssistantProgress {
  phase: AssistantPhase
  /** 0–1 when known (e.g. model download), otherwise omitted. */
  fraction?: number
  message?: string
}

/**
 * The provider contract. Implementations must be safe to construct eagerly
 * (no network, no heavy imports in the constructor) so the UI can hold one
 * without paying for the AI libraries until the user actually generates.
 */
export interface CompositionAssistant {
  /** Stable id, e.g. `magenta` or `premium` — handy for diagnostics/telemetry. */
  readonly id: string
  /** Actions this provider can service. */
  readonly capabilities: readonly AssistantAction[]
  /**
   * Produce a suggestion for the request. Rejects with an {@link Error} on
   * failure and with an `AbortError` when `request.signal` is aborted.
   */
  generate(
    request: AssistantRequest,
    onProgress?: (progress: AssistantProgress) => void,
  ): Promise<AssistantSuggestion>
  /** Release any workers/models. Idempotent. */
  dispose?(): void
}

/** True when `error` is an abort (cancelled generation), not a real failure. */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'aborted')
  )
}
