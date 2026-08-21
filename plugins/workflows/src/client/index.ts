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
    // The three reads plugins/agents' task sidebar needs (docs/plugins.md § Collaboration rules:
    // this is the package-cycle example). Published under the id agents declares
    // (contract/workflowControl.ts); a node with workflows disabled just never provides it.
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
