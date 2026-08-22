import { resolve } from 'node:path'
import type { UserConfig } from 'vite'
import solid from 'vite-plugin-solid'

// The renderer's Vite config, on its own so both shells build the same client from the same rules
// rather than from two copies that drift (docs/future/tauri/dev-workflow.md § Design). It is a
// function of the app root because that is the only thing the two shells disagree about; everything
// else here, the worker rules especially, is load-bearing for both.
//
// It lives in apps/desktop for now because that is the only shell there is. When the Tauri package
// lands it takes ownership of this file and apps/desktop keeps importing it, which is the whole point
// of the extraction: one definition, two consumers.
export const rendererConfig = (root: string): UserConfig => ({
  root,
  plugins: [
    solid(),
    // Forces an absolute base. The renderer is served from a shell's own protocol handler
    // (Electron: main/appScheme.ts), not by any node, and it has client-side deep routes
    // (/:owner/:repo/:number). A relative base ('./', electron-vite's default) makes ./assets/*
    // resolve against the deep path on a hard reload, 404 to the app-scheme fallback HTML, and fail
    // the module script's MIME check, which blanks the window. electron-vite's own preset
    // (enforce: 'pre') force-sets './' in production, so this normal-phase hook re-sets it
    // afterward. It stays '/' rather than becoming 'app://acorn/': the scheme is `standard`, so
    // /assets/x.js in a document at app://acorn/owner/repo/1 already resolves to
    // app://acorn/assets/x.js, and the emitted HTML keeps the /assets/... literals
    // scripts/check-renderer-budget.mjs parses.
    { name: 'acorn:absolute-base', config: () => ({ base: '/' }) },
  ],
  // Why format and entryFileNames matter for the highlighter worker's Content-Security-Policy:
  // docs/electron.md § The syntax-highlighter worker's separate policy. The `worker-` prefix is what
  // the CSP's filename match keys on, so it travels with this config to every shell.
  worker: {
    format: 'es',
    rollupOptions: { output: { entryFileNames: 'assets/worker-[name]-[hash].js' } },
  },
  build: {
    outDir: 'dist/client',
    rollupOptions: { input: resolve(root, 'index.html') },
  },
})
