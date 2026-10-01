import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { experimental: { fsModuleCache: true }, environment: 'node', include: ['*.test.ts'] } })
