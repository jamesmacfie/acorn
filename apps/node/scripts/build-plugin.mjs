#!/usr/bin/env node
// Build a repository plugin into a loadable package, so the loader can be dogfooded
// against real code instead of a test fixture (docs/plugins.md).
//
//   pnpm --filter @acorn/node build:plugin rollbar
//   pnpm --filter @acorn/node build:plugin rollbar -- --package-root /path/to/resources/plugins
//   pnpm dev:plugin rollbar          # the same build, re-run on every save
//   pnpm dev:node
//
// The result is `<dataRoot>/plugins/<id>/` holding a generated `acorn-plugin.json` plus one ESM
// bundle per declared runtime. On the next boot the loader picks it up like any installed package.
//
// ## The dev loop
//
// `scripts/dev-plugin.mjs` (`pnpm dev:plugin <id>`) re-runs this script on every save, so "see my
// change running" is one command left open in a terminal instead of a remembered sequence
// (docs/plugins.md § The dev loop).
//
// ## Where a plugin's declaration lives
//
// In the plugin's own package: `plugins/<id>/acorn-plugin.config.mjs`, imported here by id. The
// declared surface — permissions, frames, sources, commands — is diffed and reviewed where the code
// it describes lives, and this script stays a builder rather than a registry.
//
// ## Why Vite and not esbuild
//
// The phase doc said esbuild; there is none in this workspace, and apps/node already bundles itself
// with Vite using exactly the settings a plugin bundle needs (ESM out, node builtins external,
// workspace packages inlined). Adding a second bundler to run the same job would be a dependency
// bought for nothing.
//
// The default target is the development data root. `--package-root` is the generic staging seam used
// by the desktop build: the same validated package shape is copied into application resources and
// reconciled into the writable data root on boot.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'
import solid from 'vite-plugin-solid'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(NODE_APP, '../..')
const PLUGINS_DIR = join(ROOT, 'plugins')
const CONFIG_FILE = 'acorn-plugin.config.mjs'

// A frame owns its realm and bundle, so its framework choice is independent of the shell's. The
// config names a framework and this maps it to the Vite transforms the frame bundle needs; a plugin
// whose frame needs none omits the key, and adding a framework is one line here.
const FRAMEWORKS = {
  solid: () => [solid()],
}

const buildable = () =>
  readdirSync(PLUGINS_DIR).filter((dir) => existsSync(join(PLUGINS_DIR, dir, CONFIG_FILE)))

const args = process.argv.slice(2)
const id = args[0]
const configPath = id ? join(PLUGINS_DIR, id, CONFIG_FILE) : null
if (!configPath || !existsSync(configPath)) {
  console.error(`Usage: build-plugin.mjs <${buildable().join('|')}> [--package-root <directory>]`)
  process.exit(1)
}
// The directory name IS the plugin id — it binds the `/v2/p/<id>` namespace, provider ids and task
// origins, which is why the config file does not carry a second copy to disagree with.
const spec = (await import(pathToFileURL(configPath).href)).default
const packageRootIndex = args.indexOf('--package-root')
const packageRoot = packageRootIndex === -1 ? null : args[packageRootIndex + 1]
if (packageRootIndex !== -1 && !packageRoot) throw new Error('--package-root requires a directory')

// Matches main/serverPaths.ts's dev root, and honours the same override the node itself reads.
const dataRoot = process.env.ACORN_DATA_DIR || join(NODE_APP, '.acorn')
const outDir = join(packageRoot ? resolve(packageRoot) : join(dataRoot, 'plugins'), id)
// Imported, not scraped. This used to be a regex over the source text of packages/protocol/src/api.ts,
// because a .mjs script cannot import a built package — but it can import a .ts file with nothing in it
// but one const, which is why pluginApiVersion.ts exists.
//
// That import relies on Node's own type stripping, so it has a version floor. The root package.json
// pins it, but `engines` is a warning rather than a wall by default — and the failure without this
// guard is an unresolved-module error that says nothing about Node versions.
const API_VERSION_SOURCE = '@acorn/protocol/pluginApiVersion.ts'
let apiMajor
try {
  ;({ PLUGIN_API_MAJOR: apiMajor } = await import(API_VERSION_SOURCE))
} catch (error) {
  throw new Error(
    `could not read PLUGIN_API_MAJOR from ${API_VERSION_SOURCE}. This script imports a .ts file directly, `
      + `which needs Node >=22.18 on the 22 LTS line or >=24.4 — this is ${process.version}.\n${error}`,
  )
}
if (!apiMajor) throw new Error(`${API_VERSION_SOURCE} exported no PLUGIN_API_MAJOR`)

