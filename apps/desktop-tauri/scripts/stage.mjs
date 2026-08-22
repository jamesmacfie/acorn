#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Everything the Rust shell needs on disk before `tauri dev` or `tauri build` runs: the bundled Node
// runtime, the node service beside the helper, and the migration chains where the node's own walk-up
// will find them (docs/future/tauri/node-runtime.md).
//
// It detects missing artifacts, not stale ones — the same rule the Electron build follows. Build order
// is the caller's job, and package.json's `stage` script is where it is written down.

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(PKG, '../..')
const HELPER = resolve(PKG, 'dist/helper')

const need = (path, hint) => {
  if (!existsSync(path)) throw new Error(`${path} is missing — ${hint}`)
  return path
}

// The node service, staged beside the helper so both resolve their externals from this package's
// node_modules. The spike found this out the hard way: service.js externalises its dependencies and
// cannot resolve them from apps/node (docs/future/tauri/node-runtime.md § Spike findings).
const dist = need(resolve(ROOT, 'apps/node/dist'), 'run `pnpm --filter @acorn/node build` first.')
need(resolve(dist, 'service.js'), 'run `pnpm --filter @acorn/node build` first.')
need(resolve(HELPER, 'helper.js'), 'run `pnpm run build:helper` first.')
cpSync(dist, HELPER, { recursive: true })

// Migration chains, beside the helper for the same reason. Unset `process.resourcesPath` under a real
// Node means node-core walks up from the service module looking for a `migrations` directory, so this
// is the first place it looks (packages/node-core/src/main/bindings.ts, pluginMigrations.ts).
rmSync(resolve(HELPER, 'migrations'), { recursive: true, force: true })
const chains = [{ plugin: null, dir: resolve(ROOT, 'packages/node-core/migrations') }]
for (const entry of readdirSync(resolve(ROOT, 'plugins'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const dir = resolve(ROOT, 'plugins', entry.name, 'migrations')
  if (existsSync(resolve(dir, 'meta/_journal.json'))) chains.push({ plugin: entry.name, dir })
}
for (const chain of chains) {
  cpSync(chain.dir, chain.plugin ? resolve(HELPER, 'migrations', chain.plugin) : resolve(HELPER, 'migrations'), { recursive: true })
}

// The bundled Node runtime, as a Tauri external binary: `binaries/node-<target triple>` is the name
// `bundle.externalBin` resolves, and the triple comes from rustc rather than a guess about how
// process.arch spells itself.
const pin = JSON.parse(readFileSync(resolve(ROOT, 'node-runtime.json'), 'utf8')).version
const triple = /host: (\S+)/.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1]
if (!triple) throw new Error('Could not read the host target triple from `rustc -vV`.')
const binary = resolve(PKG, 'src-tauri/binaries', `node-${triple}`)

// ponytail: the pinned runtime is the one already running this script, so there is no download and no
// checksum here. That holds for a developer build and nothing else — a release must fetch the pinned
// build for its target and verify it against nodejs.org's SHASUMS, which is phase 4's packaging work
// (docs/future/tauri/packaging-and-release.md).
if (process.version !== `v${pin}`) {
  throw new Error(`node-runtime.json pins Node ${pin} and this is ${process.version}. Switch runtimes, or update the pin if that is the intent.`)
}
mkdirSync(dirname(binary), { recursive: true })
copyFileSync(process.execPath, binary)
chmodSync(binary, 0o755)

console.log(`[stage] node ${pin} -> ${triple}; service + ${chains.length} migration chain(s) -> dist/helper`)
