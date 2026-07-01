import { isAbsolute, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import solid from 'vite-plugin-solid'

// Bundle our own source (relative imports); keep every bare/node: specifier external so it's
// required from node_modules at runtime. Critically this keeps the native better-sqlite3 (and
// `electron` itself) out of the bundle — bundling the native loader breaks .node resolution.
const externalizeBareImports = (id: string) => !id.startsWith('.') && !isAbsolute(id)

// Three targets (docs/electron.md §4i). externalizeDepsPlugin keeps node_modules (notably the
// native better-sqlite3) external — required at runtime, never bundled. Using rollupOptions.input
// (not lib mode) is what lets that externalization take effect. The renderer is the existing
// SolidJS SPA — no Cloudflare plugin, since the in-process Node server serves both API and the
// renderer build out of dist/client.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: externalizeBareImports,
        input: { index: resolve(__dirname, 'src/main/electron.ts') },
        output: { entryFileNames: 'index.js', format: 'es' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        external: externalizeBareImports,
        input: { index: resolve(__dirname, 'src/main/preload.ts') },
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
