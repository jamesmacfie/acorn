import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
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
// The macOS updater payload. Tauri makes it only while holding the updater key, and no build holds
// it: the release job signs this file afterwards (docs/shell/packaging.md § CI permissions and signing
// credentials). Windows and Linux ship the installer itself as the payload.
if (process.platform === 'darwin') {
  const macos = fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/', import.meta.url))
  for (const app of readdirSync(macos).filter((name) => name.endsWith('.app'))) {
    execFileSync('tar', ['-czf', `${app}.tar.gz`, app], { cwd: macos, stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' } })
  }
}
runPnpm(['run', 'verify:bundle'], { cwd: pkg, stdio: 'inherit' })
// The installed report rode into the bundle during `build`. This one is written after packaging, so it
// also has the compressed release files, and it stays outside the bundle it describes.
runPnpm(['run', 'size-report', '--', '--out', 'dist/release-size-report.json'], { cwd: pkg, stdio: 'inherit' })
