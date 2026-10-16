import solid from 'vite-plugin-solid'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The same two projects a plugin package runs (plugins/vitest.shared.ts): `.test.ts` in bare Node for
// the model, `.test.tsx` under jsdom with the Solid transform for the views.
export default defineConfig({
  test: {
    experimental: { fsModuleCache: true },
    passWithNoTests: true,
    projects: [
      { test: { name: 'logic', environment: 'node', include: ['src/**/*.test.ts'] } },
      {
        plugins: [solid()],
        resolve: { conditions: ['browser', 'development'] },
        test: {
          name: 'hosts',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: [fileURLToPath(new URL('../../vitest.browser.setup.ts', import.meta.url))],
          server: { deps: { inline: [/@solidjs\/router/] } },
        },
      },
    ],
  },
})
