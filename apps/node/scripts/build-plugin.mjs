#!/usr/bin/env node
// Build a first-party plugin's node half into a loadable package, so the loader can be dogfooded
// against real code instead of a test fixture (docs/third-party/phase-1-node-loader.md § Dogfood).
//
//   pnpm --filter @acorn/node build:plugin rollbar
//   ACORN_UNSAFE_PLUGINS=1 pnpm dev:node
//
// The result is `<dataRoot>/plugins/<id>/` holding a generated `acorn-plugin.json` and an ESM bundle
// that default-exports a NodePlugin. On the next flagged boot the loader picks it up and the
// compiled-in copy steps aside (main/pluginLoader.ts § shadowing), so what runs IS the disk copy.
//
// ## Why Vite and not esbuild
//
// The phase doc said esbuild; there is none in this workspace, and apps/node already bundles itself
// with Vite using exactly the settings a plugin bundle needs (ESM out, node builtins external,
// workspace packages inlined). Adding a second bundler to run the same job would be a dependency
// bought for nothing.
//
// ## Dev only, and honest about it
//
// This is not the distribution story — phase 2 is. Two things here only work from a checkout:
// the bundle inlines first-party source rather than resolving it, and anything that stays external
// resolves through the repo's own node_modules because the dev data root lives inside the repo.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(NODE_APP, '../..')

// One row per plugin that can be built this way. `factory` is the exported function the node half
// declares; the loader wants a default-exported NodePlugin, so the generated entry calls it.
//
// `permissions` is the manifest's node block. Rollbar's is empty and that is the interesting part:
// it registers an integration provider through ctx and touches no CoreServices facet at all, so the
// permission-shaped context it receives is a context with no `core` facets on it whatsoever.
const PLUGINS = {
  rollbar: {
    package: '@acorn/plugin-rollbar',
    entry: '@acorn/plugin-rollbar/node/index.ts',
    factory: 'rollbarPlugin',
    permissions: {},
  },
}

const id = process.argv[2]
const spec = PLUGINS[id]
if (!spec) {
  console.error(`Usage: build-plugin.mjs <${Object.keys(PLUGINS).join('|')}>`)
  process.exit(1)
}

// Matches main/serverPaths.ts's dev root, and honours the same override the node itself reads.
const dataRoot = process.env.ACORN_DATA_DIR || join(NODE_APP, '.acorn')
const outDir = join(dataRoot, 'plugins', id)
const apiMajor = /PLUGIN_API_MAJOR = '([^']+)'/.exec(
  readFileSync(join(ROOT, 'packages/node-core/src/main/pluginManifest.ts'), 'utf8'),
)?.[1]
if (!apiMajor) throw new Error('could not read PLUGIN_API_MAJOR from packages/node-core/src/main/pluginManifest.ts')

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
} finally {
  rmSync(entryDir, { recursive: true, force: true })
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'plugins', id, 'package.json'), 'utf8'))
writeFileSync(
  join(outDir, 'acorn-plugin.json'),
  `${JSON.stringify({
    id,
    name: `${id} (built from source)`,
    version,
    apiVersion: apiMajor,
    node: './dist/node.js',
    permissions: { node: spec.permissions },
  }, null, 2)}\n`,
)

// Migrations are deliberately not staged. pluginMigrationsFolder walks UP from the bundle's own
// import.meta.url, which from inside a data root ascends somewhere meaningless — so a loaded plugin
// that owns a database needs a manifest-driven migrations path first. Rollbar owns no database,
// which is exactly why it is the guinea pig.
console.log(`[build-plugin] ${id} -> ${outDir}`)
console.log(`[build-plugin] boot with ACORN_UNSAFE_PLUGINS=1 to load it instead of the built-in`)
