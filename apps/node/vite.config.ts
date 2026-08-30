import { builtinModules } from 'node:module'
import { isAbsolute, resolve } from 'node:path'
import { defineConfig } from 'vite'

const isWorkspacePackage = (id: string) => id.startsWith('@acorn/')
const externalizeBareImports = (id: string) => !id.startsWith('.') && !isAbsolute(id) && !isWorkspacePackage(id)

export default defineConfig({
  // Node resolution, not browser: prefer the `node` condition and never the `browser` field.
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  // `noExternal` only decides what Vite's SSR pipeline would auto-externalize; the `external` predicate
  // below is the real rule.
  ssr: { noExternal: true },
  // Keep `process.env` a runtime lookup: the service reads SESSION_ENC_KEY and ACORN_PORT from the
  // environment it's spawned with, and the optional GitHub plugin reads its own client id there.
  define: {
    'process.env': 'process.env',
    'global.process.env': 'global.process.env',
    'globalThis.process.env': 'globalThis.process.env',
  },
  build: {
    // Both deployments run a current Node: the desktop stages a pinned runtime
    // (apps/desktop/scripts/node-runtime.mjs) and the standalone node runs the machine's. node22 is
    // the floor of the two, and downlevelling past it costs output for nothing.
    target: 'node22',
    outDir: 'dist',
    assetsDir: 'chunks',
    ssr: true,
    ssrEmitAssets: true,
    modulePreload: false,
    copyPublicDir: false,
    reportCompressedSize: false,
    minify: false,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        service: resolve(__dirname, 'src/entries/service.ts'),
        mcp: resolve(__dirname, 'src/entries/mcp.ts'),
        standalone: resolve(__dirname, 'src/entries/standalone.ts'),
      },
      // node: builtins are listed explicitly as well as caught by the predicate, so a bare
      // `import 'path'` with no node: prefix can never be bundled either.
      external: (id: string) =>
        externalizeBareImports(id) || builtinModules.includes(id.replace(/^node:/, '')),
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'chunks/[name]-[hash].[ext]',
      },
    },
  },
})
