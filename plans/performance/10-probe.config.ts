import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'

const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root, plugins: [solid({ hot: false })],
  resolve: { conditions: ['browser', 'development'], dedupe: ['solid-js'], alias: [
    { find: /^solid-js$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/dist/dev.js') },
    { find: /^solid-js\/web$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/web/dist/dev.js') },
    { find: /^solid-js\/store$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/store/dist/dev.js') },
    { find: '@tanstack/solid-query', replacement: root + 'packages/client-core/node_modules/@tanstack/solid-query' },
    { find: '@solidjs/router', replacement: root + 'packages/client-core/node_modules/@solidjs/router' },
  ] },
  test: { environment: 'jsdom', include: ['plans/performance/10-*-probe.test.tsx'], setupFiles: [root + 'vitest.browser.setup.ts'],
    maxWorkers: 1, server: { deps: { inline: true } }, testTimeout: 60_000 },
})
