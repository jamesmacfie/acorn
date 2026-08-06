// The workflows plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// One settings page, which is the whole client surface: a workflow's *runs* surface in the agents pane
// and its triggers are polled by agents' poller contribution, because the runner is the managed-agent
// runtime. The `@acorn/plugin-workflows -> @acorn/plugin-agents` edge on the boundary ledger is inside
// WorkflowsSettings.tsx and is Phase 3's ("workflows owns its UI and consumes agents.sessionExecute").
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'

const WorkflowsSettings = lazy(() => import('./WorkflowsSettings'))

export const workflowsClientPlugin: ClientPlugin = {
  name: 'workflows',
  init: (ctx) => {
    ctx.settingsPages.register({
      id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: 'desktop',
      component: WorkflowsSettings,
    })
  },
}
