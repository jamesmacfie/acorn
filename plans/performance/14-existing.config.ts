import solid from 'vite-plugin-solid'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({ root, test: { maxWorkers: 1, projects: [
  { test: { name: 'logic', environment: 'node', testTimeout: 20_000, include: [
    'plugins/memory/src/server/memory.test.ts',
    'plugins/workflows/src/server/workflowRunProjection.test.ts',
    'plugins/workflows/src/server/workflowProcessingReadModel.test.ts',
    'plugins/workflows/src/client/editor/recoveryStore.test.ts',
    'packages/node-core/src/server/schedules/scheduler.test.ts',
    'packages/node-core/src/server/integrations/budgetRuntime.test.ts',
    'packages/node-core/src/server/dataSources/selection.test.ts',
  ] } },
  { plugins: [solid({ hot: false })], resolve: { conditions: ['browser', 'development'] },
    test: { name: 'hosts', environment: 'jsdom', testTimeout: 20_000,
      include: ['plugins/workflows/src/client/runs/runPaneModel.test.tsx'], setupFiles: [root + 'vitest.browser.setup.ts'], server: { deps: { inline: [/@solidjs\/router/] } } } },
] } })
