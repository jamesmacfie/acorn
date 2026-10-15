import solid from 'vite-plugin-solid'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The specimen generator (scripts/specimens.test.ts). Specimens are plugin tree code, so they compile
// the way a plugin's tree bundle does, into the SDK's remote renderer. Everything else, which is
// client-core's TreeHost and the kit it mounts, compiles for the DOM.
const specimens = /\/apps\/site\/specimens\/.+\.tsx$/

// Set here, in the main process, so every worker starts with them. A worker can't change its locale.
process.env.TZ = 'UTC'
process.env.LC_ALL = 'en_US.UTF-8'

export default defineConfig({
  plugins: [
    solid({ include: specimens, hot: false, solid: { generate: 'universal', moduleName: 'acorn-plugin-sdk/remote' } }),
    solid({ exclude: specimens, hot: false }),
  ],
  resolve: {
    // vite-plugin-solid resolves solid-js to its browser build; without this vitest picks the server
    // build from the `node` condition and every reactive primitive renders once, dead.
    conditions: ['browser', 'development'],
    // The published SDK is a bundle with its own copy of the remote root. The source facade shares one
    // with client-core, which is how plugins/agent-cost tests its tree too.
    alias: {
      'acorn-plugin-sdk/remote': fileURLToPath(
        new URL('../../packages/plugin-sdk/src/remote/solid.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['scripts/**/*.test.ts'],
    setupFiles: [fileURLToPath(new URL('../../vitest.browser.setup.ts', import.meta.url))],
  },
})
