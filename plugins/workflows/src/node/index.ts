import { describeError, type InternalEnvFactory, type NodePlugin } from '@acorn/plugin-api/node'
import { WORKFLOWS_NOTICES, type WorkflowNotices } from '../contract/notices'
import { WORKFLOWS_RUNNER } from '../contract/runner'
import { WORKFLOW_GATES } from '../contract/events'
import { WORKFLOW_POLICY, WORKFLOW_STEP_KIND, WORKFLOW_TRIGGER } from '../contract/extensions'
import { createWorkflowExecution } from '../server/runs/activation'
import { workflowStartService } from '../server/runs/startService'
import { workflowControl, workflowGates } from '../server/runs/control'
import { WorkflowRunner } from '../server/runs/runner'
import { workflowDefinitions } from '../server/definitions/activation'
import { WorkflowScheduleService, type WorkflowScheduleScheduler } from '../server/schedules/service'
import { workflowScheduleService, workflowScheduleTarget, workflowScheduleBridge, registerWorkflowTriggers } from '../server/schedules/activation'
import { WORKFLOW_ROUTE, workflow } from '../server/routes/workflow'
import { WORKFLOW_DEFS_ROUTE, workflowDefsRoutes } from '../server/routes/defs'
import { WORKFLOW_SCHEDULES_ROUTE, workflowScheduleRoutes } from '../server/routes/schedules'

export type WorkflowsPluginDeps = {
  internalEnv: InternalEnvFactory
  // Resolves when the composition root's post-window reconcile pass finishes, even on failure.
  // workflow:start, gate, cancel, and kill all await it: reconcile() sweeps every 'running' step to
  // 'pending', so a run started before the sweep has its live step re-queued underneath it.
  reconciled: Promise<void>
  // Resolved when schedule commands need the core scheduler. The scheduler may not be registered
  // when this plugin is constructed.
  scheduler?: () => WorkflowScheduleScheduler
}

