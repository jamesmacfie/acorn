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
  // `noExternal` only decides what Vite's SSR pipeline would auto-externalize; the `external`
  // predicate below is the real rule.
  ssr: { noExternal: true },
  // Keep `process.env` a runtime lookup — the service reads SESSION_ENC_KEY, GITHUB_CLIENT_* and
  // ACORN_PORT from the environment it is spawned with, so a build-time substitution would bake in
  // the builder's environment.
  define: {
    'process.env': 'process.env',
    'global.process.env': 'global.process.env',
    'globalThis.process.env': 'globalThis.process.env',
  },
  build: {
    // Electron 42 ships Node 22, and the standalone deployment targets current Node. (electron-vite
    // has no entry for Electron 42 and silently falls back to node16.17, which downlevels far more
    // than either runtime needs.)
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
        service: resolve(__dirname, 'src/service/index.ts'),
        mcp: resolve(__dirname, '../../packages/node-core/src/mcp/main.ts'),
        standalone: resolve(__dirname, 'src/server/standalone.ts'),
      },
      // node: builtins are listed explicitly as well as caught by the predicate, so a bare
      // `import 'path'` (no node: prefix) can never be bundled either.
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
