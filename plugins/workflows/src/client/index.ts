// The workflows plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// A settings page and the trigger poller. The poller was registered by plugins/agents until Phase 3,
// because the runner is the managed-agent runtime — but its id was already `workflows.triggers`, it drives
// this plugin's own `/v2/p/workflows/triggers/poll` route, and agents held it only as an accident of where
// the runner lives. Moving it is what let the `@acorn/plugin-workflows -> @acorn/plugin-agents` client edge
// come off the boundary ledger.
//
// What is still NOT here: a workflow's *runs* surface. plugins/agents' task sidebar merges workflow steps
// into its own roster, which plugins.md puts in a task-activity slot both plugins contribute to. That is
// the remaining half of "workflows owns its UI", and it is slot work rather than a move — see
// packages/client-core/src/tasks/workflowClient.ts for why the fetcher sits where it does meanwhile.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { workflowsPaletteRowSource } from './paletteRowSource'
import { workflowTriggerPollerContribution } from './triggerPoller'

const WorkflowsSettings = lazy(() => import('./WorkflowsSettings'))

export const workflowsClientPlugin: ClientPlugin = {
  name: 'workflows',
  init: (ctx) => {
    ctx.pollers.register(workflowTriggerPollerContribution)
    ctx.paletteRows.register(workflowsPaletteRowSource)
    ctx.settingsPages.register({
      id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: 'desktop',
      component: WorkflowsSettings,
    })
  },
}
