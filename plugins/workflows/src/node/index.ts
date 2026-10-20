import {
  describeError,
  registerDeletedTaskPurge,
  type InternalEnvFactory,
  type NodePlugin,
} from '@acorn/plugin-api/node'
import { activateWorkflowAgentTools } from '../server/agentTools/activation'
import { readWorkflowCheckoutActivity } from '../server/runs/checkoutActivity'
import { WORKFLOWS_NOTICES, type WorkflowNotices } from '../contract/notices'
import { WORKFLOWS_RUNNER } from '../contract/runner'
import { WORKFLOW_GATES } from '../contract/events'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND } from '../contract/extensions'
import { createWorkflowExecution } from '../server/runs/activation'
import { workflowStartService } from '../server/runs/startService'
import { workflowControl, workflowGates } from '../server/runs/control'
import { WorkflowRunner } from '../server/runs/runner'
import { workflowDefinitions } from '../server/definitions/activation'
import { WorkflowTriggerService, type WorkflowTriggerScheduler } from '../server/triggers/service'
import { workflowTriggerService, workflowTriggerTarget, workflowTriggerBridge } from '../server/triggers/activation'
import { WORKFLOW_ROUTE, workflow } from '../server/routes/workflow'
import { WORKFLOW_DEFS_ROUTE, workflowDefsRoutes } from '../server/routes/defs'
import { legacyWorkflowScheduleRoutes, WORKFLOW_TRIGGERS_ROUTE, workflowTriggerRoutes } from '../server/routes/triggers'
import { runSource } from '../shared/runSourceRegistration'

export type WorkflowsPluginDeps = {
  internalEnv: InternalEnvFactory
  // Resolves when the composition root's post-window reconcile pass finishes, even on failure.
  // workflow:start, gate, cancel, and kill all await it: reconcile() sweeps every 'running' step to
  // 'pending', so a run started before the sweep has its live step re-queued underneath it.
  reconciled: Promise<void>
  // Resolved when trigger commands need the core scheduler. The scheduler may not be registered
  // when this plugin is constructed.
  scheduler?: () => WorkflowTriggerScheduler
}

