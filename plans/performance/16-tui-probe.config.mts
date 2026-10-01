import { defineConfig, mergeConfig } from 'vitest/config'
import base from './15-probe.config.mts'
const merged = mergeConfig(base, defineConfig({ test: { maxWorkers: 1, testTimeout: 10_000 } }))
// mergeConfig concatenates include arrays; keep this area independent of area15's measurements.
export default { ...merged, test: { ...merged.test, include: ['plans/performance/16-tui-*-probe.test.tsx'] } }
