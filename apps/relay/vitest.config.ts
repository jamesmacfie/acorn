import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    experimental: { fsModuleCache: true },
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The end-to-end suite boots real Nodes and mints their certificates, which a loaded machine can
    // starve past the 5-second default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
