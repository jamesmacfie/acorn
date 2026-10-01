import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    experimental: { fsModuleCache: true },
    include: ['index.test.ts', 'scaffoldClient.test.ts'],
  },
})
