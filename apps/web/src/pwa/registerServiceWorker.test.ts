import { describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from './registerServiceWorker'

function setReadyState(readyState: DocumentReadyState) {
  Object.defineProperty(document, 'readyState', {
    configurable: true,
    value: readyState,
  })
}

function navWithRegister(register = vi.fn(() => Promise.resolve())): Navigator {
  return {
    serviceWorker: {
      register,
    },
  } as unknown as Navigator
}

describe('registerServiceWorker', () => {
  it('does not register when disabled', () => {
    const register = vi.fn(() => Promise.resolve())
    const nav = navWithRegister(register)

    registerServiceWorker(nav, false)

    expect(register).not.toHaveBeenCalled()
  })

  it('does not throw or register when service workers are unsupported', () => {
    expect(() => registerServiceWorker({} as Navigator, true)).not.toThrow()
  })

  it('registers /sw.js immediately when the document is already loaded', () => {
    setReadyState('complete')
    const register = vi.fn(() => Promise.resolve())
    const nav = navWithRegister(register)

    registerServiceWorker(nav, true)

    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('registers /sw.js after window load when the document is not complete', () => {
    setReadyState('loading')
    const register = vi.fn(() => Promise.resolve())
    const nav = navWithRegister(register)

    registerServiceWorker(nav, true)
    expect(register).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('load'))

    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('swallows registration failures', async () => {
    setReadyState('complete')
    const register = vi.fn(() => Promise.reject(new Error('registration failed')))
    const nav = navWithRegister(register)

    expect(() => registerServiceWorker(nav, true)).not.toThrow()
    await Promise.resolve()

    expect(register).toHaveBeenCalledWith('/sw.js')
  })
})
