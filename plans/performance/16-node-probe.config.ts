import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({ root, test: { environment: 'node', include: ['plans/performance/16-*-probe.test.ts'], maxWorkers: 1, testTimeout: 10_000 } })
