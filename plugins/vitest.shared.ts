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
  },
})
