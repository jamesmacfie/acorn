import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { isRuntimeResolved } from './externals'
import { thirdPartyNotices } from './thirdPartyNotices'

export default defineConfig({
  plugins: [thirdPartyNotices('THIRD-PARTY-NOTICES.txt')],
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
        'plugin-worker': resolve(__dirname, '../../packages/node-core/src/server/plugins/nodePluginWorker.ts'),
      },
      // Builtins and the few packages that have to be installed; everything else is bundled
      // (./externals.ts).
      external: isRuntimeResolved,
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'chunks/[name]-[hash].[ext]',
      },
    },
  },
})
