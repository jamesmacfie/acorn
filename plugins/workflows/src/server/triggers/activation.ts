import type { NodePlugin, PluginDatabase } from '@acorn/plugin-api/node'
import { destinationQuery } from '../validation/destination'
import { parseWorkflowTriggerTarget, WorkflowTriggerService, type WorkflowTriggerScheduler } from './service'
import type { WorkflowTriggersBridge } from '../routes/triggers'
import type { WorkflowStartService } from '../runs/admission'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]
type TriggerContext = Pick<PluginContext, 'core' | 'dataSources' | 'schedules'>

/** Trigger source review uses the same scoped data-source invocation as run admission. */
export const workflowTriggerService = (
  store: PluginDatabase,
  starts: WorkflowStartService,
  ctx: TriggerContext,
  reconciled: Promise<void>,
  scheduler?: () => WorkflowTriggerScheduler,
): WorkflowTriggerService => {
  const core = ctx.core
  return new WorkflowTriggerService(store, starts, core, reconciled, {
    scheduler: scheduler,
    describeSource: async (reference, scope, inputs) => {
      const userId = core.identity.active()
      if (!userId) throw new Error('Trigger review requires an active owner')
      const invocation = {
        principal: { kind: 'internal' as const, scope: 'service' as const, userId },
        signal: AbortSignal.timeout(60_000),
      }
      // Resolution scopes also carry repo and user directories for workflow loading. The query
      // and source seams deliberately accept only their public scope fields, so do not leak the
      // wider workflow object across that validation boundary.
      const queryScope = { workspaceId: scope.workspaceId, projectId: scope.projectId }
      const resolved = await ctx.dataSources.resolveQuery(
        queryScope,
        destinationQuery(reference, queryScope),
        { inputs },
        invocation,
      )
      const [description, catalog] = await Promise.all([
        ctx.dataSources.invoke(
          { operation: 'describe', source: resolved.query.source, scope: resolved.query.scope },
          invocation,
        ),
        ctx.dataSources.list({ ...queryScope, parameters: {} }, invocation),
      ])
      const source = catalog.sources.find(
        (candidate) =>
          candidate.pluginId === resolved.query.source.pluginId &&
          candidate.sourceId === resolved.query.source.sourceId,
      )
      return {
        label: source?.plural ?? source?.name ?? resolved.query.source.sourceId,
        schema: description.schema,
        fields: description.fields,
        incremental: description.operations.incremental,
        ...(description.incremental?.semantics ? { incrementalReason: description.incremental.semantics } : {}),
      }
    },
  })
}

/** The scheduler target a clock trigger's core row points at. The kind stays `workflow`. */
export const workflowTriggerTarget = (
  triggers: WorkflowTriggerService,
): Parameters<TriggerContext['schedules']['registerTarget']>[0] => {
  const triggerId = (target: unknown) => (target as { triggerId: string }).triggerId
  return {
    kind: 'workflow',
    parse: (raw) => {
      const parsed = parseWorkflowTriggerTarget(raw)
      return parsed && triggers.get(parsed.triggerId) ? parsed : null
    },
    risk: () => 'execute',
    // The workflow's page, whose Triggers list holds this one.
    opens: (target) => {
      const row = triggers.get(triggerId(target))
      return row ? { projectId: row.projectId, rest: ['x', 'workflows', `db:${row.workflowId}`] } : undefined
    },
    timezone: (target) => triggers.when(triggerId(target))?.timezone,
    scope: (target) => {
      const projectId = triggers.get(triggerId(target))?.projectId
      return projectId ? { projectId } : undefined
    },
    run: (target, signal, _consent, context) =>
      triggers
        .dispatch(triggerId(target), {
          reason: context.reason,
          dueAt: context.dueAt,
          requestKey: context.requestKey,
        })
        .then((result) => (signal.aborted ? Promise.reject(signal.reason) : result)),
    remove: (target) => triggers.remove(triggerId(target)),
  }
}

export const workflowTriggerBridge = (triggers: WorkflowTriggerService): WorkflowTriggersBridge => {
  return {
    list: () => triggers.views(),
    get: (id) => triggers.view(id),
    defaults: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    prepare: (input) => triggers.prepare(input),
    save: (input) => triggers.saveManaged(input),
    approve: async (id, firstCheck, freshEpoch) => {
      await triggers.approve(id, firstCheck, freshEpoch)
      return triggers.view(id)
    },
    pause: (id, paused) => triggers.pause(id, paused),
    runNow: (id) => triggers.runNow(id),
    remove: (id) => triggers.deleteManaged(id),
  }
}
