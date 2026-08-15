import { defineConfig } from 'vite'

// One self-contained browser file. Nothing is externalized because there is nothing to externalize:
// the entry's import closure is the frame SDK, the bridge protocol's constants and the keybinding
// helpers, none of which import a dependency. If a future edit makes this bundle pull in Zod, Solid or
// anything else, that is the signal that the export it followed does not belong on this surface.
export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    minify: false,
    emptyOutDir: true,
    reportCompressedSize: false,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'sdk.js' },
  },
})
