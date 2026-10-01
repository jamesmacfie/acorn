import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root,
  resolve: { alias: { pg: realpathSync(root + 'packages/node-core/node_modules/pg/lib/index.js') } },
  test: {
    environment: 'node', include: ['plans/performance/13-*-probe.test.ts'],
    maxWorkers: 1, testTimeout: 30_000,
  },
})
