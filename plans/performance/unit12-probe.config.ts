import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: { environment: 'node', include: ['plans/performance/unit12-search-probe.test.ts'], maxWorkers: 1, testTimeout: 120_000 },
})
