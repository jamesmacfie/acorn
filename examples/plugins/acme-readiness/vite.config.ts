import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

// The node half, as one ESM file with every dependency inlined. An installed plugin is a bare
// directory with no node_modules beside it, so a bare import left in the bundle fails on every
// machine but this one.
export default defineConfig({
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: true,
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    reportCompressedSize: false,
    rollupOptions: {
      input: 'src/index.ts',
      external: (id) => builtinModules.includes(id.replace(/^node:/, '')),
      output: { format: 'es', entryFileNames: 'node.js', codeSplitting: false },
    },
  },
})
