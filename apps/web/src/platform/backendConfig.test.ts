import { describe, expect, it } from 'vitest'
import { resolveBackendConfig } from './backendConfig'

describe('resolveBackendConfig', () => {
  it('disables every backend capability for a static build', () => {
    expect(
      resolveBackendConfig({
        VITE_BACKEND_MODE: 'disabled',
        VITE_API_BASE_URL: 'https://example.test/api',
      }),
    ).toEqual({ mode: 'disabled', available: false, apiBaseUrl: '' })
  })

  it('requires an API base for remote mode', () => {
    expect(resolveBackendConfig({ VITE_BACKEND_MODE: 'remote' })).toEqual({
      mode: 'disabled',
      available: false,
      apiBaseUrl: '',
    })
  })

  it('supports the existing same-origin development topology', () => {
    expect(resolveBackendConfig({ VITE_BACKEND_MODE: 'same-origin' })).toEqual({
      mode: 'same-origin',
      available: true,
      apiBaseUrl: '',
    })
  })
})
