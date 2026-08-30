import { isAbsolute, resolve } from 'node:path'
import { defineConfig } from 'vite'

// The desktop helper process, bundled because @acorn/* packages ship TypeScript source and Node
// cannot import them out of node_modules. Our own source goes into the bundle; every other bare specifier stays external and is
// required from node_modules at runtime, which keeps the native node-pty out of it.
const isWorkspacePackage = (id: string) => id.startsWith('@acorn/')
const external = (id: string) => !id.startsWith('.') && !isAbsolute(id) && !isWorkspacePackage(id)

export default defineConfig({
  build: {
    // Beside the staged service.js, so both resolve their externals from this package's node_modules
    // and the node finds its migrations chain by the walk-up in node-core's bindings.ts.
    outDir: 'dist/helper',
    emptyOutDir: false,
    target: 'node24',
    ssr: true,
    rollupOptions: {
      external,
      input: resolve(import.meta.dirname, 'src/helper/helperMain.ts'),
      output: { entryFileNames: 'helper.js', format: 'es' },
    },
  },
})
