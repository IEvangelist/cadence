/**
 * In-browser Magenta provider.
 *
 * Implements {@link CompositionAssistant} for the free/basic tier. Melody
 * actions (`continue`, `generate`) are delegated to a Web Worker running
 * Magenta's MusicRNN so inference never blocks the UI; `harmonize` is computed
 * in-process from music theory (no checkpoint download). The constructor is
 * intentionally cheap — the worker (and therefore tfjs/magenta) is created on
 * the first melody generation, keeping the base app lightweight.
 *
 * This is the client-side half of the hybrid-AI seam: a server-side premium
 * provider (effort #8) can implement the same interface without any UI change.
 */
import { harmonize } from './harmony'
import type {
  AssistantProgress,
  AssistantRequest,
  AssistantSuggestion,
  CompositionAssistant,
  SuggestedNote,
} from './types'

interface WorkerResultMessage {
  type: 'result'
  id: number
  notes: SuggestedNote[]
}
interface WorkerProgressMessage {
  type: 'progress'
  id: number
  progress: AssistantProgress
}
interface WorkerErrorMessage {
  type: 'error'
  id: number
  message: string
  name: string
}
type WorkerMessage = WorkerResultMessage | WorkerProgressMessage | WorkerErrorMessage

export class MagentaAssistant implements CompositionAssistant {
  readonly id = 'magenta'
  readonly capabilities = ['continue', 'generate', 'harmonize'] as const

  private worker: Worker | null = null
  private nextId = 1

  async generate(
    request: AssistantRequest,
    onProgress?: (progress: AssistantProgress) => void,
  ): Promise<AssistantSuggestion> {
    if (request.action === 'harmonize') {
      // Pure, instant, offline — no model needed.
      onProgress?.({ phase: 'generating' })
      const notes = harmonize(request.seedNotes)
      onProgress?.({ phase: 'done' })
      return { action: 'harmonize', notes, label: this.label('harmonize', notes.length) }
    }

    const worker = this.ensureWorker()
    const id = this.nextId++

    const notes = await new Promise<SuggestedNote[]>((resolve, reject) => {
      const onAbort = (): void => {
        worker.postMessage({ type: 'cancel', id })
        cleanup()
        reject(this.abortError())
      }
      const onMessage = (event: MessageEvent<WorkerMessage>): void => {
        const data = event.data
        if (data.id !== id) return
        if (data.type === 'progress') {
          onProgress?.(data.progress)
        } else if (data.type === 'result') {
          cleanup()
          resolve(data.notes)
        } else if (data.type === 'error') {
          cleanup()
          reject(this.errorFrom(data))
        }
      }
      const cleanup = (): void => {
        worker.removeEventListener('message', onMessage)
        request.signal?.removeEventListener('abort', onAbort)
      }

      if (request.signal?.aborted) {
        onAbort()
        return
      }
      request.signal?.addEventListener('abort', onAbort)
      worker.addEventListener('message', onMessage)
      worker.postMessage({
        type: 'generate',
        id,
        request: {
          action: request.action,
          seedNotes: request.seedNotes,
          regionStart: request.regionStart,
          tempo: request.tempo,
          params: request.params,
        },
      })
    })

    onProgress?.({ phase: 'done' })
    return { action: request.action, notes, label: this.label(request.action, notes.length) }
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./assistant.worker.ts', import.meta.url), {
        type: 'module',
      })
    }
    return this.worker
  }

  private label(action: AssistantRequest['action'], count: number): string {
    switch (action) {
      case 'harmonize':
        return `Harmonized ${count} chord note${count === 1 ? '' : 's'}`
      case 'generate':
        return `Generated ${count} notes`
      case 'continue':
      default:
        return `Continued ${count} notes`
    }
  }

  private abortError(): Error {
    const error = new Error('aborted')
    error.name = 'AbortError'
    return error
  }

  private errorFrom(data: WorkerErrorMessage): Error {
    const error = new Error(data.message)
    error.name = data.name
    return error
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
  }
}
