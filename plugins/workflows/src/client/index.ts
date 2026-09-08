import { lazy } from 'solid-js'
import { projectSurfaceRegistry, type ClientPlugin } from '@acorn/plugin-api/client'
import { WORKFLOW_CONTROL } from '@acorn/plugin-agents/contract/workflowControl.ts'
import { workflowApi } from './workflowsClient'
import { workflowsCommands } from './commands'
import { workflowsSourceContribution, workflowsSurfaceContribution } from './sourceContribution'

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
    // No trigger clock here. The sweep is a node schedule (../node/index.ts): a client one skipped
    // ticks while the window was hidden and did not run at all on a node with no client attached.
    //
    // "Run a workflow", as one search over this task's committed definitions (./commands.ts). A
    // `paletteRows` source until 2026-09-03.
    for (const contribution of workflowsCommands) ctx.commands.register(contribution)
    // The Workflows rail source and the editor behind it (./sourceContribution.tsx). A local source:
    // no `providerId`, so nothing has to be connected for the row to be in the rail.
    ctx.sources.register(workflowsSourceContribution)
    // Through `ctx.contribute`, because the project-surface registry has no named member on the
    // context and this is the compiled way in (docs/contribution-kinds.md § Project surfaces). The
    // host records the disposable, so a disable takes the surface with it.
    ctx.contribute(projectSurfaceRegistry, workflowsSurfaceContribution)
    ctx.settingsPages.register({
      id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: { plugin: 'workflows' },
      component: WorkflowsSettings,
    })
  },
}