export const workflowsPlugin = (deps: WorkflowsPluginDeps): NodePlugin => {
  // Held so dispose can abort in-flight steps before the database closes (see dispose below).
  let live: WorkflowRunner | null = null
  let routeCapability: { dispose(): void } | null = null
  let defsCapability: { dispose(): void } | null = null
  let schedulesCapability: { dispose(): void } | null = null
  let stopScheduleRecovery: (() => void) | null = null
  // The step stream, this plugin's own vocabulary rather than a member of the broadcast surface every
  // plugin receives (../contract/notices.ts). It goes out on core's `workflow:` channel, which is why
  // it is written as a frame here rather than reaching for a core helper: `ctx.events` is the seam, and
  // a plugin does not deep-import server/notify.ts.
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
    // This module's own URL: the chain sits at plugins/workflows/migrations beside it, and the host
    // owns open, migrate, and close from there (@acorn/node-core/server/plugins/storage.ts).
    migrationsModule: import.meta.url,
    init: async (ctx) => {
      let active = true
      stopScheduleRecovery = () => { active = false }
      // Opened and migrated by the host before init returns. The runner and the bridge below both
      // close over the handle, so no request can reach an unmigrated database.
      const store = ctx.storage.open()
      const core = ctx.core
      const notices = buildNotices(ctx)
      // The three seams another plugin adds work through (../contract/extensions.ts). Opened before the
      // runner is built so a contribution filed during someone else's init is visible on the first
      // sweep; `entries` is resolved per call, so init order still does not matter.
      ctx.extensionPoints.declare(WORKFLOW_STEP_KIND, 'Workflow step kinds')
      ctx.extensionPoints.declare(WORKFLOW_POLICY, 'Workflow gate policies')
      ctx.extensionPoints.declare(WORKFLOW_TRIGGER, 'Workflow triggers')

      // The one decision this plugin opens to other plugins (docs/plugins/hooks.md § Hooks). A veto here is a
      // safety-rail, not a failure, which is why the point allows nothing else: a plugin that could
      // rewrite a step would be rewriting the workflow the owner read before running it.
      ctx.hooks.declare({
        id: 'before-step',
        label: 'run a workflow step',
        payload: { taskId: 'string', runId: 'string', stepId: 'string', step: 'string', kind: 'string' },
        allows: ['observe', 'veto'],
      })
      let scheduleService: WorkflowScheduleService | null = null
      const { runner, dispatcher } = createWorkflowExecution(store, ctx, deps.internalEnv, notices, async runId => {
        await scheduleService?.settleRun(runId)
      })
      live = runner

      const starts = workflowStartService(store, runner, ctx, deps.reconciled)
      scheduleService = workflowScheduleService(store, starts, ctx, deps.reconciled, deps.scheduler)
      ctx.schedules.registerTarget(workflowScheduleTarget(scheduleService))
      routeCapability = ctx.capabilities.provide(WORKFLOW_ROUTE, workflowControl(store, core, runner, dispatcher, starts, deps.reconciled))
      const definitions = workflowDefinitions(store, ctx, runner, starts)
      defsCapability = ctx.capabilities.provide(WORKFLOW_DEFS_ROUTE, definitions.bridge)
      schedulesCapability = ctx.capabilities.provide(WORKFLOW_SCHEDULES_ROUTE, workflowScheduleBridge(scheduleService))

      // Namespace-root router: it owns both task-scoped (/tasks/:id/workflows) and run-scoped
      // (/workflows/runs/:runId/...) paths. The internal paths are registered as declared, so the
      // client route builders and the server surface share one contract.
      ctx.routes.register(workflow, { prefix: '', note: 'workflow control' })
      ctx.routes.register(workflowDefsRoutes, { prefix: '', note: '/defs — definitions stored as rows, device only' })
      ctx.routes.register(workflowScheduleRoutes, { prefix: '/workflows/schedules', note: 'approved workflow schedules' })

      // This plugin's runs, for the merged list core assembles (@acorn/protocol/runs.ts). A pointer at
      // the route above, so nothing here knows what else is on that list.
      ctx.runs.register({ runs: '/v1/p/workflows/runs' })

      // reconcile() is not called here. It has to run after the listener binds and before the
      // composition root resolves `deps.reconciled`, so the root drives it through this capability
      // (server/runs/runner.ts explains the ordering).
      ctx.capabilities.provide(WORKFLOWS_RUNNER, {
        reconcile: async () => {
          const recovered = await dispatcher.reconcile()
          for (const error of recovered.errors) ctx.log.warn(`workflow dispatch recovery failed: ${error}`)
          await runner.reconcile()
        },
        start: (request) => starts.startInternal(request),
      })
      ctx.capabilities.provide(WORKFLOW_GATES, workflowGates(store))
      ctx.capabilities.provide(WORKFLOWS_NOTICES, notices)

      registerWorkflowTriggers(ctx, runner)
      await definitions.reconcileDraftQueries().catch(error => ctx.log.warn(`Draft query references need reconciliation: ${describeError(error).message}`))
      void deps.reconciled.then(() => active ? scheduleService?.reconcile() : undefined)
        .catch(error => ctx.log.warn(`workflow schedule recovery failed: ${describeError(error).message}`))
    },
    // The bridge slot is cleared explicitly rather than trusting teardown order: a second
    // startServiceRuntime in one process would otherwise serve workflow requests through the first
    // boot's closed database handle.
    //
    // In-flight steps are aborted here, before the handle closes, because a headless child that
    // outlives its database writes its outcome onto a closed connection. Run rows stay 'running' and
    // reconcile() sweeps them to 'pending' on the next boot.
    dispose: () => {
      stopScheduleRecovery?.()
      stopScheduleRecovery = null
      live?.stop()
      live = null
      routeCapability?.dispose()
      defsCapability?.dispose()
      schedulesCapability?.dispose()
    },
  }
}
