import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['plans/performance/unit28-helper-probe.test.ts'], maxWorkers: 1 } })
