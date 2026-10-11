import { defineConfig } from 'vitest/config'

// The service composition root's tests: the wiring units next to their subjects in src/, and the
// integration suites in test/ that boot the registries this package populates.
export default defineConfig({
  test: {
    experimental: { fsModuleCache: true },
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // No setupFiles. Global setup that imports a plugin's node entrypoint pre-loads core's whole server
    // surface through @acorn/plugin-api's barrel entrypoints before a suite's `vi.mock` calls can hoist,
    // so a suite that mocks server/db gets the real module. test/helpers/registerProviders.ts explains the
    // pattern; suites that need agent profiles register them in-graph (test/integration/profiles.test.ts).
    //
    // Temp-git-repo tests must not inherit the user's global git config, hooks, fsmonitor, templates:
    // it makes them slow and flaky under parallel workers.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
    // The integration suites build plugin bundles and spawn a node per plugin entrypoint. Under the
    // whole repo's suite that runs past the 5-second default while passing in isolation.
    testTimeout: 20_000,
    // Hooks get the same budget. hookTimeout defaults to 10s independently of testTimeout, and the
    // heavy setup (minting a certificate, building a bundle, seeding a git repo) lives in beforeAll.
    hookTimeout: 20_000,
  },
})
