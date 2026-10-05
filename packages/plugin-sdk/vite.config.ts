import { defineConfig } from 'vite'

// Two self-contained browser files, and two node-side ones.
//
// `sdk.js` externalizes nothing, because there is nothing to externalize: its import closure is the
// frame SDK, the bridge protocol's constants, the keybinding helpers and the remote root, none of
// which import a dependency. If a future edit makes it pull in Zod, Solid or anything else, that is
// the signal that the export it followed does not belong on that surface.
//
// `remote.js` is the Solid adapter, and it externalizes Solid. What it must NOT do is carry its own
// copy of the remote root, which holds per-root state: a second copy would give the adapter a
// different root from the one `mountTree` handed it. Both entries reach that module, so Rollup emits
// it once as a shared chunk beside them — which is why `dist` has a chunk beside the named files, and
// why the chunk is as load-bearing as they are.
//
// `data.js` and `testing.js` are for a plugin's node half. They inline the host's record validator from
// @acorn/protocol, which imports nothing, and share the derived source runner as another chunk. They
// import nothing from the frame entries, so a frame-only plugin's bundle never carries them.
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    minify: false,
    emptyOutDir: true,
    reportCompressedSize: false,
    lib: {
      entry: { sdk: 'src/index.ts', remote: 'src/remote/solid.ts', data: 'src/data/index.ts', testing: 'src/testing/index.ts' },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: { external: ['solid-js', 'solid-js/store', 'solid-js/universal', 'acorn-plugin-sdk'] },
  },
})
