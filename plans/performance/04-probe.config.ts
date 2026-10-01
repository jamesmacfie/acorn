import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['plans/performance/04-engine-probe.test.ts'], fileParallelism: false } })
