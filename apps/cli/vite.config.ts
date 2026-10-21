import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const builtins = new Set(builtinModules)
export default defineConfig({
  resolve: { conditions: ['node'] },
  ssr: { noExternal: true },
  build: {
    target: 'node22',
    outDir: 'dist',
    ssr: true,
    copyPublicDir: false,
    minify: false,
    rollupOptions: {
      input: {
        cli: resolve(import.meta.dirname, 'src/main.ts'),
        'native-host': resolve(import.meta.dirname, 'src/browser/nativeHost.ts'),
        'mobile-gateway': resolve(import.meta.dirname, '../mobile/src/gateway/main.ts'),
        'archive-worker': resolve(import.meta.dirname, '../../packages/node-core/src/server/plugins/archiveWorker.ts'),
      },
      external: (id: string) => builtins.has(id) || builtins.has(id.replace(/^node:/, '')),
      output: { format: 'es', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
})
