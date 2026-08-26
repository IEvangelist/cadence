import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: repoRoot,
    env: { ...process.env, ...env },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['run', 'build', '--prefix', 'site'])
run(
  'npm',
  ['run', 'build', '--workspace', '@cadence/web'],
  {
    CADENCE_BASE_PATH: '/cadence/app/',
    VITE_BACKEND_MODE: 'disabled',
  },
)
run('node', ['tools/pages-artifact.mjs'])
run('node', ['tools/verify-pages-artifact.mjs'])
