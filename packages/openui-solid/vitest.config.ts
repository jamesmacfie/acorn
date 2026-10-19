import solid from 'vite-plugin-solid'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The program cases need only lang-core, so they run in bare Node. The interaction cases mount programs
// under jsdom, with the Solid transform for the test renderers.
export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      { test: { name: 'programs', environment: 'node', include: ['src/**/*.test.ts'] } },
      {
        plugins: [solid()],
        resolve: { conditions: ['browser', 'development'] },
        test: {
          name: 'interactions',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: [fileURLToPath(new URL('../../vitest.browser.setup.ts', import.meta.url))],
        },
      },
    ],
  },
})
