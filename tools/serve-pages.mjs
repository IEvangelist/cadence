import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? '.pages-artifact')
const port = Number(process.env.PORT ?? 4400)
const projectBase = '/cadence'
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
}

async function fileFor(pathname) {
  if (pathname !== projectBase && !pathname.startsWith(`${projectBase}/`)) return null
  const relative = decodeURIComponent(pathname.slice(projectBase.length)).replace(/^\/+/, '')
  const candidate = resolve(root, relative)
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return null

  for (const path of [candidate, resolve(candidate, 'index.html')]) {
    try {
      if ((await stat(path)).isFile()) return path
    } catch {
      // Try the directory index, then the Pages fallback.
    }
  }
  return null
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const requested = await fileFor(url.pathname)
  const path = requested ?? resolve(root, '404.html')
  response.statusCode = requested ? 200 : 404
  response.setHeader('Content-Type', contentTypes[extname(path)] ?? 'application/octet-stream')
  response.setHeader('Cache-Control', 'no-store')
  createReadStream(path).pipe(response)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Pages artifact available at http://127.0.0.1:${port}${projectBase}/`)
})
