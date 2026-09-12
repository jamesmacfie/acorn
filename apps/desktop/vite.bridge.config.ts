import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// The renderer bridge, as one self-contained script the shell injects into the webview before any page
// script runs. That is what a preload is, and injecting it rather than importing it from the entry is
// what keeps `src/client/index.tsx` shell-agnostic — the seam's whole point.
//
// IIFE, not a module: a webview initialization script is evaluated as a classic script, so it cannot
// carry `import`.
export default defineConfig({
  build: {
    outDir: 'dist/bridge',
    emptyOutDir: true,
    // The oldest engine any target ships. Nothing here is exotic; this only stops a downlevel
    // transform adding a helper the IIFE would then need to import.
    target: 'safari15',
    lib: {
      entry: resolve(import.meta.dirname, 'src/shell/bridge.ts'),
      formats: ['iife'],
      name: 'acornBridge',
      fileName: () => 'bridge.js',
    },
  },
})
