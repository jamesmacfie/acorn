#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stageNodeRuntime, targetTriple } from './node-runtime.mjs'

// Everything the Rust shell needs on disk before `tauri dev` or `tauri build` runs: the bundled Node
// runtime, the node service beside the helper, and the migration chains where the node's own walk-up
// will find them (docs/shell.md § Build and packaging).
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
// cannot resolve them from apps/node (docs/shell.md § Node child).
const dist = need(resolve(ROOT, 'apps/node/dist'), 'run `pnpm --filter @acorn/node build` first.')
need(resolve(dist, 'service.js'), 'run `pnpm --filter @acorn/node build` first.')
need(resolve(HELPER, 'helper.js'), 'run `pnpm run build:helper` first.')
cpSync(dist, HELPER, { recursive: true })

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
// developer's own Node no longer has to be the pinned one — see scripts/node-runtime.mjs.
const pin = JSON.parse(readFileSync(resolve(ROOT, 'node-runtime.json'), 'utf8')).version
const triple = targetTriple()
const { source } = await stageNodeRuntime({ pkg: PKG, version: pin, triple })

// The plugin frame's stylesheet, as one file the `app-plugin://` handler serves at `/ui.css`
// (src-tauri/src/plugin_scheme.rs). The renderer gets these modules through Vite; the Rust handler
// cannot, so they are concatenated here instead.
//
// Presentation only. Feature and data styles stay out: the list covers what the public UI entrypoint
// needs — primitives, tabs, modals/mentions, copy controls, tooltips, picker chrome, diff rows, and
// the style-pack structural overrides — so components imported from @acorn/plugin-api/ui keep the
// same class contract inside a frame as outside one. Token values arrive over the bridge for the
// active theme and style axes, not from here.
//
// The order is the cascade, so it is the list rather than a directory scan.
// packages/client-core/src/styles/cssHygiene.test.ts reads this array and checks that what a frame is
// served covers every class primitives.css styles.
const FRAME_STYLES = [
  'styles/base.css',
  'styles/primitives.css',
  'styles/overlays.css',
  'styles/copy.css',
  'styles/tabs.css',
  // The delegated tooltip bubble. A frame mounts its own listener, `mountFrameTips` from
  // client-core/ui/frameTips.ts, because the shell's singleton cannot see into another document. It
  // lives apart from ui/tips.tsx so a frame bundle does not pull Solid and the primitives in with it.
  'ui/tips.css',
  'styles/topbar.css',
  'styles/diff.css',
  'styles/style-modern.css',
  'styles/style-cozy.css',
  'styles/style-cute.css',
]
const frameStyles = FRAME_STYLES.map((rel) => readFileSync(resolve(ROOT, 'packages/client-core/src', rel), 'utf8'))
mkdirSync(resolve(PKG, 'dist/bridge'), { recursive: true })
writeFileSync(resolve(PKG, 'dist/bridge/plugin-frame.css'), frameStyles.join('\n'))

console.log(
  `[stage] node ${pin} (${source}) -> binaries/node-${triple}; service + ${chains.length} migration chain(s) -> dist/helper; ${frameStyles.length} frame stylesheet(s) -> dist/bridge`,
)
