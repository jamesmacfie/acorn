import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({ root, plugins: [solid()], resolve: { conditions: ['browser', 'development'], dedupe: ['solid-js'], alias: [
  { find: /^solid-js$/, replacement: root + 'packages/client-core/node_modules/solid-js/dist/dev.js' },
  { find: /^solid-js\/web$/, replacement: root + 'packages/client-core/node_modules/solid-js/web/dist/dev.js' },
  { find: /^solid-js\/store$/, replacement: root + 'packages/client-core/node_modules/solid-js/store/dist/dev.js' },
  { find: '@solidjs/router', replacement: root + 'packages/client-core/node_modules/@solidjs/router' },
  { find: '@tanstack/solid-query', replacement: root + 'packages/client-core/node_modules/@tanstack/solid-query' },
] }, test: { environment: 'jsdom', include: ['plans/performance/16-pool-probe.test.tsx'], setupFiles: [root + 'vitest.browser.setup.ts'], maxWorkers: 1, testTimeout: 10_000 } })
