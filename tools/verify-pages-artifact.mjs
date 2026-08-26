import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { APP_BASE, APP_ROUTES } from './pages-artifact.mjs'

const root = resolve(process.argv[2] ?? '.pages-artifact')
const read = (path) => readFile(join(root, path), 'utf8')

const [site, app, manifest, serviceWorker, fallback] = await Promise.all([
  read('index.html'),
  read('app/index.html'),
  read('app/site.webmanifest'),
  read('app/sw.js'),
  read('404.html'),
])

assert.match(site, /\/cadence\/docs\//, 'site docs must remain under /cadence/')
assert.match(site, /\/cadence\/app\//, 'landing must link to the web composer')
assert.match(app, /\/cadence\/app\/assets\//, 'app bundles must use the app base')
assert.doesNotMatch(app, /(?:src|href)="\/assets\//, 'app assets must not escape its base')
assert.equal(JSON.parse(manifest).start_url, './')
assert.match(serviceWorker, /registration\.scope/)
assert.match(fallback, /__cadence_route/)

for (const route of APP_ROUTES) {
  await stat(join(root, 'app', route, 'index.html'))
}

console.log(`Verified Pages artifact for ${APP_BASE}`)