export const workflowsPlugin = (deps: WorkflowsPluginDeps): NodePlugin => {
  // Held so dispose can abort in-flight steps before the database closes (see dispose below).
  let live: WorkflowRunner | null = null
  let routeCapability: { dispose(): void } | null = null
  let defsCapability: { dispose(): void } | null = null
  let triggersCapability: { dispose(): void } | null = null
  let stopTriggerRecovery: (() => void) | null = null
  let stopCheckoutActivity: (() => void) | null = null
  let agentTools: { dispose(): void } | null = null
  // The step stream (`WORKFLOWS_NOTICES`). It goes out on core's `workflow:` channel as a frame written
  // here, because `ctx.events` is the seam and a plugin does not import core's notifier.
  const buildNotices = (ctx: Parameters<NonNullable<NodePlugin['init']>>[0]): WorkflowNotices => ({
    stepEvent: (runId, stepId, event) => ctx.events.send({ channel: 'workflow:step:event', runId, stepId, event }),
  })

  return {
    name: 'workflows',
    label: 'Workflows',
    emits: [
      { verb: 'run-changed', description: 'A workflow run changed durable status' },
      { verb: 'gate-changed', description: 'A workflow approval gate started or settled' },
      { verb: 'child-changed', description: 'A dispatched child workflow changed durable state' },
      { verb: 'completed', description: 'A workflow run reached a terminal status' },
    ],
    // This module's own URL: the chain sits at plugins/workflows/migrations, and the host's plugin
    // storage owns open, migrate, and close from there.
    migrationsModule: import.meta.url,
    init: async (ctx) => {
      let active = true
      stopTriggerRecovery = () => {
        active = false
      }
      // Opened and migrated by the host before init returns. The runner and the bridge below both
      // close over the handle, so no request can reach an unmigrated database.
      const store = ctx.storage.open()
      const core = ctx.core
      stopCheckoutActivity = core.checkoutAdmission.registerOwner('runs', (taskIds) =>
        readWorkflowCheckoutActivity(store, taskIds),
      )
      const notices = buildNotices(ctx)
      // The two seams another plugin adds work through (../contract/extensions.ts). Opened before the
      // runner is built so a contribution filed during someone else's init is visible on the first
      // run; `entries` is resolved per call, so init order still does not matter.
      ctx.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow step kinds')
      ctx.extensionPoints.declare(WORKFLOW_POLICY, 'Workflow gate policies')

      // The one decision this plugin opens to other plugins (docs/plugins/hooks.md § Hooks). A veto here is a
      // safety-rail, not a failure, which is why the point allows nothing else: a plugin that could
      // rewrite a step would be rewriting the workflow the owner read before running it.
      ctx.hooks.declare({
        id: 'before-step',
        label: 'run a workflow step',
        payload: { taskId: 'string', runId: 'string', stepId: 'string', step: 'string', kind: 'string' },
        allows: ['observe', 'veto'],
      })
      let triggers: WorkflowTriggerService | null = null
      const { runner, dispatcher } = createWorkflowExecution(store, ctx, deps.internalEnv, notices, async (runId) => {
        await triggers?.settleRun(runId)
      })
      live = runner

      const starts = workflowStartService(store, runner, ctx, deps.reconciled)
      triggers = workflowTriggerService(store, starts, ctx, deps.reconciled, deps.scheduler)
      ctx.schedules.registerTarget(workflowTriggerTarget(triggers))
      routeCapability = ctx.capabilities.provide(
        WORKFLOW_ROUTE,
        workflowControl(store, core, runner, dispatcher, starts, deps.reconciled),
      )
      const definitions = workflowDefinitions(store, ctx, runner, starts)
      defsCapability = ctx.capabilities.provide(WORKFLOW_DEFS_ROUTE, definitions.bridge)
      triggersCapability = ctx.capabilities.provide(WORKFLOW_TRIGGERS_ROUTE, workflowTriggerBridge(triggers))

      // Namespace-root router: it owns both task-scoped (/tasks/:id/workflows) and run-scoped
      // (/workflows/runs/:runId/...) paths. The internal paths are registered as declared, so the
      // client route builders and the server surface share one contract.
      ctx.routes.register(workflow, { prefix: '', note: 'workflow control' })
      ctx.routes.register(workflowDefsRoutes, { prefix: '', note: '/defs — definitions stored as rows, device only' })
      ctx.routes.register(workflowTriggerRoutes, { prefix: '/workflows/triggers', note: 'approved workflow triggers' })
      ctx.routes.register(legacyWorkflowScheduleRoutes, {
        prefix: '/workflows/schedules',
        note: 'alias of /workflows/triggers for clients built before triggers',
      })

      // This plugin's runs, for the merged list core assembles (@acorn/protocol/runs.ts). A pointer at
      // the route above, so nothing here knows what else is on that list.
      ctx.runs.register({ runs: '/v1/p/workflows/runs' })
      // The Workflow runs data source. Its handler loads on the first read, to stay inside the service
      // boot budget (apps/node/scripts/check-service-budget.mjs).
      ctx.routes.fetch(
        async (request, context) =>
          (await import('../server/data/runSourceHandler')).createRunSourceHandler(store, core)(request, context),
        { prefix: '/data/runs' },
      )
      ctx.dataSources.register(runSource)

      // reconcile() is not called here. It has to run after the listener binds and before the
      // composition root resolves `deps.reconciled`, so the root drives it through this capability
      // (`WorkflowsRunnerHandle` explains the ordering).
      ctx.capabilities.provide(WORKFLOWS_RUNNER, {
        reconcile: async () => {
          const recovered = await dispatcher.reconcile()
          for (const error of recovered.errors) ctx.log.warn(`workflow dispatch recovery failed: ${error}`)
          await runner.reconcile()
        },
        start: (request) => starts.startInternal(request),
      })
      ctx.capabilities.provide(WORKFLOW_GATES, workflowGates(store))
      registerDeletedTaskPurge(ctx, async (taskIds) =>
        (await import('../server/runs/deletedTaskPurge')).purgeDeletedTaskRuns(store, taskIds),
      )
      ctx.capabilities.provide(WORKFLOWS_NOTICES, notices)

      // The agent tools and the owner's approvals for them (docs/agent-tools/workflow-tools.md).
      agentTools = activateWorkflowAgentTools({
        store,
        ctx,
        runner,
        starts,
        drafts: definitions.drafts,
        reconciled: deps.reconciled,
      })

      await definitions
        .reconcileDraftQueries()
        .catch((error) => ctx.log.warn(`Draft query references need reconciliation: ${describeError(error).message}`))
      void deps.reconciled
        .then(() => (active ? triggers?.reconcile() : undefined))
        .catch((error) => ctx.log.warn(`workflow trigger recovery failed: ${describeError(error).message}`))
    },
    // The bridge slot is cleared explicitly rather than trusting teardown order: a second
    // startServiceRuntime in one process would otherwise serve workflow requests through the first
    // boot's closed database handle.
    //
    // In-flight steps are aborted here, before the handle closes, because a headless child that
    // outlives its database writes its outcome onto a closed connection. Run rows stay 'running' and
    // reconcile() sweeps them to 'pending' on the next boot.
    dispose: () => {
      stopCheckoutActivity?.()
      stopCheckoutActivity = null
      stopTriggerRecovery?.()
      stopTriggerRecovery = null
      agentTools?.dispose()
      agentTools = null
      live?.stop()
      live = null
      routeCapability?.dispose()
      defsCapability?.dispose()
      triggersCapability?.dispose()
    },
  }
}