// A temporary entry inside apps/node so Vite resolves the workspace package exactly as the app does.
const entryDir = join(NODE_APP, '.plugin-build')
const entryFile = join(entryDir, `${id}.js`)
mkdirSync(entryDir, { recursive: true })
writeFileSync(entryFile, `import { ${spec.factory} } from '${spec.entry}'\nexport default ${spec.factory}()\n`)

try {
  await build({
    root: NODE_APP,
    logLevel: 'warn',
    resolve: { conditions: ['node'], mainFields: ['module', 'jsnext:main', 'jsnext'] },
    ssr: { noExternal: true },
    define: { 'process.env': 'process.env' },
    build: {
      target: 'node22',
      outDir: join(outDir, 'dist'),
      ssr: true,
      minify: false,
      emptyOutDir: true,
      reportCompressedSize: false,
      rollupOptions: {
        input: entryFile,
        // Node builtins only. Everything else — hono, zod, drizzle, every @acorn/* package — is
        // inlined, because a loaded plugin's directory has no node_modules of its own. That means
        // the bundle carries its OWN Hono, and the instance it hands to ctx.providers.integration is
        // not the host's class. Structurally compatible at the same version; if the provider routes
        // ever stop answering after a hono bump, this is the reason.
        external: (source) => builtinModules.includes(source.replace(/^node:/, '')),
        output: { format: 'es', entryFileNames: 'node.js', chunkFileNames: 'chunks/[name]-[hash].js' },
      },
    },
  })

  if (spec.client) {
    const framework = spec.client.framework ? FRAMEWORKS[spec.client.framework] : null
    if (spec.client.framework && !framework) {
      throw new Error(`unknown client framework '${spec.client.framework}' — this builder knows: ${Object.keys(FRAMEWORKS).join(', ')}`)
    }
    await build({
      // The node app's vite.config.ts intentionally externalizes every bare dependency for its SSR
      // artifact. A frame is one self-contained browser file, so it must not inherit that config.
      configFile: false,
      root: NODE_APP,
      logLevel: 'warn',
      plugins: framework ? framework() : [],
      build: {
        target: 'es2022',
        // The node bundle is built first in this process. Be explicit that this second build is a
        // browser bundle so Vite never applies SSR dependency externalization to frame imports.
        ssr: false,
        outDir: join(outDir, 'dist'),
        minify: false,
        emptyOutDir: false,
        reportCompressedSize: false,
        rollupOptions: {
          input: resolve(PLUGINS_DIR, id, spec.client.entry),
          output: {
            format: 'es',
            entryFileNames: 'client.js',
            codeSplitting: false,
          },
        },
      },
    })
  }
} finally {
  rmSync(entryDir, { recursive: true, force: true })
}

// A table-owning plugin's DDL chain travels INSIDE the package, because that is the only copy the
// loader will look at: `ctx.storage.open()` migrates from the manifest-declared directory, confined to
// the installed package (node-core/main/pluginLoader.ts). Copied rather than bundled — Drizzle reads
// `meta/_journal.json` and the `.sql` files off disk at migrate time, so there is nothing for Vite to
// inline.
//
// The declaration is the plugin's (`migrations: './migrations'` in its config); this only checks that
// what it names exists and stages it. A config that declares one and ships nothing is a package that
// fails on first open, which is a worse place to find out than here.
if (spec.migrations) {
  const source = resolve(PLUGINS_DIR, id, spec.migrations)
  if (!existsSync(join(source, 'meta/_journal.json'))) {
    throw new Error(`${id} declares migrations at '${spec.migrations}' but there is no Drizzle chain there`)
  }
  cpSync(source, join(outDir, 'migrations'), { recursive: true })
}

