import { createComponent, lazy } from 'solid-js'
import {
  AGENT_PROMPT_SCHEDULES,
  contextMenuRegistry,
  openPane,
  projectSurfaceRegistry,
  registerNoticeTargetHandler,
  type ClientPlugin,
} from '@acorn/plugin-api/client'
import { WORKFLOW_CONTROL } from '@acorn/plugin-agents/contract/workflowControl.ts'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'
import { WORKFLOW_GIT_LAUNCH, openWorkflowGitLaunch, workflowGitLaunchRequest } from '../contract/gitLaunch.ts'
import { workflowApi } from './workflowsClient'
import { workflowsCommands } from './commands'
import { workflowsSourceContribution, workflowsSurfaceContribution } from './sourceContribution'
import { workflowsAttentionSource } from './runs/attentionSource'
import { workflowsPaneContribution } from './runs/paneContribution'
import { WORKFLOWS_PANE_ID } from './runs/runPaneModel'
import { workflowRunCountsSchedule, workflowTaskGroups } from './runs/runStore'
import { openStartFromItem, startFromItemTarget } from './startFromItem'

const WorkflowsSettings = lazy(() => import('./WorkflowsSettings'))
const StartFromItemHost = lazy(() => import('./StartFromItemHost'))
const GitLaunchDialog = lazy(() => import('./GitLaunchDialog'))
const GitLaunchHost = lazy(() => import('./GitLaunchHost'))
const WorkflowToolCard = lazy(async () => ({ default: (await import('./WorkflowToolCard')).WorkflowToolCard }))

