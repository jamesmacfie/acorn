import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['plans/performance/unit22-*-probe.test.ts'], maxWorkers: 1, testTimeout: 20_000 } })
