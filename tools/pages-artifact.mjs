import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const APP_BASE = '/cadence/app/'
export const APP_ROUTES = ['stems', 'pricing', 'profile', 'licenses']

const fallbackHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Page not found | Cadence</title>
    <script>
      (() => {
        const appRoot = '/cadence/app'
        if (location.pathname === appRoot || location.pathname.startsWith(appRoot + '/')) {
          const route = location.pathname.slice(appRoot.length) + location.search + location.hash
          const target = new URL(appRoot + '/', location.origin)
          target.searchParams.set('__cadence_route', route || '/')
          location.replace(target)
        }
      })()
    </script>
    <style>
      body { margin: 3rem auto; max-width: 42rem; padding: 0 1.5rem; color: #241b33; background: #faf8ff; font: 1rem/1.6 system-ui, sans-serif; }
      a { color: #6524c7; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Page not found</h1>
      <p>That Cadence page does not exist. <a href="/cadence/">Return to Cadence</a>.</p>
    </main>
  </body>
</html>
`

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyContents(source, destination) {
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source)) {
    await cp(join(source, entry), join(destination, entry), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
  }
}

export async function assemblePagesArtifact(siteDist, webDist, output) {
  const [siteIndex, webIndex] = await Promise.all([
    readFile(join(siteDist, 'index.html'), 'utf8'),
    readFile(join(webDist, 'index.html'), 'utf8'),
  ])
  if (!siteIndex.includes('/cadence/')) {
    throw new Error('The Astro build is not configured for /cadence/.')
  }
  if (!webIndex.includes('/cadence/app/')) {
    throw new Error('The web build is not configured for /cadence/app/.')
  }
  if (await exists(join(siteDist, 'app'))) {
    throw new Error('Artifact collision: the Astro site already owns /app/.')
  }
  if (await exists(join(siteDist, '404.html'))) {
    throw new Error('Artifact collision: the Astro site already owns 404.html.')
  }

  await rm(output, { recursive: true, force: true })
  await copyContents(siteDist, output)
  await copyContents(webDist, join(output, 'app'))

  for (const route of APP_ROUTES) {
    const routeIndex = join(output, 'app', route, 'index.html')
    await mkdir(dirname(routeIndex), { recursive: true })
    await writeFile(routeIndex, webIndex)
  }
  await writeFile(join(output, '404.html'), fallbackHtml)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [siteDist = 'site/dist', webDist = 'apps/web/dist', output = '.pages-artifact'] =
    process.argv.slice(2)
  await assemblePagesArtifact(resolve(siteDist), resolve(webDist), resolve(output))
  console.log(`Assembled Pages artifact at ${resolve(output)}`)
}
