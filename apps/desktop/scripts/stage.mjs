#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeTarget, stageNodeRuntime, targetTriple } from './node-runtime.mjs'
import { stageRuntimeDependencies } from './stage-runtime-dependencies.mjs'
import { readFrameStyles } from '@acorn/client-core/infra/styles/frameStyles.mts'

// Everything the Rust shell needs on disk before `tauri dev` or `tauri build` runs: the bundled Node
// runtime, the node service beside the helper, and the migration chains where the node's own walk-up
// will find them (docs/shell/packaging.md § Build and packaging).
//
// It detects missing artifacts, not stale ones. Build order is the caller's job, and package.json's
// `stage` script is where it is written down.

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(PKG, '../..')
const HELPER = resolve(PKG, 'dist/helper')
const target = runtimeTarget(targetTriple())

const need = (path, hint) => {
  if (!existsSync(path)) throw new Error(`${path} is missing — ${hint}`)
  return path
}

// The node service, staged beside the helper so both resolve their externals from this package's
// node_modules. service.js leaves native and run-time-loaded packages external (apps/node/externals.ts)
// and cannot resolve them from apps/node
// (docs/shell/node-child.md § Node child).
const dist = need(resolve(ROOT, 'apps/node/dist'), 'run `pnpm --filter @acorn/node build` first.')
need(resolve(dist, 'service.js'), 'run `pnpm --filter @acorn/node build` first.')
need(resolve(HELPER, 'helper.js'), 'run `pnpm run build:helper` first.')
// The service's chunk names carry a content hash, so every build that changes the node writes new
// ones. Cleared first, or each old chunk stays beside the helper and ships as a resource.
rmSync(resolve(HELPER, 'chunks'), { recursive: true, force: true })
// The chunk graph and source maps are build metadata, not something the helper runs. The graph feeds
// scripts/size-report.mjs; the maps stay in apps/node/dist for reading a packaged stack
// (docs/local-development/packaged-stacks.md § Find the source line). The tag build copies the maps
// too, so it can upload them beside the staged files and delete them before packaging
// (.github/workflows/build-desktop.yml).
const keepMaps = !!process.env.ACORN_RELEASE_SOURCEMAPS
cpSync(dist, HELPER, {
  recursive: true,
  filter: (path) => !path.endsWith('startup-graph.json') && (keepMaps || !path.endsWith('.map')),
})
stageRuntimeDependencies(PKG, HELPER, target)

// The installed command runs the headless CLI under the same pinned Node runtime as the desktop.
// Its chunks must stay beside cli.js, and Node needs this package boundary to parse them as ESM.
const cliSource = need(resolve(ROOT, 'apps/cli/dist'), 'run `pnpm --filter @acorn/cli build` first.')
need(resolve(cliSource, 'cli.js'), 'run `pnpm --filter @acorn/cli build` first.')
const cliTarget = resolve(PKG, 'dist/cli')
rmSync(cliTarget, { recursive: true, force: true })
cpSync(cliSource, cliTarget, { recursive: true })
writeFileSync(resolve(cliTarget, 'package.json'), '{"type":"module"}\n')

// Migration chains, beside the helper for the same reason. Unset `process.resourcesPath` under a real
// Node means node-core walks up from the service module looking for a `migrations` directory, so this
// is the first place it looks (packages/node-core/src/server/bindings.ts, server/plugins/migrations.ts).
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
// process.arch spells itself. The runtime is fetched from nodejs.org and checksum-verified, so the
// developer's own Node doesn't have to be the pinned one; see `stageNodeRuntime`.
const pin = JSON.parse(readFileSync(resolve(ROOT, 'node-runtime.json'), 'utf8')).version
const { source } = await stageNodeRuntime({ pkg: PKG, version: pin, triple: target.triple })

// The plugin frame's stylesheet, as one file the `app-plugin://` handler serves at `/ui.css`
// (src-tauri/src/plugin_scheme.rs). The module list is shared with the phone's sandbox build.
const frameStyles = readFrameStyles()
mkdirSync(resolve(PKG, 'dist/bridge'), { recursive: true })
writeFileSync(resolve(PKG, 'dist/bridge/plugin-frame.css'), frameStyles)

console.log(
  `[stage] node ${pin} (${source}) -> binaries/node-${target.triple}; service + ${chains.length} migration chain(s) -> dist/helper; frame stylesheet -> dist/bridge`,
)
