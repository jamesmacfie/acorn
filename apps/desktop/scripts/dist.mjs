import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { runPnpm } from '../../../scripts/run-pnpm.mjs'

const pkg = new URL('../', import.meta.url)
const require = createRequire(import.meta.url)
runPnpm(['run', 'build'], { cwd: pkg, stdio: 'inherit' })
execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'build', '--config', JSON.stringify({ build: { beforeBuildCommand: '' } })], {
  cwd: pkg,
  stdio: 'inherit',
  env: { ...process.env, CI: 'true' },
})
runPnpm(['run', 'verify:bundle'], { cwd: pkg, stdio: 'inherit' })
