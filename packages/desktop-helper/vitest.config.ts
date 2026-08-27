import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The broker tests open real HTTP and HTTPS listeners and shell out to openssl. Under the whole
    // repo's suite these were starved past the 5-second default while passing in isolation, so the
    // red said "load", not "broken".
    testTimeout: 20_000,
    // Hooks get the same budget. hookTimeout defaults to 10s independently of testTimeout, and the
    // heavy setup (minting a certificate, building a bundle, seeding a git repo) lives in beforeAll.
    hookTimeout: 20_000,
  },
})
