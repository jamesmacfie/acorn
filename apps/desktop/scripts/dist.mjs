import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runPnpm } from '../../../scripts/run-pnpm.mjs'

const pkg = new URL('../', import.meta.url)
const require = createRequire(import.meta.url)
// --prebuilt packages a `build` that already ran, so CI can test that output and then bundle it.
if (!process.argv.includes('--prebuilt')) runPnpm(['run', 'build'], { cwd: pkg, stdio: 'inherit' })
const releaseConfig = JSON.parse(readFileSync(new URL('../src-tauri/tauri.release.json', import.meta.url), 'utf8'))
execFileSync(process.execPath, [require.resolve('@tauri-apps/cli/tauri.js'), 'build', '--config', JSON.stringify({
  ...releaseConfig,
  build: { beforeBuildCommand: '' },
})], {
  cwd: pkg,
  stdio: 'inherit',
  env: { ...process.env, CI: 'true' },
})
runPnpm(['run', 'verify:bundle'], { cwd: pkg, stdio: 'inherit' })
// The installed report rode into the bundle during `build`. This one is written after packaging, so it
// also has the compressed release files, and it stays outside the bundle it describes.
runPnpm(['run', 'size-report', '--', '--out', 'dist/release-size-report.json'], { cwd: pkg, stdio: 'inherit' })
