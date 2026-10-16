import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

// A message's time reads the same on every machine, so the site's sidebar pictures don't depend on
// where they were made. Set here, in the main process, so every worker starts with them; a worker
// can't change its locale.
process.env.TZ = 'UTC'
process.env.LC_ALL = 'en_US.UTF-8'

// Two projects, as in client-core: `.test.ts` runs the background and contracts in bare Node, and
// `.test.tsx` renders the sidebar under jsdom. Both use the one browser fake in src/test/.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'logic', environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] } },
      {
        plugins: [solid()],
        // Without the browser condition vitest picks Solid's server build, which renders once and never updates.
        resolve: { conditions: ['browser', 'development'] },
        test: {
          name: 'sidebar',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/sidebarSetup.ts'],
        },
      },
    ],
  },
})
