import { defineConfig } from 'vitest/config'

export default defineConfig({
  // No jsdom and no vite-plugin-solid: these are logic tests (*.test.ts only). Component .tsx files
  // are not rendered here; a green suite here proves nothing about the UI.
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
