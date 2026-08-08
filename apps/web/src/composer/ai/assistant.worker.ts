/**
 * Assistant Web Worker — runs Magenta inference off the main thread.
 *
 * The heavy libraries (`@tensorflow/tfjs`, `@magenta/music`) are imported
 * *dynamically inside the worker*, so Vite emits them as a separate worker
 * chunk that is fetched only when the user first generates — never in the main
 * SPA bundle. Model checkpoints are downloaded from Magenta's public storage on
 * first use and cached by the browser.
 *
 * Protocol (main ⇄ worker):
 *   → { type: 'generate', id, request }   start a job
 *   → { type: 'cancel', id }              cooperative cancel (worker also gets terminated)
 *   ← { type: 'progress', id, progress }  phase updates
 *   ← { type: 'result', id, notes }       success
 *   ← { type: 'error', id, message, name} failure/abort
 */
/// <reference lib="webworker" />
import {
  generateNotes,
  type GenerateRequest,
  type MusicRNNLike,
} from './generation'
import type { SuggestedNote } from './types'

/** Melody model checkpoint (basic RNN) hosted by Magenta. */
const MELODY_CHECKPOINT =
  'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/basic_rnn'

interface GenerateMessage {
  type: 'generate'
  id: number
  request: GenerateRequest
}
interface CancelMessage {
  type: 'cancel'
  id: number
}
type InboundMessage = GenerateMessage | CancelMessage

const ctx = self as unknown as DedicatedWorkerGlobalScope

// A handful of Magenta modules read `window`; in a worker there is none, so
// point it at the worker global before Magenta is imported.
if (typeof (ctx as unknown as { window?: unknown }).window === 'undefined') {
  ;(ctx as unknown as { window: unknown }).window = ctx
}

let model: MusicRNNLike | null = null
const cancelled = new Set<number>()

async function getModel(): Promise<MusicRNNLike> {
  if (model && model.isInitialized()) return model
  const tf = await import('@tensorflow/tfjs')
  // The CPU backend is bundled with the tfjs metapackage and works in a worker
  // (WebGL needs an OffscreenCanvas that isn't reliably available here).
  await tf.setBackend('cpu')
  await tf.ready()
  const { MusicRNN } = await import('@magenta/music/esm/music_rnn')
  const rnn = new MusicRNN(MELODY_CHECKPOINT) as unknown as MusicRNNLike
  await rnn.initialize()
  model = rnn
  return rnn
}

/** Load the model (if needed), then delegate assembly to the pure core. */
async function runGenerate(id: number, request: GenerateRequest): Promise<SuggestedNote[]> {
  const post = (progress: { phase: string; fraction?: number; message?: string }): void =>
    ctx.postMessage({ type: 'progress', id, progress })

  post({ phase: 'loading-model', message: 'Loading model…' })
  const rnn = await getModel()
  if (cancelled.has(id)) throw abortError()

  post({ phase: 'generating', message: 'Composing…' })

  const notes = await generateNotes(rnn, request)
  if (cancelled.has(id)) throw abortError()
  return notes
}

function abortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

ctx.addEventListener('message', (event: MessageEvent<InboundMessage>) => {
  const data = event.data
  if (data.type === 'cancel') {
    cancelled.add(data.id)
    return
  }
  if (data.type === 'generate') {
    const { id, request } = data
    runGenerate(id, request)
      .then((notes) => {
        if (cancelled.has(id)) return
        ctx.postMessage({ type: 'result', id, notes })
      })
      .catch((error: unknown) => {
        const err = error as Error
        ctx.postMessage({
          type: 'error',
          id,
          message: err?.message ?? 'Generation failed',
          name: err?.name ?? 'Error',
        })
      })
      .finally(() => cancelled.delete(id))
  }
})

export {}
