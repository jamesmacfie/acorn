import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { BROWSER_BRIDGE_DEV_HOST, BROWSER_BRIDGE_HOST } from '@acorn/protocol/extensionBridge.ts'
import { extensionManifest } from './src/manifest'

// One build per browser, chosen by mode: `vite build --mode chrome` or `--mode firefox`. The output
// is an unpacked extension: the sidebar page, the background entry at a fixed name the manifest
// names, the content scripts the background injects into pages (the task chip's, and the element
// picker's), and the manifest. Everything ships in the package; nothing loads remote code.
//
// ACORN_EXTENSION_HOST=development points the build at the development native host, and
// ACORN_EXTENSION_OUT_DIR moves the output. `pnpm dev:extension` sets both for its session.
const CONTENT_SCRIPTS = ['content', 'picker']

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
        // The background injects both content scripts into one page's isolated world, where classic
        // scripts share a global scope, so each runs in its own function or one's minified names
        // overwrite the other's.
        renderChunk(code, chunk) {
          return CONTENT_SCRIPTS.includes(chunk.name) ? `(() => {\n${code}\n})()\n` : null
        },
        generateBundle(_options, bundle) {
          // The background injects each content script as one classic script, which can't import. A
          // shared chunk would break it in every page, so the build fails instead.
          for (const chunk of Object.values(bundle))
            if (chunk.type === 'chunk' && CONTENT_SCRIPTS.includes(chunk.name))
              if (chunk.imports.length || chunk.dynamicImports.length)
                this.error(`${chunk.name}.js must not import anything: keep src/content/ to type imports.`)
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
          picker: resolve(import.meta.dirname, 'src/content/picker.ts'),
        },
        output: {
          // Fixed names for the files the extension names itself: the manifest's background and the
          // content scripts the background injects.
          entryFileNames: (chunk) =>
            chunk.name === 'background' || CONTENT_SCRIPTS.includes(chunk.name)
              ? `${chunk.name}.js`
              : 'assets/[name]-[hash].js',
        },
      },
    },
  }
})
