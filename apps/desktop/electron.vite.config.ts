import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

// Bundle our own source (relative imports AND @acorn/* workspace packages); keep every other
// bare/node: specifier external so it's required from node_modules at runtime. Critically this
// keeps the native node-pty (and `electron` itself) out of the bundle — bundling the native
// loader breaks .node resolution.
//
// @acorn/* must stay INTERNAL. Those packages ship TypeScript source (exports './*': './src/*'),
// so externalizing them would emit `import '@acorn/protocol/api.ts'` into out/main and Electron
// would try to load a .ts file at runtime from inside the asar.
const isWorkspacePackage = (id: string) => id.startsWith('@acorn/')
const externalizeBareImports = (id: string) => !id.startsWith('.') && !isAbsolute(id) && !isWorkspacePackage(id)

// externalizeDepsPlugin() externalizes everything listed in dependencies/peerDependencies, so it
// would defeat the rule above on its own. @acorn/* deps are declared in devDependencies (correct
// for a source-only build input, and it keeps them out of the packaged asar), but exclude them
// explicitly too so a stray dependency-section entry cannot silently break the bundle.
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

// service.js, mcp.js and standalone.js are built by @acorn/node, not here: apps/desktop must never
// import apps/node source (docs/architecture-overview.md, enforced by tools/arch/boundaries.test.ts), so
// it embeds the built artifacts instead. Copy them next to index.js, which is where main/bootstrap.ts
// spawns service.js from (`join(import.meta.dirname, 'service.js')`) and where mcpRegister points
// agents.
//
// This copies whatever is on disk and can only detect an artifact that is MISSING, never one that is
// stale — which is why every script that reaches electron-vite (`dev`, `build`, `test:e2e`) runs
// `build:service` first. Relying on turbo's `^build` edge was not enough: `pnpm --filter
// @acorn/desktop test:e2e` invokes the package script directly, with no turbo in the chain, and
// happily staged a 40-minute-old service.js — the e2e suite then tested a service that no longer
// existed in the source tree.
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
        // Electron main only. `service`, `mcp` and `standalone` are built by @acorn/node and copied in by
        // stageNodeArtifact() — see its comment.
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
        // Sandboxed preloads must be CommonJS — emit .cjs (main references ../preload/index.cjs).
        output: { entryFileNames: 'index.cjs', format: 'cjs' },
      },
    },
  },
  renderer: {
    root: __dirname,
    plugins: [
      solid(),
      // Force an absolute base. The renderer is served from Electron main's app:// protocol handler
      // (main/appScheme.ts) — no node serves it at all — and it has
      // client-side deep routes (/:owner/:repo/:number). electron-vite's default relative base ('./')
      // makes ./assets/* resolve against the deep path on a hard reload (Cmd/Ctrl+R), 404 to the app-scheme
      // fallback HTML, and the module script fails its MIME check → blank window. electron-vite's
      // preset (enforce:'pre') force-sets './' in production, so a normal-phase config hook re-sets it.
      // It stays '/' rather than becoming 'app://acorn/': the scheme is `standard`, so /assets/x.js in a
      // document at app://acorn/owner/repo/1 already resolves to app://acorn/assets/x.js — and the
      // emitted HTML keeps the /assets/… literals scripts/check-renderer-budget.mjs parses.
      { name: 'acorn:absolute-base', config: () => ({ base: '/' }) },
    ],
    // Both settings here are load-bearing for the syntax highlighter's Content-Security-Policy:
    // main/appScheme.ts serves ONE worker entry under a relaxed policy and identifies it by filename.
    //
    //   format: 'es'        so the worker can CODE-SPLIT. Under 'iife' rollup cannot emit chunks, so
    //                       every grammar gets inlined and the worker is a single 3.1 MB file; as a
    //                       module it is ~250 KB plus the one or two grammars a given diff touches.
    //                       What it must never become is an inlined BLOB worker — a blob: worker
    //                       inherits the DOCUMENT's CSP, so the relaxation would silently not apply
    //                       and Oniguruma would fail inside it.
    //
    //   entryFileNames      `worker-` prefix, and it is not cosmetic. Vite emits TWO files whose name
    //                       derives from highlighter.worker.ts: the worker entry, and a ~270-byte
    //                       main-thread wrapper that constructs it. Without a prefix both are called
    //                       `highlighter.worker-<hash>.js` and appScheme's pattern cannot tell the
    //                       script that needs the relaxed policy from the one that must not have it.
    //                       `[name]` stays so Monaco's five workers keep their own names — and their
    //                       own, unrelaxed, policy.
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
