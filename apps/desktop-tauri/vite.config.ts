import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { rendererConfig } from '../desktop/vite.renderer.config'

// The renderer, built from apps/desktop's source by the shared config phase 1 extracted
// (docs/future/tauri/dev-workflow.md). Nothing about the client changes for this shell: the host
// global arrives as a webview initialization script instead of a preload, which is `src/client/bridge.ts`
// and `vite.bridge.config.ts`, and the page itself never learns which shell it is in.
//
// The Vite root is apps/desktop because that is where index.html and the client source live. When the
// Electron package goes at cutover, the source moves here and this line becomes `import.meta.dirname`.
const DESKTOP = resolve(import.meta.dirname, '../desktop')
const base = rendererConfig(DESKTOP)

export default defineConfig({
  ...base,
  build: { ...base.build, outDir: resolve(import.meta.dirname, 'dist/client'), emptyOutDir: true },
  // Rust edits must not retrigger the renderer, and the port is fixed so tauri.conf.json's devUrl and
  // the shell's dev-only CSP can both name it.
  clearScreen: false,
  server: { port: 4319, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
})
