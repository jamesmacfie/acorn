import { defineConfig, mergeConfig } from 'vitest/config'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import base from '../../apps/tui/vitest.config'
const root = fileURLToPath(new URL('../../', import.meta.url))
export default mergeConfig(base, defineConfig({ root,
  resolve: { alias: [
    { find: /^solid-js$/, replacement: realpathSync(root+'apps/tui/node_modules/solid-js/dist/solid.js') },
    { find: /^solid-js\/store$/, replacement: realpathSync(root+'apps/tui/node_modules/solid-js/store/dist/store.js') },
    { find: /^@tanstack\/solid-query$/, replacement: realpathSync(root+'apps/tui/node_modules/@tanstack/solid-query/build/index.js') },
    { find: 'unit06-worker-host', replacement: root+'packages/client-core/src/host/tree/workerHost.ts' },
    { find: 'unit06-distribution', replacement: root+'packages/client-core/src/host/plugins/distribution.ts' },
    { find: 'unit06-active-node', replacement: root+'packages/client-core/src/infra/node/activeNode.ts' },
    { find: 'unit06-worker-factory', replacement: root+'apps/tui/src/plugins/workerFactory.ts' },
  ] }, test: { include: ['plans/performance/unit06-tui-owner-probe.test.tsx'], maxWorkers: 1, testTimeout: 20_000 },
}))
