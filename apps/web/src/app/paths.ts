export function appAssetUrl(
  path: string,
  basePath: string = import.meta.env.BASE_URL,
): string {
  return `${basePath.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function appRouteUrl(
  route: string,
  basePath: string = import.meta.env.BASE_URL,
): string {
  return appAssetUrl(route, basePath)
}
