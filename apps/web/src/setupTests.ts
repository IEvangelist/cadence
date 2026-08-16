import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Default network stub: unauthenticated. Components that mount the real
// AuthProvider (e.g. <App />) resolve to the anonymous state without touching
// the network. Tests that need specific responses inject their own client or
// call vi.stubGlobal('fetch', ...) before rendering.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 401 })),
  )
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})
