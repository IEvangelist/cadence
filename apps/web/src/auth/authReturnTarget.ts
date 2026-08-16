const AUTH_RETURN_TARGET_KEY = 'cadence.v1.auth.return-target'

export interface RouteLocation {
  pathname: string
  search: string
  hash: string
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function routeLocationToString(location: RouteLocation): string {
  return `${location.pathname}${location.search}${location.hash}`
}

export function safeAuthReturnTarget(
  value: string | null | undefined,
  origin = window.location.origin,
): string {
  if (!value) return '/'

  try {
    const parsed = new URL(value, origin)
    if (parsed.origin !== origin || !parsed.pathname.startsWith('/')) return '/'
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/'
  }
}

export function saveAuthReturnTarget(
  value: string,
  storage: SessionStore = window.sessionStorage,
  origin = window.location.origin,
): string {
  const safe = safeAuthReturnTarget(value, origin)
  storage.setItem(AUTH_RETURN_TARGET_KEY, safe)
  return safe
}

export function takeAuthReturnTarget(
  storage: SessionStore = window.sessionStorage,
  origin = window.location.origin,
): string {
  const stored = readAuthReturnTarget(storage, origin)
  storage.removeItem(AUTH_RETURN_TARGET_KEY)
  return stored ?? '/'
}

export function readAuthReturnTarget(
  storage: SessionStore = window.sessionStorage,
  origin = window.location.origin,
): string | null {
  const stored = storage.getItem(AUTH_RETURN_TARGET_KEY)
  return stored === null ? null : safeAuthReturnTarget(stored, origin)
}

export function clearAuthReturnTarget(
  storage: SessionStore = window.sessionStorage,
): void {
  storage.removeItem(AUTH_RETURN_TARGET_KEY)
}

export interface AuthCallback {
  outcome: 'success' | 'error'
  reason: string | null
  cleanLocation: RouteLocation
}

export function consumeAuthCallback(location: RouteLocation): AuthCallback | null {
  const parameters = new URLSearchParams(location.search)
  const auth = parameters.get('auth')
  if (auth !== 'success' && auth !== 'error') return null

  const reason = parameters.get('reason')
  parameters.delete('auth')
  parameters.delete('reason')
  const search = parameters.toString()

  return {
    outcome: auth,
    reason,
    cleanLocation: {
      pathname: location.pathname,
      search: search ? `?${search}` : '',
      hash: location.hash,
    },
  }
}

export function mergeAuthReturnLocation(
  returnTarget: string,
  callbackLocation: RouteLocation,
  origin = window.location.origin,
): RouteLocation {
  const target = new URL(safeAuthReturnTarget(returnTarget, origin), origin)
  const callbackParameters = new URLSearchParams(callbackLocation.search)

  for (const key of new Set(callbackParameters.keys())) {
    target.searchParams.delete(key)
    for (const value of callbackParameters.getAll(key)) {
      target.searchParams.append(key, value)
    }
  }

  return {
    pathname: target.pathname,
    search: target.search,
    hash: callbackLocation.hash || target.hash,
  }
}
