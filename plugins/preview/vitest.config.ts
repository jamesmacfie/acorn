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
