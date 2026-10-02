import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { isRuntimeResolved } from '../node/externals'
import { thirdPartyNotices } from '../node/thirdPartyNotices'

// The desktop helper process, bundled because @acorn/* packages ship TypeScript source and Node
// cannot import them out of node_modules. Its third-party dependencies are bundled too, by the node
// service's own rule, because loading them file by file was most of the helper's time before its
// ready line (apps/node/externals.ts).

export default defineConfig({
  // As in apps/node/vite.config.ts: without this Vite's SSR pipeline would externalize node_modules on
  // its own, and the `external` predicate below is meant to be the whole rule.
  ssr: { noExternal: true },
  // Its own name, because the service's notices land in the same folder when staging copies them in.
  plugins: [thirdPartyNotices('helper-THIRD-PARTY-NOTICES.txt')],
  build: {
    // Beside the staged service.js, so both resolve their externals from this package's node_modules
    // and the node finds its migrations chain by the walk-up in node-core's bindings.ts.
    outDir: 'dist/helper',
    emptyOutDir: false,
    // public/ is the renderer's (startup-guard.js), and this build shares its root.
    copyPublicDir: false,
    target: 'node24',
    ssr: true,
    minify: 'oxc',
    // The notices file is an asset, and an SSR build drops emitted assets without this.
    ssrEmitAssets: true,
    rollupOptions: {
      external: isRuntimeResolved,
      input: resolve(import.meta.dirname, 'src/helper/helperMain.ts'),
      output: { entryFileNames: 'helper.js', format: 'es' },
    },
  },
})