const { version } = JSON.parse(readFileSync(join(PLUGINS_DIR, id, 'package.json'), 'utf8'))
writeFileSync(
  join(outDir, 'acorn-plugin.json'),
  `${JSON.stringify({
    id,
    name: spec.name,
    // Brand marks, passed through untouched — node-core/main/pluginManifest.ts is the only thing
    // that validates them and client-core/ui/Icon.tsx the only thing that renders them.
    ...(spec.icon ? { icon: spec.icon } : {}),
    ...(spec.icons ? { icons: spec.icons } : {}),
    version,
    apiVersion: apiMajor,
    node: './dist/node.js',
    ...(spec.client ? { client: './dist/client.js' } : {}),
    // Always './migrations' in the built package regardless of where the source chain lives, so the
    // manifest path the loader confines is one the builder placed.
    ...(spec.migrations ? { migrations: './migrations' } : {}),
    permissions: spec.permissions,
    contributions: spec.contributions,
  }, null, 2)}\n`,
)

// Mark a package built STRAIGHT INTO the data root as a dev build, so boot reconciliation treats it as
// app-owned and a newer bundled version replaces it. Without this it is indistinguishable from an
// owner-installed package — a directory with bytes nobody has on record — so it was marked `user` and
// then protected from every subsequent app build, which has already cost an hour once and presented as a
// feature that silently did not exist.
//
// Deliberately NOT written under `--package-root`: that output is the distribution path, and a marker
// travelling into application resources would tell every user's node that its bundled plugins are
// somebody's dev build. The name is duplicated in node-core/main/bundledPlugins.ts § DEV_BUILD_MARKER;
// one string in two places beats making this script depend on a built package.
if (!packageRoot) writeFileSync(join(outDir, '.acorn-dev-build'), `${new Date().toISOString()}\n`)

// The `user` ownership row. It means "an owner installed this through the installer", and reconciliation
// checks it first — correctly, because an owner install must never be replaced by a bundled copy. It is
// also easy to acquire by accident (any unrecorded directory in the plugin root earns one), and once a
// package has it, no number of rebuilds of anything reaches the node again.
//
// Read-modify-write of plain JSON rather than importing node-core's writer: this script is ESM run
// directly by node with no build step. Defensive — a missing or unreadable file means there is nothing
// to say.
const statePath = join(dataRoot, 'plugins', 'bundled-state.json')
try {
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  if (state?.plugins?.[id]?.status === 'user') {
    if (packageRoot) {
      // A staging build is not writing into this data root, so it does not get to rewrite its ownership
      // records either — the two could even be different machines' worth of state. But it is the moment
      // the developer finds out, so say what is wrong and what clears it.
      console.warn(`[build-plugin] ${id} has a "user" ownership row in ${dataRoot}, so a bundled copy will not replace it there.`)
      console.warn(`[build-plugin] delete its entry from ${statePath}, or rebuild without --package-root, which clears the row it wrote.`)
    } else {
      // A package built straight into the data root is not an owner install, and any such row is a
      // leftover: without clearing it, a developer who was already trapped stays trapped no matter how
      // many times they rebuild, which is the exact failure this is fixing.
      delete state.plugins[id]
      writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
      console.log(`[build-plugin] cleared the stale "user" ownership row for ${id}`)
    }
  }
} catch {
  // No state file yet, or one this script should not be reading. Either way, nothing to say.
}

console.log(`[build-plugin] ${id} -> ${outDir}`)
if (!packageRoot) console.log('[build-plugin] restart the node to load it')
