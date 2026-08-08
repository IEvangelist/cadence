import { afterEach, describe, expect, it } from 'vitest'
import { createAssistant, shouldUseMock } from './provider'

afterEach(() => {
  delete window.__CADENCE_AI_MOCK__
})

describe('provider factory', () => {
  it('reports mock usage from the window flag', () => {
    expect(shouldUseMock()).toBe(false)
    window.__CADENCE_AI_MOCK__ = true
    expect(shouldUseMock()).toBe(true)
  })

  it('returns the deterministic mock provider when the flag is set', () => {
    window.__CADENCE_AI_MOCK__ = true
    const provider = createAssistant()
    expect(provider.id).toBe('mock')
    expect([...provider.capabilities]).toEqual(['continue', 'generate', 'harmonize'])
  })

  it('returns the Magenta provider by default', () => {
    // Constructing MagentaAssistant must be cheap (no worker/network) — asserted
    // here by the fact that this does not throw or hang.
    const provider = createAssistant()
    expect(provider.id).toBe('magenta')
  })
})
