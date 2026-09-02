// The vitest config every plugin package runs, in one file. It was seventeen byte-identical copies,
// comment included.
//
// Each plugin's own vitest.config.ts is now `export { default } from '../vitest.shared'`. Vitest
// still loads the per-package file, which is what fixes the project root, so `src/**` and the temp
// dirs the suites write resolve inside the package. Vite inlines this relative import when it
// bundles it.
//
// Two projects, the same split `packages/client-core/vitest.config.ts` makes and for the same reason:
//
//   logic  `.test.ts` in bare Node, no DOM, no Solid transform. Everything a plugin's node half does,
//          and everything on its client half that is a pure function.
//   hosts  `.test.tsx` under jsdom with vite-plugin-solid. Every region a plugin ships is a Solid
//          component, and without this tier none of them was tested where it lives — phases 7 and 8
//          both deferred it and phase 9 did not answer, so a pane's regions could only be checked
//          from client-core, which does not have them.
//
// Split by extension rather than by folder so a region's test sits beside the region.
//
// `vite-plugin-solid` and `jsdom` are root devDependencies rather than each plugin's, because this
// file belongs to no package: resolution walks up from `plugins/` and finds one copy for all of them.
import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'

// Plugin suites spawn real agent processes, PTYs, git and HTTP listeners, and `turbo run test` starts
// every package at once. The 5-second default was tight enough that these timed out under that load
// while passing in isolation, which is red that teaches people to re-run rather than read. A genuine
// hang still fails, 15 seconds later. hookTimeout defaults to 10s independently of testTimeout, and
// the heavy setup (minting a certificate, building a bundle, seeding a git repo) lives in beforeAll.
const timeouts = { testTimeout: 20_000, hookTimeout: 20_000 }

// Some plugins (the profile shims) are a single declaration with nothing to test; an empty suite is
// not a build failure. True on both projects, because most plugins have no `.test.tsx` at all.
const common = { passWithNoTests: true, env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, ...timeouts }

export default defineConfig({
  test: {
    // Once on the root and once per project: with projects, the root flag is what stops "no test files
    // found" from being an exit code when a plugin has neither kind, and the per-project flag is what
    // stops it when a plugin has one kind and not the other.
    passWithNoTests: true,
    projects: [
      {
        test: { ...common, name: 'logic', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      {
        plugins: [solid()],
        resolve: {
          // vite-plugin-solid resolves solid-js to its browser build; without this vitest picks the
          // server build from the `node` condition and every reactive primitive renders once, dead.
          conditions: ['browser', 'development'],
        },
        test: {
          ...common,
          name: 'hosts',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          // `@solidjs/router` ships `.jsx` source and no build. Externalized, Node is handed a file
          // extension it has no loader for; inlined, vite-plugin-solid compiles it like any other
          // source in the graph. A plugin panel reaches it through the host chrome it draws inside, so
          // this is the difference between a panel being testable here and not.
          server: { deps: { inline: [/@solidjs\/router/] } },
        },
      },
    ],
  },
})
