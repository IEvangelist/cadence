export function cadenceCacheName(
  basePath: string = import.meta.env.BASE_URL,
  version = 'v2',
): string {
  const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')
  return `cadence-shell:${normalizedBase}:${version}`
}
