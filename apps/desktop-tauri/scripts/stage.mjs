#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageNodeRuntime, targetTriple } from './nodeRuntime.mjs'

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
// process.arch spells itself. The runtime is fetched from nodejs.org and checksum-verified, so the
// developer's own Node no longer has to be the pinned one — see scripts/nodeRuntime.mjs.
const pin = JSON.parse(readFileSync(resolve(ROOT, 'node-runtime.json'), 'utf8')).version
const triple = targetTriple()
const { source } = await stageNodeRuntime({ pkg: PKG, version: pin, triple })

// The plugin frame's stylesheet, as one file the `app-plugin://` handler serves at `/ui.css`
// (src-tauri/src/plugin_scheme.rs). Electron compiles the same modules into main through `?raw`
// imports; Rust cannot, so they are concatenated here instead.
//
// The list is read out of Electron's `pluginFrameStyles.ts` rather than copied, because two lists that
// have to agree eventually do not. That file is the one place the order is decided, and when it goes
// at cutover this reader goes with it — the modules move here and the parsing disappears.
const stylesSource = readFileSync(resolve(ROOT, 'apps/desktop/src/app/main/pluginFrameStyles.ts'), 'utf8')
const specifiers = new Map([...stylesSource.matchAll(/^import (\w+) from '@acorn\/client-core\/(\S+?)\?raw'/gm)].map((m) => [m[1], m[2]]))
const order = /export const pluginFrameStyles = \[([^\]]*)\]/.exec(stylesSource)?.[1]
if (!order) throw new Error('pluginFrameStyles.ts no longer declares its module list as an array literal.')
const frameStyles = order
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .map((name) => {
    const specifier = specifiers.get(name)
    if (!specifier) throw new Error(`pluginFrameStyles.ts lists ${name} but does not import it from @acorn/client-core.`)
    return readFileSync(resolve(ROOT, 'packages/client-core/src', specifier), 'utf8')
  })
mkdirSync(resolve(PKG, 'dist/bridge'), { recursive: true })
writeFileSync(resolve(PKG, 'dist/bridge/plugin-frame.css'), frameStyles.join('\n'))

console.log(
  `[stage] node ${pin} (${source}) -> binaries/node-${triple}; service + ${chains.length} migration chain(s) -> dist/helper; ${frameStyles.length} frame stylesheet(s) -> dist/bridge`,
)
