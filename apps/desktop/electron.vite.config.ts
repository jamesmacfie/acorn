import { cpSync, existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

// Bundle our own source (relative imports AND @acorn/* workspace packages); keep every other
// bare/node: specifier external so it's required from node_modules at runtime. Critically this
// keeps the native better-sqlite3 (and `electron` itself) out of the bundle — bundling the native
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

// Three targets (docs/electron.md §4i). externalizeDepsPlugin keeps node_modules (notably the
// native better-sqlite3) external — required at runtime, never bundled. Using rollupOptions.input
// (not lib mode) is what lets that externalization take effect. The renderer is the existing
// SolidJS SPA — no Cloudflare plugin, since the in-process Node server serves both API and the
// renderer build out of dist/client.
// node-core owns schema.ts and therefore its migrations. The service bundle resolves them by
// walking ancestors from its own location, so stage a copy above out/main.
const stageMigrations = () => ({
  name: 'acorn:stage-migrations',
  closeBundle() {
    cpSync(
      resolve(__dirname, '../../packages/node-core/migrations'),
      resolve(__dirname, 'out/migrations'),
      { recursive: true },
    )
  },
})

// service.js and mcp.js are built by @acorn/node, not here: apps/desktop must never import
// apps/node source (docs/vNext/architecture.md, enforced by tools/arch/boundaries.test.ts), so it
// embeds the built artifact instead. Copy it next to index.js, which is where main/bootstrap.ts
// forks it from (`join(import.meta.dirname, 'service.js')`) and where mcpRegister points agents.
// turbo's `build` task depends on `^build`, and @acorn/node is a devDependency, so the artifact
// exists by the time this runs.
const stageNodeArtifact = () => ({
  name: 'acorn:stage-node-artifact',
  closeBundle() {
    const dist = resolve(__dirname, '../node/dist')
    if (!existsSync(resolve(dist, 'service.js'))) {
      throw new Error(
        'apps/node/dist/service.js is missing — run `pnpm --filter @acorn/node build` first '
        + '(turbo does this automatically via the @acorn/node devDependency).',
      )
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
        // Electron main only. `service` and `mcp` are built by @acorn/node and copied in by
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
      // Force an absolute base. The renderer is served over http by the in-process Node server with
      // client-side deep routes (/:owner/:repo/:number); electron-vite's default relative base ('./')
      // makes ./assets/* resolve against the deep path on a hard reload (Cmd/Ctrl+R), 404 to the SPA
      // fallback HTML, and the module script fails its MIME check → blank window. electron-vite's
      // preset (enforce:'pre') force-sets './' in production, so a normal-phase config hook re-sets it.
      { name: 'acorn:absolute-base', config: () => ({ base: '/' }) },
    ],
    build: {
      outDir: 'dist/client',
      rollupOptions: { input: resolve(__dirname, 'index.html') },
    },
  },
})
