export type InstrumentLoadState = 'idle' | 'loading' | 'ready' | 'error'

const lazyInstrumentIds = new Set<string>()
const states = new Map<string, InstrumentLoadState>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function registerLazyInstrument(id: string): void {
  lazyInstrumentIds.add(id)
}

export function setInstrumentLoadState(id: string, state: InstrumentLoadState): void {
  if (states.get(id) === state) return
  states.set(id, state)
  emit()
}

export function getInstrumentLoadState(id: string): InstrumentLoadState {
  return states.get(id) ?? (lazyInstrumentIds.has(id) ? 'idle' : 'ready')
}

export function subscribeInstrumentLoadState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

