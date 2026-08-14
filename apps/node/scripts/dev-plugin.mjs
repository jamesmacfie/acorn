#!/usr/bin/env node
// Watch one plugin's package and re-run `build-plugin.mjs` on every save.
//
//   pnpm dev:plugin rollbar                                              # into the dev data root
//   pnpm dev:plugin rollbar -- --package-root ../desktop/out/bundled-plugins   # into desktop staging
//
// What this removes is the remembered sequence, not the restart: seeing a one-line change run used to
// mean rebuilding the package by hand, restarting the node, reloading the renderer, and answering trust
// dialogs. The dialogs are gone in a development build (main/bundledPluginTrust.ts) and the rebuild is
// this; the node restart is the one step that is real, because a loaded plugin's routes, tables and jobs
// wire at init (node-core/server/routes/plugins.ts).
// Under `pnpm dev:node` even that is automatic, because node's own `--watch` sees the rewritten bundle.
//
// A supervisor around the existing builder rather than a flag inside it: a fresh process per rebuild
// re-reads the declaration and every workspace source with no module cache to invalidate, and one node
// startup is noise next to a Vite build. Deliberately NOT a Vite watch build or a file-watching
// library — `node:fs` already watches directories, and the builder already knows how to build.
//
// Ceiling: a rebuild is a full build of both bundles, ~1s, with no incremental graph. If that stops
// being fast enough the upgrade path is Vite's own watch mode inside build-plugin.mjs, which keeps the
// rollup graph warm; nothing here would need to change but this file.
import { spawn } from 'node:child_process'
import { existsSync, watch } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPTS = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPTS, '../../..')
const PLUGINS_DIR = join(ROOT, 'plugins')
const BUILDER = join(SCRIPTS, 'build-plugin.mjs')
const CONFIG_FILE = 'acorn-plugin.config.mjs'

const args = process.argv.slice(2)
const id = args[0]
const packageDir = id ? join(PLUGINS_DIR, id) : null
const configPath = packageDir ? join(packageDir, CONFIG_FILE) : null
if (!packageDir || !configPath || !existsSync(configPath)) {
  console.error('Usage: dev-plugin.mjs <plugin-id> [--package-root <directory>]')
  process.exit(1)
}

// Read for one field: a manifest-declared migration chain lives beside `src/`, not inside it, and a new
// `.sql` file has to reach the package or the plugin fails on its first `ctx.storage.open()`.
const spec = (await import(pathToFileURL(configPath).href)).default
const declaredMigrations = spec.migrations ? resolve(packageDir, spec.migrations) : null
const dirs = [
  join(packageDir, 'src'),
  ...(declaredMigrations ? [declaredMigrations] : []),
].filter((target) => existsSync(target))
// The watch list is resolved once, here, from one read of the declaration — so a chain that does not exist
// yet is not watched into existence, and repointing `migrations` needs a restart of this watcher. Both are
// silent stalls that read as "the builder is ignoring my file", so they get said out loud instead.
if (declaredMigrations && !existsSync(declaredMigrations)) {
  console.warn(`[dev-plugin] ${relative(ROOT, declaredMigrations)} does not exist yet, so it is not being watched — restart dev:plugin once you create it`)
}

let running = false
let pending = false
const rebuild = () => {
  if (running) {
    pending = true
    return
  }
  running = true
  // A non-zero exit does NOT stop the watcher. Half-saved source is the normal state of a watched
  // directory, and a watcher that dies on the first broken save is one you restart by hand instead of
  // reading.
  spawn(process.execPath, [BUILDER, ...args], { stdio: 'inherit', cwd: resolve(SCRIPTS, '..') }).on('exit', (code) => {
    running = false
    if (code !== 0) console.error(`[dev-plugin] ${id} did not build (exit ${code}) — still watching`)
    if (pending) {
      pending = false
      rebuild()
    }
  })
}

let timer = null
// One editor save is several filesystem events, so coalesce before spending a build on them.
const trigger = () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(rebuild, 100)
}

for (const dir of dirs) watch(dir, { recursive: true }, trigger)

// The declaration is watched through its DIRECTORY, not by name. `watch()` on a single file follows the
// inode, and the atomic save most editors do — write a temp file, rename it over the target — leaves the
// watch pointing at an inode nothing will ever write to again. The symptom is the worst kind: the first
// config edit is picked up if your editor writes in place, and silently ignored forever if it does not.
watch(packageDir, { recursive: false }, (_event, filename) => {
  if (filename !== CONFIG_FILE) return
  console.log(`[dev-plugin] ${CONFIG_FILE} changed — rebuilding; restart dev:plugin if you changed 'migrations'`)
  trigger()
})

console.log(`[dev-plugin] watching ${[...dirs, configPath].map((target) => relative(ROOT, target)).join(', ')} — ctrl-c to stop`)
rebuild()
