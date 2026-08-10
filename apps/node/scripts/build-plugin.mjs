#!/usr/bin/env node
// Build a repository plugin into a loadable package, so the loader can be dogfooded
// against real code instead of a test fixture (docs/plugins.md).
//
//   pnpm --filter @acorn/node build:plugin rollbar
//   pnpm --filter @acorn/node build:plugin rollbar -- --package-root /path/to/resources/plugins
//   pnpm dev:node
//
// The result is `<dataRoot>/plugins/<id>/` holding a generated `acorn-plugin.json` plus one ESM
// bundle per declared runtime. On the next boot the loader picks it up like any installed package.
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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import solid from 'vite-plugin-solid'

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(NODE_APP, '../..')

// One row per plugin that can be built this way. `factory` is the exported function the node half
// declares; the loader wants a default-exported NodePlugin, so the generated entry calls it.
const PLUGINS = {
  rollbar: {
    name: 'Rollbar',
    package: '@acorn/plugin-rollbar',
    entry: '@acorn/plugin-rollbar/node/index.ts',
    factory: 'rollbarPlugin',
    client: {
      entry: resolve(ROOT, 'plugins/rollbar/src/frame/index.tsx'),
      // A frame owns its realm and bundle, so its Solid graph is intentionally independent from the
      // shell's. The build seam stays framework-agnostic: transforms are opt-in per package, and a
      // React/Vue/vanilla frame supplies its own Vite plugins (or none) here instead.
      vitePlugins: [solid()],
    },
    permissions: {
      api: ['core.tasks:read'],
      events: [],
      node: { core: ['projects:read'], capabilities: [], secrets: true, exec: false, net: ['api.rollbar.com'] },
    },
    contributions: {
      frames: [{ target: 'pane', id: 'rollbar', label: 'Rollbar', glyph: 'circle-dot', order: 100 }],
      sources: [{
        id: 'rollbar-items',
        label: 'Rollbar',
        glyph: 'circle-dot',
        order: 30,
        providerId: 'rollbar',
        items: '/v2/p/rollbar/rail-items',
        onSelect: { verb: 'openPane', pane: 'rollbar' },
      }],
      commands: [{
        id: 'open',
        title: 'Rollbar: open linked items',
        category: 'pane',
        palette: false,
        action: { verb: 'openPane', pane: 'rollbar' },
      }],
      keybindings: [{ command: 'open', defaultChord: 'meta+shift+o', when: 'task' }],
    },
  },
  // The smallest thing this table can describe, and the two absences are the interesting part.
  //
  // No `client` key, because there is no frame — the plugin registers two connection providers and two
  // model adapters and stops. Nothing of it executes on the device, so no client bundle is built, no
  // hash is cached, and no trust prompt is ever raised; the integrations settings list is drawn by the
  // host from the connection providers the node reports, exactly as it was when this was compiled in.
  //
  // `secrets: false`, because the adapter never fetches a credential. Core resolves the `integrations`
  // row inside its own secret scope and hands `generateText` the key, so `ctx.core.secrets` would be a
  // grant with no call site. The plugin touches no CoreServices facet at all, hence `core: []`.
  //
  // And no routes, so `contributions: {}` — a consumer owns its own route and calls
  // `CoreServices.models.generateText`; see the header of plugins/model-providers/src/node/index.ts
  // for why a generic model endpoint is deliberately absent.
  'model-providers': {
    name: 'Model Providers',
    package: '@acorn/plugin-model-providers',
    entry: '@acorn/plugin-model-providers/node/index.ts',
    factory: 'modelProvidersPlugin',
    permissions: {
      api: [],
      events: [],
      // These two are where the SDKs go by default, and a stored connection cannot redirect them: the
      // provider declares one `apiKey` field and normalizes to an empty `config`, so there is no
      // user-supplied base URL. The PROCESS environment can still redirect both — `openai` reads
      // OPENAI_BASE_URL and `@anthropic-ai/sdk` reads ANTHROPIC_BASE_URL — and since `net` is
      // disclosure rather than enforcement, that is worth saying here rather than leaving a reader to
      // conclude the list is exhaustive.
      node: { core: [], capabilities: [], secrets: false, exec: false, net: ['api.openai.com', 'api.anthropic.com'] },
    },
    contributions: {},
  },
}

const args = process.argv.slice(2)
const id = args[0]
const spec = PLUGINS[id]
if (!spec) {
  console.error(`Usage: build-plugin.mjs <${Object.keys(PLUGINS).join('|')}> [--package-root <directory>]`)
  process.exit(1)
}
const packageRootIndex = args.indexOf('--package-root')
const packageRoot = packageRootIndex === -1 ? null : args[packageRootIndex + 1]
if (packageRootIndex !== -1 && !packageRoot) throw new Error('--package-root requires a directory')

// Matches main/serverPaths.ts's dev root, and honours the same override the node itself reads.
const dataRoot = process.env.ACORN_DATA_DIR || join(NODE_APP, '.acorn')
const outDir = join(packageRoot ? resolve(packageRoot) : join(dataRoot, 'plugins'), id)
// Read from protocol, which is where the constant is DECLARED — node-core re-exports it, and a regex
// over the re-export would find the name without a value.
const API_MAJOR_SOURCE = 'packages/protocol/src/api.ts'
const apiMajor = /PLUGIN_API_MAJOR = '([^']+)'/.exec(readFileSync(join(ROOT, API_MAJOR_SOURCE), 'utf8'))?.[1]
if (!apiMajor) throw new Error(`could not read PLUGIN_API_MAJOR from ${API_MAJOR_SOURCE}`)

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
    await build({
      // The node app's vite.config.ts intentionally externalizes every bare dependency for its SSR
      // artifact. A frame is one self-contained browser file, so it must not inherit that config.
      configFile: false,
      root: NODE_APP,
      logLevel: 'warn',
      plugins: spec.client.vitePlugins ?? [],
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
          input: spec.client.entry,
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

const { version } = JSON.parse(readFileSync(join(ROOT, 'plugins', id, 'package.json'), 'utf8'))
writeFileSync(
  join(outDir, 'acorn-plugin.json'),
  `${JSON.stringify({
    id,
    name: spec.name,
    version,
    apiVersion: apiMajor,
    node: './dist/node.js',
    ...(spec.client ? { client: './dist/client.js' } : {}),
    permissions: spec.permissions,
    contributions: spec.contributions,
  }, null, 2)}\n`,
)

// Neither plugin in the table owns a database, so nothing built here needs a manifest `migrations`
// entry. A loaded table-owning plugin stages its chain inside the package, declares that relative
// directory, and opens its host-bound database through ctx.storage.
console.log(`[build-plugin] ${id} -> ${outDir}`)
if (!packageRoot) console.log('[build-plugin] restart the node to load it')
