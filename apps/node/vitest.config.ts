import { defineConfig } from 'vitest/config'

// The service composition root's tests: the wiring units next to their subjects in src/, and the
// integration suites in test/ that boot the registries this package populates.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // No setupFiles. Registering the built-in agent profiles globally used to import a plugin's node
    // entrypoint before any test module ran, and since plugins reach core through
    // @acorn/plugin-api's barrel entrypoints, that pre-loaded core's whole server surface before a
    // suite's `vi.mock` calls could hoist. Every provider suite that mocked server/db then got the
    // real module. test/registerProviders.ts explains the pattern; profiles now follow it too, and
    // the suites that need them register in-graph (test/integration/profiles.test.ts).
    //
    // Temp-git-repo tests must not inherit the user's global git config, hooks, fsmonitor, templates:
    // it makes them slow and flaky under parallel workers.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  },
})
