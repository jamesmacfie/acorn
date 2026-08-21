import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

// Bundle our own source (relative imports and @acorn/* workspace packages); keep every other
// bare/node: specifier external so it is required from node_modules at runtime. This keeps the
// native node-pty (and electron itself) out of the bundle, since bundling the native loader breaks
// .node resolution.
//
// @acorn/* packages stay internal to the bundle. They ship TypeScript source
// (exports './*': './src/*'), so externalizing them would emit `import '@acorn/protocol/api.ts'`
// into out/main, and Electron would try to load a .ts file at runtime from inside the asar.
const isWorkspacePackage = (id: string) => id.startsWith('@acorn/')
const externalizeBareImports = (id: string) => !id.startsWith('.') && !isAbsolute(id) && !isWorkspacePackage(id)

// externalizeDepsPlugin() externalizes everything listed in dependencies/peerDependencies, which
// would defeat the rule above on its own. @acorn/* deps are declared in devDependencies (correct for
// a source-only build input, and it keeps them out of the packaged asar), but they are excluded here
// too so a stray dependency-section entry cannot silently break the bundle.
const workspacePackages = Object.keys(
  (JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }).devDependencies ?? {},
).filter(isWorkspacePackage)

const chainDirs = () => {
  const out: { plugin: string | null; dir: string }[] = []
  const coreChain = resolve(__dirname, '../../packages/node-core/migrations')
  if (existsSync(coreChain)) out.push({ plugin: null, dir: coreChain })
  const pluginsRoot = resolve(__dirname, '../../plugins')
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = resolve(pluginsRoot, entry.name, 'migrations')
    if (existsSync(resolve(dir, 'meta/_journal.json'))) out.push({ plugin: entry.name, dir })
  }
  return out
}

const stageMigrations = () => ({
  name: 'acorn:stage-migrations',
  closeBundle() {
    const staged: string[] = []
    for (const chain of chainDirs()) {
      const target = chain.plugin ? resolve(__dirname, 'out/migrations', chain.plugin) : resolve(__dirname, 'out/migrations')
      cpSync(chain.dir, target, { recursive: true })
      staged.push(chain.plugin ?? 'core')
    }
    console.log(`[stage-migrations] ${staged.length} chain(s): ${staged.join(', ')}`)
  },
})

// Why the desktop build never imports apps/node source and instead stages the built artifacts, and
// why the build order matters here: docs/electron.md § Build and packaging,
// docs/architecture-overview.md § Package boundaries.
const stageNodeArtifact = () => ({
  name: 'acorn:stage-node-artifact',
  closeBundle() {
    const dist = resolve(__dirname, '../node/dist')
    if (!existsSync(resolve(dist, 'service.js'))) {
      throw new Error('apps/node/dist/service.js is missing — run `pnpm --filter @acorn/node build` first.')
    }
    cpSync(dist, resolve(__dirname, 'out/main'), { recursive: true })
  },
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages }), stageMigrations(), stageNodeArtifact()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: externalizeBareImports,
        // Electron main only: docs/electron.md § Build and packaging.
        input: {
          index: resolve(__dirname, 'src/app/main/electron.ts'),
        },
        output: { entryFileNames: '[name].js', format: 'es' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePackages })],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        external: externalizeBareImports,
        input: { index: resolve(__dirname, 'src/app/main/preload.ts') },
        // Sandboxed preloads must be CommonJS, so this emits .cjs (main references ../preload/index.cjs).
        output: { entryFileNames: 'index.cjs', format: 'cjs' },
      },
    },
  },
  renderer: {
    root: __dirname,
    plugins: [
      solid(),
      // Forces an absolute base. The renderer is served from Electron main's app:// protocol handler
      // (main/appScheme.ts), not by any node, and it has client-side deep routes
      // (/:owner/:repo/:number). electron-vite's default relative base ('./') makes ./assets/*
      // resolve against the deep path on a hard reload, 404 to the app-scheme fallback HTML, and fail
      // the module script's MIME check, which blanks the window. electron-vite's own preset
      // (enforce: 'pre') force-sets './' in production, so this normal-phase hook re-sets it
      // afterward. It stays '/' rather than becoming 'app://acorn/': the scheme is `standard`, so
      // /assets/x.js in a document at app://acorn/owner/repo/1 already resolves to
      // app://acorn/assets/x.js, and the emitted HTML keeps the /assets/... literals
      // scripts/check-renderer-budget.mjs parses.
      { name: 'acorn:absolute-base', config: () => ({ base: '/' }) },
    ],
    // Why format and entryFileNames matter for the highlighter worker's Content-Security-Policy:
    // docs/electron.md § The syntax-highlighter worker's separate policy.
    worker: {
      format: 'es',
      rollupOptions: { output: { entryFileNames: 'assets/worker-[name]-[hash].js' } },
    },
    build: {
      outDir: 'dist/client',
      rollupOptions: { input: resolve(__dirname, 'index.html') },
    },
  },
})
