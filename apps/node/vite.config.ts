import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { describeChunks } from '../../scripts/chunkGraph.mts'
import { isRuntimeResolved } from './externals'
import { thirdPartyNotices } from './thirdPartyNotices'

export default defineConfig({
  plugins: [thirdPartyNotices('THIRD-PARTY-NOTICES.txt'), {
    name: 'memory-contract',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/plugins/memory/src/server/standingContext.ts')) return
      const contract = readFileSync(resolve(__dirname, '../../plugins/memory/src/server/memoryContract.md'), 'utf8')
      return code.replace("readFileSync(new URL('./memoryContract.md', import.meta.url), 'utf8')", JSON.stringify(contract))
    },
  }, {
    // Every chunk's edges, external packages, source modules, and emitted size (scripts/chunkGraph.mts),
    // which the service budget, the size report, and the standalone manifest check all read. The
    // startup closure is service.js and everything it imports statically; a dynamic import is
    // post-startup. Staging and the standalone tarball leave this file out.
    name: 'acorn:service-startup-graph',
    apply: 'build',
    generateBundle(_options, bundle) {
      // A loaded-plugin package build reuses this config (scripts/build-plugin.mjs). It has no service
      // entry, and its package ships whatever lands in its dist.
      if (!bundle['service.js']) return
      const chunks = describeChunks(this, bundle, resolve(__dirname, '../..'))
      this.emitFile({ type: 'asset', fileName: 'startup-graph.json', source: JSON.stringify({ entry: 'service.js', roots: ['service.js'], chunks }) })
    },
  }],
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
    // Oxc halves the startup graph's bytes. `keepNames` below keeps function and class names, so a
    // packaged stack still reads `at createSession`, and the hidden source maps stay in dist for the
    // matching-build lookup (docs/local-development/packaged-stacks.md § Find the source line). Staging
    // and the standalone tarball leave the maps out.
    minify: 'oxc',
    sourcemap: 'hidden',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        service: resolve(__dirname, 'src/entries/service.ts'),
        mcp: resolve(__dirname, 'src/entries/mcp.ts'),
        'loop-hook': resolve(__dirname, 'src/entries/loop-hook.ts'),
        'file-guard': resolve(__dirname, 'src/entries/file-guard.ts'),
        standalone: resolve(__dirname, 'src/entries/standalone.ts'),
        'archive-worker': resolve(__dirname, '../../packages/node-core/src/server/plugins/archiveWorker.ts'),
        'plugin-worker': resolve(__dirname, '../../packages/node-core/src/server/plugins/nodePluginWorker.ts'),
      },
      // Builtins and the few packages that have to be installed; everything else is bundled
      // (./externals.ts).
      external: isRuntimeResolved,
      output: {
        format: 'es',
        keepNames: true,
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'chunks/[name]-[hash].[ext]',
      },
    },
  },
})
