import { gzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = join(webRoot, 'dist')
const baselinePath = join(
  webRoot,
  'e2e',
  'final-gate',
  'bundle-baseline.json',
)
const reportPath = join(
  webRoot,
  'test-results',
  'final-gate',
  'bundle-size-report.json',
)

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
const indexHtml = await readFile(join(distRoot, 'index.html'), 'utf8')
const entryMatch = indexHtml.match(
  /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i,
)

if (!entryMatch) {
  throw new Error('Unable to locate the initial module script in dist/index.html.')
}

const preloadMatches = [
  ...indexHtml.matchAll(
    /<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/gi,
  ),
].map((match) => match[1])
const initialAssets = [...new Set([entryMatch[1], ...preloadMatches])]
const measuredAssets = await Promise.all(
  initialAssets.map(async (asset) => {
    const assetPath = join(distRoot, asset.replace(/^[/\\]+/, ''))
    const content = await readFile(assetPath)
    return {
      asset: relative(distRoot, assetPath).replaceAll('\\', '/'),
      gzipBytes: gzipSync(content, { level: 9 }).byteLength,
      rawBytes: content.byteLength,
    }
  }),
)
const gzipBytes = measuredAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
)
const rawBytes = measuredAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
)
const deltaBytes = gzipBytes - baseline.initialAppGzipBytes
const deltaPercent = (deltaBytes / baseline.initialAppGzipBytes) * 100
const passed = gzipBytes <= baseline.initialAppGzipCeilingBytes
const report = {
  baseline,
  current: {
    initialAssets: measuredAssets,
    gzipBytes,
    rawBytes,
  },
  deltaBytes,
  deltaPercent,
  passed,
}

await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))

if (!passed) {
  console.error(
    `Initial app gzip is ${gzipBytes} bytes; ceiling is ${baseline.initialAppGzipCeilingBytes} bytes.`,
  )
  process.exitCode = 1
}
