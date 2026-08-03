import { defineConfig } from 'vitest/config'

// The service composition root's tests: the wiring units next to their subjects in src/, and the
// integration suites in test/ that boot the registries this package populates.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Register the built-in agent profiles into the core registry before each test file, mirroring
    // what this composition root does at boot (docs/plugins.md foldering).
    setupFiles: ['./test/registerContributions.ts'],
    // Temp-git-repo tests must not inherit the user's global git config (hooks, fsmonitor,
    // templates) — it makes them slow and flaky under parallel workers.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  },
})
