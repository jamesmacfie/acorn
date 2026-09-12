import { createComponent, lazy } from 'solid-js'
import {
  contextMenuRegistry, openPane, projectSurfaceRegistry, registerNoticeTargetHandler,
  type ClientPlugin,
} from '@acorn/plugin-api/client'
import { WORKFLOW_CONTROL } from '@acorn/plugin-agents/contract/workflowControl.ts'
import { workflowApi } from './workflowsClient'
import { workflowsCommands } from './commands'
import { workflowsSourceContribution, workflowsSurfaceContribution } from './sourceContribution'
import { workflowsAttentionSource } from './runs/attentionSource'
import { workflowsPaneContribution } from './runs/paneContribution'
import { WORKFLOWS_PANE_ID } from './runs/runPaneModel'
import { workflowRunCountsSchedule } from './runs/runStore'
import { openStartFromItem, startFromItemTarget } from './startFromItem'

const WorkflowsSettings = lazy(() => import('./WorkflowsSettings'))
const StartFromItemHost = lazy(() => import('./StartFromItemHost'))

export const workflowsClientPlugin: ClientPlugin = {
  name: 'workflows',
  init: (ctx) => {
    // The reads plugins/agents' pane needs (docs/plugins.md § Collaboration rules). Published under
    // the id agents declares (contract/workflowControl.ts). A node with workflows disabled never
    // provides it.
    ctx.capabilities.provide(WORKFLOW_CONTROL, {
      runs: workflowApi.runs,
      steps: workflowApi.steps,
      gate: workflowApi.gate,
      retry: workflowApi.retry,
      runForSession: workflowApi.runForSession,
    })
    // No trigger clock here. The sweep is a node schedule (../node/index.ts): a client one skipped
    // ticks while the window was hidden and did not run at all on a node with no client attached.
    //
    // "Run a workflow" and "Find a run" (./commands.ts). A `paletteRows` source until 2026-09-03.
    for (const contribution of workflowsCommands) ctx.commands.register(contribution)
    // The Workflows rail source and the editor behind it (./sourceContribution.tsx). A local source:
    // no `providerId`, so nothing has to be connected for the row to be in the rail.
    ctx.sources.register(workflowsSourceContribution)
    // The run surface, on the task the run belongs to (./runs/paneContribution.ts).
    ctx.panes.register(workflowsPaneContribution)
    // Which tasks have a run at all, which is what the pane's `when` asks and cannot wait for.
    ctx.schedules.register(workflowRunCountsSchedule)
    // A waiting gate, in the inbox, until somebody answers it (./runs/attentionSource.ts).
    ctx.attentionSources.register(workflowsAttentionSource)
    // Where a bell row or an inbox row about a run goes. Both carry the same target shape, and the
    // host dispatches both through this table (client-core notifications/notifications.ts).
    registerNoticeTargetHandler('workflow-run', (taskId, target) => {
      openPane(taskId, WORKFLOWS_PANE_ID, { kind: 'workflows:show-run', runId: target.resourceId, stepId: target.subresourceId })
    })
    // Through `ctx.contribute`, because the project-surface registry has no named member on the
    // context and this is the compiled way in (docs/contribution-kinds.md § Project surfaces). The
    // host records the disposable, so a disable takes the surface with it.
    ctx.contribute(projectSurfaceRegistry, workflowsSurfaceContribution)
    // "Start workflow…" on a Rollbar, Linear or GitHub row (./startFromItem.ts). One registration
    // serves all three, because all three draw their row menu from the context-menu registry
    // (docs/plugins.md § Context menus). After Create task, which is the commoner verb.
    ctx.contribute(contextMenuRegistry, {
      id: 'workflows.start-from-item',
      location: 'item.row',
      label: 'Start workflow…',
      icon: 'workflow',
      order: 20,
      // Narrowed rather than cast: the registry holds every location's rows, and this one is only
      // ever handed the target it was filtered on.
      run: (target) => { if (target.location === 'item.row') openStartFromItem(target) },
    })
    // Where the box it opens is drawn. The shell's overlay slot, because the list the row sits on
    // belongs to somebody else (./StartFromItemHost.tsx). Gated on the ask rather than mounted
    // empty, so the chunk stays off the first paint: nobody has right-clicked a row yet.
    ctx.slots.register({
      id: 'workflows.start-from-item',
      slot: 'overlay',
      order: 50,
      when: () => !!startFromItemTarget(),
      component: () => createComponent(StartFromItemHost, {}),
    })
    ctx.settingsPages.register({
      id: 'workflows', label: 'Workflows', group: 'general', order: 50, requires: { plugin: 'workflows' },
      component: WorkflowsSettings,
    })
  },
}
