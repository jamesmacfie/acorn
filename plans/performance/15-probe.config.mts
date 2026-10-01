import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
import { defineConfig, mergeConfig } from 'vitest/config'
import base from '../../apps/tui/vitest.config'

export default mergeConfig(base, defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: { alias: [
    { find: /^solid-js$/, replacement: realpathSync(fileURLToPath(new URL('../../apps/tui/node_modules/solid-js/dist/solid.js', import.meta.url))) },
    { find: /^solid-js\/store$/, replacement: realpathSync(fileURLToPath(new URL('../../apps/tui/node_modules/solid-js/store/dist/store.js', import.meta.url))) },
    { find: /^@tanstack\/solid-query$/, replacement: fileURLToPath(new URL('../../apps/tui/node_modules/@tanstack/solid-query/build/index.js', import.meta.url)) },
  ] },
  test: {
    include: ['plans/performance/15-*-probe.test.{ts,tsx}'],
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
  },
}))
