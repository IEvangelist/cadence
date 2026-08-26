import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { assemblePagesArtifact, APP_ROUTES } from '../tools/pages-artifact.mjs'

const fixtureRoot = resolve('tests/.pages-artifact-fixture')

async function fixture() {
  await rm(fixtureRoot, { recursive: true, force: true })
  const site = join(fixtureRoot, 'site')
  const web = join(fixtureRoot, 'web')
  const output = join(fixtureRoot, 'output')
  await mkdir(join(web, 'assets'), { recursive: true })
  await mkdir(site, { recursive: true })
  await writeFile(join(site, 'index.html'), '<a href="/cadence/docs/">Docs</a><a href="/cadence/app/">App</a>')
  await writeFile(join(web, 'index.html'), '<script src="/cadence/app/assets/app.js"></script>')
  await writeFile(join(web, 'site.webmanifest'), '{"start_url":"./"}')
  await writeFile(join(web, 'sw.js'), 'self.registration.scope')
  await writeFile(join(web, 'assets', 'app.js'), 'console.log("Cadence")')
  return { site, web, output }
}

test.afterEach(() => rm(fixtureRoot, { recursive: true, force: true }))

test('assembles site and app without path collisions', async () => {
  const { site, web, output } = await fixture()
  await assemblePagesArtifact(site, web, output)

  assert.match(await readFile(join(output, 'index.html'), 'utf8'), /\/cadence\/docs\//)
  assert.match(await readFile(join(output, 'app', 'index.html'), 'utf8'), /\/cadence\/app\/assets\//)
  for (const route of APP_ROUTES) {
    assert.equal(
      await readFile(join(output, 'app', route, 'index.html'), 'utf8'),
      await readFile(join(output, 'app', 'index.html'), 'utf8'),
    )
  }
  assert.match(await readFile(join(output, '404.html'), 'utf8'), /location\.search \+ location\.hash/)
})

test('refuses to overwrite a site-owned app route', async () => {
  const { site, web, output } = await fixture()
  await mkdir(join(site, 'app'))
  await assert.rejects(
    assemblePagesArtifact(site, web, output),
    /Astro site already owns \/app\//,
  )
})
