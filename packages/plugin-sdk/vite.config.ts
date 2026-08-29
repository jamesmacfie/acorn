import { defineConfig } from 'vite'

// Two self-contained browser files.
//
// `sdk.js` externalizes nothing, because there is nothing to externalize: its import closure is the
// frame SDK, the bridge protocol's constants, the keybinding helpers and the remote root, none of
// which import a dependency. If a future edit makes it pull in Zod, Solid or anything else, that is
// the signal that the export it followed does not belong on that surface.
//
// `remote.js` is the Solid adapter, and it externalizes Solid. What it must NOT do is carry its own
// copy of the remote root, which holds per-root state: a second copy would give the adapter a
// different root from the one `mountTree` handed it. Both entries reach that module, so Rollup emits
// it once as a shared chunk beside them — which is why `dist` is three files rather than two, and why
// the chunk is as load-bearing as the two named ones.
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    minify: false,
    emptyOutDir: true,
    reportCompressedSize: false,
    lib: {
      entry: { sdk: 'src/index.ts', remote: 'src/remote/solid.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: { external: ['solid-js', 'solid-js/store', 'solid-js/universal', 'acorn-plugin-sdk'] },
  },
})
