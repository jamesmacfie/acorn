import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

// JSX compiles to calls into the SDK's remote module, so components become acorn's tree, not DOM.
// The output is one file with Solid and the SDK inlined, because a client bundle can't import.
export default defineConfig({
  plugins: [solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })],
  build: {
    lib: { entry: 'src/client.tsx', formats: ['es'], fileName: () => 'client.js' },
    outDir: 'dist',
  },
})
