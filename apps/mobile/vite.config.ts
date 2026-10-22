import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { buildVersion } from '../../scripts/buildVersion.mts'

// The domain plugin code runs under, one origin per bundle (docs/mobile/phone-setup.md § Serve the sandbox
// domain). A name and an optional port, with no scheme. Unset, the phone draws no plugin trees.
const sandboxDomain = process.env.ACORN_SANDBOX_DOMAIN?.trim().toLowerCase() || null
if (sandboxDomain && !/^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/.test(sandboxDomain))
  throw new Error(`ACORN_SANDBOX_DOMAIN ${sandboxDomain} isn't a host name. Give a name and an optional port.`)

// The first-party bundles this release carries (scripts/build-first-party.mjs). Without the file the phone
// carries none, so every bundle asks, which is the safe direction.
const firstPartyFile = resolve(import.meta.dirname, 'first-party-bundles.json')
const firstPartyBundles = existsSync(firstPartyFile) ? JSON.parse(readFileSync(firstPartyFile, 'utf8')) : []

// The phone's web app, from `index.html` and `src/client`. The account website serves `dist` as it stands
// (docs/mobile/phone-setup.md § Serve it yourself). `pnpm dev:mobile` runs this config with a proxy to the
// account service in front of it (scripts/dev.mjs), so nothing here knows a port.
export default defineConfig({
  root: import.meta.dirname,
  // The website keeps its own pages at its root, so the app lives under `/app/`: every file the build
  // writes and every route is under it, and `Shell.tsx` gives the router the same prefix.
  base: '/app/',
  plugins: [solid()],
  // The DOM host, as on the desktop (client-core kit/tokens/support.ts).
  define: {
    __ACORN_HOST__: '"dom"',
    __ACORN_BUILD__: JSON.stringify(buildVersion()),
    __ACORN_SANDBOX_DOMAIN__: JSON.stringify(sandboxDomain),
    __ACORN_FIRST_PARTY_BUNDLES__: JSON.stringify(firstPartyBundles),
  },
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
