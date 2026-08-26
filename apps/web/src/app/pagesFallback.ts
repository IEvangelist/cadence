export const PAGES_ROUTE_PARAM = '__cadence_route'

export function restorePagesRoute(
  location: Pick<Location, 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState'> = window.history,
  basePath: string = import.meta.env.BASE_URL,
): boolean {
  const params = new URLSearchParams(location.search)
  const route = params.get(PAGES_ROUTE_PARAM)
  if (!route?.startsWith('/') || route.startsWith('//')) return false

  const base = basePath.replace(/\/+$/, '')
  history.replaceState(null, '', `${base}${route}`)
  return true
}
