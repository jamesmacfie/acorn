import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// The renderer. Nothing here knows which shell it is in: the host global arrives as a webview
// initialization script (`vite.bridge.config.ts`) rather than as anything the page imports, which is
// the platform seam's whole point.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    solid(),
    // Forces an absolute base. The renderer is served from the shell's own protocol handler
    // (`src-tauri/src/app_scheme.rs`), not by any node, and it has client-side deep routes
    // (/:owner/:repo/:number). A relative base ('./') makes ./assets/* resolve against the deep path
    // on a hard reload, 404 to the app-scheme fallback HTML, and fail the module script's MIME
    // check, which blanks the window. It stays '/' rather than becoming 'app://acorn/': the scheme
    // is `standard`, so /assets/x.js in a document at app://acorn/owner/repo/1 already resolves to
    // app://acorn/assets/x.js, and the emitted HTML keeps the /assets/... literals
    // scripts/check-renderer-budget.mjs parses.
    { name: 'acorn:absolute-base', config: () => ({ base: '/' }) },
  ],
  // Which host the kit draws to (client-core kit/tokens/support.ts). Stated rather than left to the
  // default, so the two host packages read the same way and a bundle that lands on the wrong one is a
  // grep away.
  define: { __ACORN_HOST__: '"dom"' },
  // Why format and entryFileNames matter for the highlighter worker's Content-Security-Policy:
  // docs/shell.md § The syntax-highlighter worker's separate policy. The `worker-` prefix is what
  // the CSP's filename match keys on.
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'assets/worker-[name]-[hash].js' } },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'index.html') },
  },
  // Rust edits must not retrigger the renderer, and the port is fixed so tauri.dev.json's devUrl and
  // the shell's dev-only CSP can both name it.
  //
  // `.acorn` is a data root, not source. A node puts its worktrees there, so under a checkout it can
  // hold whole clones of unrelated repositories, and Vite's own ignores cover node_modules and .git
  // but not this. Left in, a cold start crawls and watches tens of thousands of files nobody is
  // editing.
  clearScreen: false,
  server: { port: 4319, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/.acorn/**'] } },
})
