import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { WORKFLOW_CONTROL } from '@acorn/plugin-agents/contract/workflowControl.ts'
import { workflowApi } from '../contract/workflowClient'
import { workflowsPaletteRowSource } from './paletteRowSource'
import { workflowTriggerScheduleContribution } from './triggerSchedule'

const WorkflowsSettings = lazy(() => import('./WorkflowsSettings'))

export const workflowsClientPlugin: ClientPlugin = {
  name: 'workflows',
  init: (ctx) => {
    // The three reads plugins/agents' task sidebar needs (docs/plugins.md § Collaboration rules).
    // Published under the id agents declares (contract/workflowControl.ts). A node with workflows
    // disabled never provides it.
    ctx.capabilities.provide(WORKFLOW_CONTROL, {
      runs: workflowApi.runs,
      steps: workflowApi.steps,
      gate: workflowApi.gate,
    })
    ctx.schedules.register(workflowTriggerScheduleContribution)
    ctx.paletteRows.register(workflowsPaletteRowSource)
    ctx.settingsPages.register({
      id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: 'desktop',
      component: WorkflowsSettings,
    })
  },
}
