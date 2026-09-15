import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [solid({ solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } })],
  // The published SDK is a self-contained bundle and therefore owns its own remote-root module.
  // Tests drive the tree with Acorn's in-process host testkit, so point both halves at the SDK source
  // facade where they share one root implementation. The production build still consumes the
  // published entry and verifies that path separately.
  resolve: {
    alias: {
      'acorn-plugin-sdk/remote': new URL('../../packages/plugin-sdk/src/remote/solid.ts', import.meta.url).pathname,
    },
  },
  test: { environment: 'node' },
})
