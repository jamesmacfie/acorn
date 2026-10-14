import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { BROWSER_BRIDGE_DEV_HOST, BROWSER_BRIDGE_HOST } from '@acorn/protocol/extensionBridge.ts'
import { extensionManifest } from './src/manifest'

// One build per browser, chosen by mode: `vite build --mode chrome` or `--mode firefox`. The output
// is an unpacked extension: the sidebar page, the background entry at a fixed name the manifest
// names, the content script the background injects into pages that get a task chip, and the manifest. Everything ships in the package; nothing loads remote code.
//
// ACORN_EXTENSION_HOST=development points the build at the development native host, and
// ACORN_EXTENSION_OUT_DIR moves the output. `pnpm dev:extension` sets both for its session.
export default defineConfig(({ mode }) => {
  const browser = mode === 'firefox' ? 'firefox' : 'chrome'
  const development = process.env.ACORN_EXTENSION_HOST === 'development'
  const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as {
    version: string
  }
  return {
    root: import.meta.dirname,
    base: './',
    plugins: [
      solid(),
      {
        name: 'acorn:extension-manifest',
        generateBundle(_options, bundle) {
          // The background injects the content script as one classic script, which can't import. A
          // shared chunk would break it in every page, so the build fails instead.
          const content = Object.values(bundle).find((chunk) => chunk.type === 'chunk' && chunk.name === 'content')
          if (content?.type === 'chunk' && (content.imports.length || content.dynamicImports.length))
            this.error('content.js must not import anything: keep src/content/ to type imports.')
          this.emitFile({
            type: 'asset',
            fileName: 'manifest.json',
            source: `${JSON.stringify(extensionManifest(browser, version), null, 2)}\n`,
          })
        },
      },
    ],
    define: { __ACORN_NATIVE_HOST__: JSON.stringify(development ? BROWSER_BRIDGE_DEV_HOST : BROWSER_BRIDGE_HOST) },
    build: {
      outDir: process.env.ACORN_EXTENSION_OUT_DIR ?? resolve(import.meta.dirname, 'dist', browser),
      emptyOutDir: true,
      target: 'es2022',
      // A module service worker can't load the preload helper's dynamic imports.
      modulePreload: false,
      rollupOptions: {
        input: {
          sidebar: resolve(import.meta.dirname, 'sidebar.html'),
          background: resolve(import.meta.dirname, 'src/background/main.ts'),
          content: resolve(import.meta.dirname, 'src/content/siteButtons.ts'),
        },
        output: {
          // Fixed names for the two files the extension names itself: the manifest's background and
          // the content script the background injects.
          entryFileNames: (chunk) =>
            chunk.name === 'background' || chunk.name === 'content' ? `${chunk.name}.js` : 'assets/[name]-[hash].js',
        },
      },
    },
  }
})
