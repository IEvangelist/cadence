/**
 * Deterministic, dependency-free assistant provider.
 *
 * Used by the e2e suite and unit tests (and as an offline fallback) so the
 * generate → preview → accept flow can be exercised without downloading a
 * Magenta checkpoint or touching the network. It produces musically-plausible
 * output with simple rules, honouring the same {@link CompositionAssistant}
 * contract as the real Magenta provider.
 */
import { harmonize } from './harmony'
import type {
  AssistantProgress,
  AssistantRequest,
  AssistantSuggestion,
  CompositionAssistant,
  SuggestedNote,
} from './types'
import { isAbortError } from './types'

/** C-major scale degrees (semitones) used to keep generated notes diatonic. */
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]

const mod = (n: number, m: number): number => ((n % m) + m) % m

/** Snap a MIDI pitch to the nearest C-major scale tone. */
function snapToScale(pitch: number): number {
  const pc = mod(pitch, 12)
  let best = MAJOR_STEPS[0]
  let bestDist = Infinity
  for (const step of MAJOR_STEPS) {
    const dist = Math.min(mod(pc - step, 12), mod(step - pc, 12))
    if (dist < bestDist) {
      bestDist = dist
      best = step
    }
  }
  return pitch - pc + best
}

/**
 * A tiny deterministic "melody" walk: alternating step up/down along the scale,
 * seeded by the last pitch so continuations feel connected to the input.
 */
function walk(seedPitch: number, count: number, startBeat: number, velocity: number): SuggestedNote[] {
  const notes: SuggestedNote[] = []
  let pitch = snapToScale(seedPitch)
  let idx = MAJOR_STEPS.indexOf(mod(pitch, 12))
  const base = pitch - mod(pitch, 12)
  for (let i = 0; i < count; i += 1) {
    // Deterministic zig-zag: +2, -1, +2, -1 … scale degrees.
    idx += i % 2 === 0 ? 2 : -1
    const octaveShift = Math.floor(idx / MAJOR_STEPS.length) * 12
    pitch = base + octaveShift + MAJOR_STEPS[mod(idx, MAJOR_STEPS.length)]
    notes.push({
      pitch: Math.min(96, Math.max(36, pitch)),
      start: startBeat + i,
      duration: 1,
      velocity,
    })
  }
  return notes
}

export class MockAssistant implements CompositionAssistant {
  readonly id = 'mock'
  readonly capabilities = ['continue', 'generate', 'harmonize'] as const

  async generate(
    request: AssistantRequest,
    onProgress?: (progress: AssistantProgress) => void,
  ): Promise<AssistantSuggestion> {
    const emit = (p: AssistantProgress): void => onProgress?.(p)
    emit({ phase: 'loading-model', fraction: 1, message: 'Mock model ready' })
    // A microtask so callers can observe the loading→generating transition.
    await Promise.resolve()
    this.throwIfAborted(request.signal)
    emit({ phase: 'generating', message: 'Generating…' })

    const notes = this.run(request)

    this.throwIfAborted(request.signal)
    emit({ phase: 'done' })
    return {
      action: request.action,
      notes,
      label: this.labelFor(request, notes.length),
    }
  }

  private run(request: AssistantRequest): SuggestedNote[] {
    const beats = Math.max(1, Math.round(request.params.lengthBeats))
    switch (request.action) {
      case 'harmonize':
        return harmonize(request.seedNotes)
      case 'generate': {
        // No seed: start a scale walk from middle C at the region origin.
        return walk(60, beats, request.regionStart, 0.8)
      }
      case 'continue':
      default: {
        const last = request.seedNotes[request.seedNotes.length - 1]
        const seedPitch = last?.pitch ?? 60
        const startBeat = last ? last.start + last.duration : request.regionStart
        return walk(seedPitch, beats, startBeat, 0.75)
      }
    }
  }

  private labelFor(request: AssistantRequest, count: number): string {
    switch (request.action) {
      case 'harmonize':
        return `Harmonized ${count} chord note${count === 1 ? '' : 's'}`
      case 'generate':
        return `Generated ${count} notes`
      case 'continue':
      default:
        return `Continued ${count} notes`
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    }
  }
}

export { isAbortError }
