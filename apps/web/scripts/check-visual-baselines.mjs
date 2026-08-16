import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const expectedBaselineCount = 38
const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselineRoot = join(
  webRoot,
  'e2e',
  'final-gate',
  '__screenshots__',
)

async function countPngFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }

  let count = 0
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) count += await countPngFiles(path)
    else if (entry.isFile() && entry.name.endsWith('.png')) count += 1
  }
  return count
}

const actualBaselineCount = await countPngFiles(baselineRoot)
if (actualBaselineCount !== expectedBaselineCount) {
  throw new Error(
    `Expected ${expectedBaselineCount} Linux visual baselines, found ${actualBaselineCount}.`,
  )
}

console.log(`Found all ${actualBaselineCount} required Linux visual baselines.`)
