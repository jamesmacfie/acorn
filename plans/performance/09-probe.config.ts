import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    environment: 'node',
    include: ['plans/performance/09-*-probe.test.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
})
