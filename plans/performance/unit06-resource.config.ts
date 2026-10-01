import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { realpathSync } from 'node:fs'
const root = fileURLToPath(new URL('../../', import.meta.url))
const before = process.env.ACORN_PERF_OWNER === 'before'
const ownerRoot = before ? realpathSync('/tmp/acorn-perf-unit06-before') + '/' : root
export default defineConfig({ root, plugins: [solid()], resolve: {
  conditions: ['browser', 'development'], dedupe: ['solid-js'], alias: [
    { find: /^solid-js$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/dist/dev.js') },
    { find: /^solid-js\/web$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/web/dist/dev.js') },
    { find: /^solid-js\/store$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/store/dist/dev.js') },
    { find: /^solid-js\/universal$/, replacement: realpathSync(root + 'packages/client-core/node_modules/solid-js/universal/dist/universal.js') },
    { find: '@tanstack/solid-query', replacement: realpathSync(root + 'packages/client-core/node_modules/@tanstack/solid-query/build/dev.js') },
    { find: '@solidjs/router', replacement: root + 'packages/client-core/node_modules/@solidjs/router' },
    { find: /^unit06-core\//, replacement: ownerRoot + 'packages/client-core/src/' },
  ],
}, test: { environment: 'jsdom', include: ['plans/performance/unit06-resource-probe.test.tsx'], setupFiles: [root+'vitest.browser.setup.ts'], maxWorkers: 1, testTimeout: 20_000 } })
