import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { runPnpm } from '../../../scripts/run-pnpm.mjs'

const pkg = new URL('../', import.meta.url)
const require = createRequire(import.meta.url)
// --prebuilt packages a `build` that already ran, so CI can test that output and then bundle it.
if (!process.argv.includes('--prebuilt')) runPnpm(['run', 'build'], { cwd: pkg, stdio: 'inherit' })
execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'build', '--config', JSON.stringify({ build: { beforeBuildCommand: '' } })], {
  cwd: pkg,
  stdio: 'inherit',
  env: { ...process.env, CI: 'true' },
})
runPnpm(['run', 'verify:bundle'], { cwd: pkg, stdio: 'inherit' })
