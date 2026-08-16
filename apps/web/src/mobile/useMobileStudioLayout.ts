import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 40rem), (pointer: coarse)'

function subscribe(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY).matches
    : false
}

export function useMobileStudioLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
