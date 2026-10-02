import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['plans/performance/unit17-transport-probe.test.ts'], maxWorkers: 1 } })
