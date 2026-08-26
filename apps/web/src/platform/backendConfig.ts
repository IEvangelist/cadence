export type BackendMode = 'same-origin' | 'remote' | 'disabled'

interface BackendEnvironment {
  VITE_BACKEND_MODE?: string
  VITE_API_BASE_URL?: string
}

export interface BackendConfig {
  mode: BackendMode
  available: boolean
  apiBaseUrl: string
}

export function resolveBackendConfig(env: BackendEnvironment): BackendConfig {
  const configuredBase = (env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const requestedMode = (env.VITE_BACKEND_MODE ?? '').trim()

  if (requestedMode === 'disabled') {
    return { mode: 'disabled', available: false, apiBaseUrl: '' }
  }
  if (requestedMode === 'remote') {
    return configuredBase
      ? { mode: 'remote', available: true, apiBaseUrl: configuredBase }
      : { mode: 'disabled', available: false, apiBaseUrl: '' }
  }

  return {
    mode: configuredBase ? 'remote' : 'same-origin',
    available: true,
    apiBaseUrl: configuredBase,
  }
}

export const backendConfig = resolveBackendConfig(
  import.meta.env as unknown as BackendEnvironment,
)
