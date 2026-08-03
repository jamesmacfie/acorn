import { defineConfig } from 'vitest/config'

// Standalone config: the units under test are plain TS — pure logic + jose's WebCrypto — so they
// run in the default Node environment with no Vite plugins required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // No setupFiles: registering the built-in agent profiles belongs to the service composition
    // root, which is @acorn/node — its vitest config owns that setup now. Nothing left here
    // (Electron main adapters + the client conformance suites) touches the profile registry.
    // Temp-git-repo tests must not inherit the user's global git config (hooks, fsmonitor,
    // templates) — it makes them slow and flaky under parallel workers.
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
  },
})
