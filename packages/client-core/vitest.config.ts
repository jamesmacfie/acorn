import solid from 'vite-plugin-solid'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Two projects, because they need different environments and only one of them can compile JSX.
//
//   logic  the suite that was here before: `.test.ts` in bare Node, no DOM, no Solid transform. A
//          green run here still proves nothing about the UI, which is why the second project exists.
//   hosts  `.test.tsx` under jsdom with vite-plugin-solid, for the contribution hosts. It renders
//          host machinery — ordering, capability gating, arbitration, the error boundaries — not
//          pixels. What only a person looking at the running app can check is still on
//          docs/testing.md's smoke checklist.
//
// Split by extension rather than by folder so a host test sits beside the host it renders.
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'logic', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        plugins: [solid()],
        resolve: {
          // vite-plugin-solid resolves solid-js to its browser build; without this vitest picks the
          // server build from the `node` condition and every reactive primitive renders once, dead.
          conditions: ['browser', 'development'],
        },
        test: {
          name: 'hosts',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: [fileURLToPath(new URL('../../vitest.browser.setup.ts', import.meta.url))],
        },
      },
    ],
  },
})
