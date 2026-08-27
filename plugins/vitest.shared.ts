// The vitest config every plugin package runs, in one file. It was seventeen byte-identical copies,
// comment included.
//
// Each plugin's own vitest.config.ts is now `export { default } from '../vitest.shared'`. Vitest
// still loads the per-package file, which is what fixes the project root, so `src/**` and the temp
// dirs the suites write resolve inside the package. Vite inlines this relative import when it
// bundles it.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Some plugins (the profile shims) are a single declaration with nothing to test;
    // an empty suite is not a build failure.
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    // Plugin suites spawn real agent processes, PTYs, git and HTTP listeners, and `turbo run test`
    // starts every package at once. The 5-second default was tight enough that these timed out under
    // that load while passing in isolation, which is red that teaches people to re-run rather than
    // read. A genuine hang still fails, 15 seconds later.
    testTimeout: 20_000,
    // Hooks get the same budget. hookTimeout defaults to 10s independently of testTimeout, and the
    // heavy setup (minting a certificate, building a bundle, seeding a git repo) lives in beforeAll.
    hookTimeout: 20_000,
  },
})
