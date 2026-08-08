import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { WORKFLOW_CONTROL } from '@acorn/plugin-agents/contract/workflowControl.ts'
import { workflowApi } from '../contract/workflowClient'
import { workflowsPaletteRowSource } from './paletteRowSource'
import { workflowTriggerPollerContribution } from './triggerPoller'

const WorkflowsSettings = lazy(() => import('./WorkflowsSettings'))

export const workflowsClientPlugin: ClientPlugin = {
  name: 'workflows',
  init: (ctx) => {
    // The three reads plugins/agents' task sidebar needs, published under the id that plugin declares
    // (contract/workflowControl.ts). Consumer-declared because workflows already depends on agents on
    // the node side, and importing back would close a package cycle. A node with workflows disabled
    // simply never provides it, and the sidebar renders agent sessions alone.
    ctx.capability(WORKFLOW_CONTROL, {
      runs: workflowApi.runs,
      steps: workflowApi.steps,
      gate: workflowApi.gate,
    })
    ctx.pollers.register(workflowTriggerPollerContribution)
    ctx.paletteRows.register(workflowsPaletteRowSource)
    ctx.settingsPages.register({
      id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: 'desktop',
      component: WorkflowsSettings,
    })
  },
}