export const workflowsClientPlugin: ClientPlugin = {
  name: 'workflows',
  init: (ctx) => {
    ctx.capabilities.provide(WORKFLOW_GIT_LAUNCH, { open: openWorkflowGitLaunch, Dialog: GitLaunchDialog })
    ctx.slots.register({
      id: 'workflows.git-launch',
      slot: 'overlay',
      order: 51,
      when: () => !!workflowGitLaunchRequest(),
      component: () => createComponent(GitLaunchHost, {}),
    })
    ctx.contentLinks.register({
      id: 'workflows.run',
      providerId: 'workflows',
      parse: () => null,
      target: (item) => ({ kind: 'workflows.run', item, pane: 'workflows' }),
      presentations: ['pane'],
    })
    // The reads plugins/agents' pane needs (docs/plugins/collaboration.md § Collaboration rules), under
    // the id agents declares. A node with workflows disabled never provides it.
    // A kept dashboard panel's Refresh on a schedule, which core draws and can't reach this plugin for.
    // Loaded on first use, because it pulls in the editor's draft code, which startup leaves out.
    ctx.capabilities.provide(AGENT_PROMPT_SCHEDULES, {
      schedule: async (input) => (await import('./agentPromptSchedule')).scheduleAgentPrompt(input),
    })
    ctx.capabilities.provide(WORKFLOW_CONTROL, {
      runs: workflowApi.runs,
      steps: workflowApi.steps,
      gate: workflowApi.gate,
      retry: workflowApi.retry,
      runForSession: workflowApi.runForSession,
    })
    // What a workflow agent tool call looks like in the transcript, with a link to what it made or
    // started. The names are a literal, not an import, so the card stays out of boot.
    ctx.extensions.register({
      id: 'workflows.tool-card',
      point: AGENT_TOOL_CARD_POINT,
      label: 'Workflow drafts and runs',
      order: 10,
      matches: ['workflow_draft', 'workflow_run', 'workflow_read', 'workflow_wait', 'workflow_cancel'],
      component: WorkflowToolCard,
    })
    // A selected step's result body, keyed by its exact kind (../contract/stepBody.ts). No actions:
    // Retry, Stop, approvals and lineage stay outside the slot, and gates never open it.
    ctx.extensionPoints.register({
      id: 'step-body',
      label: 'Workflow step result',
      kind: 'remote',
      mode: 'replace',
      max: 1,
    })
    // "Run a workflow", "Find a run" and "New workflow".
    for (const contribution of workflowsCommands) ctx.commands.register(contribution)
    // The Workflows rail source and the editor behind it. A local source: no `providerId`, so nothing
    // has to be connected for the row to be in the rail.
    ctx.sources.register(workflowsSourceContribution)
    // The run surface, on the task the run belongs to.
    ctx.panes.register(workflowsPaneContribution)
    // Which tasks have a run at all, which is what the pane's `when` asks and cannot wait for.
    ctx.schedules.register(workflowRunCountsSchedule)
    ctx.railMarkers.register({
      id: 'workflows.task-groups',
      order: 30,
      markers: (target) => {
        if (target.kind !== 'task') return []
        const group = workflowTaskGroups()[target.id]
        if (!group) return []
        return [
          ...(group.running
            ? [
                {
                  id: 'running',
                  label: `${group.running} workflow ${group.running === 1 ? 'task' : 'tasks'} running`,
                  icon: 'loader-circle',
                  tone: 'accent' as const,
                  busy: true,
                  placements: ['bottom-end', 'top-end', 'bottom-start', 'top-start'] as const,
                  priority: 80,
                },
              ]
            : []),
          ...(group.attention
            ? [
                {
                  id: 'attention',
                  label: `${group.attention} workflow ${group.attention === 1 ? 'task needs' : 'tasks need'} attention`,
                  icon: 'circle-alert',
                  tone: 'warn' as const,
                  placements: ['top-end', 'bottom-end', 'top-start', 'bottom-start'] as const,
                  priority: 90,
                },
              ]
            : []),
        ]
      },
    })
    // A waiting gate, in the inbox, until somebody answers it.
    ctx.attentionSources.register(workflowsAttentionSource)
    // Where a bell row or an inbox row about a run goes. Both carry the same target shape, and the host
    // dispatches both through this table.
    registerNoticeTargetHandler('workflow-run', (taskId, target) => {
      openPane(taskId, WORKFLOWS_PANE_ID, {
        kind: 'workflows:show-run',
        runId: target.resourceId,
        stepId: target.subresourceId,
      })
    })
    // Through `ctx.contribute`, because the project-surface registry has no named member on the
    // context and this is the compiled way in (docs/contribution-kinds.md § Client contributions). The
    // host records the disposable, so a disable takes the surface with it.
    ctx.contribute(projectSurfaceRegistry, workflowsSurfaceContribution)
    // "Start workflow…" on a Rollbar, Linear or GitHub row. One registration serves all three, because
    // all three draw their row menu from the context-menu registry
    // (docs/plugins/menus-and-markers.md § Context menus). After Create task, which is the commoner verb.
    ctx.contribute(contextMenuRegistry, {
      id: 'workflows.start-from-item',
      location: 'item.row',
      label: 'Start workflow…',
      icon: 'workflow',
      order: 20,
      // Narrowed rather than cast: the registry holds every location's rows, and this one is only
      // ever handed the target it was filtered on.
      run: (target) => {
        if (target.location === 'item.row') openStartFromItem(target)
      },
    })
    // Where the box it opens is drawn. The shell's overlay slot, because the list the row sits on
    // belongs to somebody else. Gated on the ask rather than mounted empty, so the chunk stays off the
    // first paint: nobody has right-clicked a row yet.
    ctx.slots.register({
      id: 'workflows.start-from-item',
      slot: 'overlay',
      order: 50,
      when: () => !!startFromItemTarget(),
      component: () => createComponent(StartFromItemHost, {}),
    })
    ctx.settingsPages.register({
      id: 'workflows',
      label: 'Workflows',
      category: 'automation',
      scope: 'node',
      icon: 'workflow',
      order: 30,
      requires: { plugin: 'workflows' },
      // The page's one section, for search (`WorkflowsSettings` draws it). Its rows are the loaded
      // definitions, which are per task, so there are no row labels to declare.
      keywords: ['definitions', 'toml', 'parse errors', 'rescan'],
      sections: [{ id: 'loaded', label: 'Loaded workflows', keywords: ['.acorn/workflows'] }],
      component: WorkflowsSettings,
    })
  },
}
