import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { buildVersion } from '../../scripts/buildVersion.mts'

// The phone's web app, from `index.html` and `src/client`. The gateway serves `dist` as it stands
// (docs/security/mobile-gateway.md). `pnpm dev:mobile` runs this config with a proxy to the gateway in
// front of it (scripts/dev.mjs), so nothing here knows a port.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid()],
  // The DOM host, as on the desktop (client-core kit/tokens/support.ts).
  define: { __ACORN_HOST__: '"dom"', __ACORN_BUILD__: JSON.stringify(buildVersion()) },
  // The syntax highlighter's worker splits into chunks, which only an ES module worker can load.
  worker: { format: 'es' },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    // `main.tsx` awaits the seam before it loads the app.
    target: 'es2022',
    // The chunk graph scripts/check-startup-budget.mjs reads.
    manifest: true,
    rollupOptions: {
      // Lets an unused kit component drop out of the startup graph, as the desktop's config explains
      // (docs/frontend/startup-budget.md § Unused kit components drop out).
      treeshake: {
        moduleSideEffects: [{ test: /\/packages\/client-core\/src\/kit\/components\/.*\.tsx$/, sideEffects: false }],
      },
    },
  },
})
