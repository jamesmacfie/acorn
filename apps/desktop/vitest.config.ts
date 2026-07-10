import { defineConfig } from 'vitest/config'

// Standalone config: the units under test are plain TS — pure logic + jose's WebCrypto — so they
// run in the default Node environment with no Vite plugins required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Register built-in providers/profiles into the core registries before each test file, mirroring
    // what the app composition roots do at boot (docs/plugins.md foldering).
    setupFiles: ['./test/registerContributions.ts'],
    // Temp-git-repo tests must not inherit the user's global git config (hooks, fsmonitor,
    // templates) — it makes them slow and flaky under parallel workers.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  },
})
