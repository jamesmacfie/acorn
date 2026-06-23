import { defineConfig } from 'vitest/config'

// Standalone config so Vitest does NOT inherit vite.config.ts (the @cloudflare/vite-plugin
// sets resolve.external for the Worker env, which Vitest rejects). The units under test are
// plain TS — pure logic + jose's WebCrypto — so they run in the default Node environment with
// no Vite plugins required.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
