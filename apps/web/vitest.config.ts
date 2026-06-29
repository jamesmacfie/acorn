import { defineConfig } from 'vitest/config'

// Standalone config: the units under test are plain TS — pure logic + jose's WebCrypto — so they
// run in the default Node environment with no Vite plugins required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
