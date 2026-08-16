import { describe, expect, it, vi } from 'vitest'
import {
  getInstrumentLoadState,
  registerLazyInstrument,
  setInstrumentLoadState,
  subscribeInstrumentLoadState,
} from './instrumentLoadState'

describe('instrument load state', () => {
  it('treats registered lazy instruments as idle and all other instruments as ready', () => {
    registerLazyInstrument('lazy-test')
    expect(getInstrumentLoadState('lazy-test')).toBe('idle')
    expect(getInstrumentLoadState('synth-test')).toBe('ready')
  })

  it('publishes loading and ready transitions without eager work', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeInstrumentLoadState(listener)
    setInstrumentLoadState('lazy-transition', 'loading')
    setInstrumentLoadState('lazy-transition', 'ready')
    setInstrumentLoadState('lazy-transition', 'ready')
    unsubscribe()

    expect(listener).toHaveBeenCalledTimes(2)
    expect(getInstrumentLoadState('lazy-transition')).toBe('ready')
  })
})
