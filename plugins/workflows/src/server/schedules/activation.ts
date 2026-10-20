import { describeError, type Disposable, type NodePlugin, type PluginDatabase } from '@acorn/plugin-api/node'
import { destinationQuery } from '../validation/destination'
import { parseWorkflowScheduleTarget, WorkflowScheduleService, type WorkflowScheduleScheduler } from './service'
import type { WorkflowSchedulesBridge } from '../routes/schedules'
import type { WorkflowStartService } from '../runs/admission'
import type { WorkflowRunner } from '../runs/runner'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]
type ScheduleContext = Pick<PluginContext, 'core' | 'dataSources' | 'schedules'>

/** Schedule source review uses the same scoped data-source invocation as run admission. */
export const workflowScheduleService = (
  store: PluginDatabase,
  starts: WorkflowStartService,
  ctx: ScheduleContext,
  reconciled: Promise<void>,
  scheduler?: () => WorkflowScheduleScheduler,
): WorkflowScheduleService => {
  const core = ctx.core
  const scheduleService = new WorkflowScheduleService(store, starts, core, reconciled, {
    scheduler: scheduler,
    describeSource: async (reference, scope, inputs) => {
      const userId = core.identity.active()
      if (!userId) throw new Error('Schedule review requires an active owner')
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
  return scheduleService
}

export const workflowScheduleTarget = (
  scheduleService: WorkflowScheduleService,
): Parameters<ScheduleContext['schedules']['registerTarget']>[0] => {
  return {
    kind: 'workflow',
    parse: (raw) => {
      const parsed = parseWorkflowScheduleTarget(raw)
      return parsed && scheduleService.get(parsed.scheduleId) ? parsed : null
    },
    risk: () => 'execute',
    timezone: (target) => scheduleService.timezone((target as { scheduleId: string }).scheduleId),
    scope: (target) => {
      const projectId = scheduleService.get((target as { scheduleId: string }).scheduleId)?.projectId
      return projectId ? { projectId } : undefined
    },
    run: (target, signal, _consent, context) =>
      scheduleService
        .dispatch((target as { scheduleId: string }).scheduleId, {
          reason: context.reason,
          dueAt: context.dueAt,
          requestKey: context.requestKey,
        })
        .then((result) => (signal.aborted ? Promise.reject(signal.reason) : result)),
    remove: (target) => scheduleService.remove((target as { scheduleId: string }).scheduleId),
  }
}

export const workflowScheduleBridge = (scheduleService: WorkflowScheduleService): WorkflowSchedulesBridge => {
  return {
    list: () => scheduleService.views(),
    get: (id) => scheduleService.view(id),
    defaults: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }),
    prepare: (input) => scheduleService.prepare(input),
    save: (input) => scheduleService.saveManaged(input),
    approve: async (id, firstCheck, freshEpoch) => {
      await scheduleService.approve(id, firstCheck, freshEpoch)
      return scheduleService.view(id)
    },
    pause: (id, paused) => scheduleService.pause(id, paused),
    runNow: (id) => scheduleService.runNow(id),
    remove: (id) => scheduleService.deleteManaged(id),
  }
}

/** A Node clock backs trigger sweeps, with a code host's `checks-changed` as an early wakeup. */
export const registerWorkflowTriggers = (
  ctx: Pick<PluginContext, 'core' | 'events' | 'schedules' | 'log'>,
  runner: WorkflowRunner,
): void => {
  const sweep = () => {
    void runner
      .pollTriggers()
      .catch((error) => ctx.log.warn(`trigger sweep after checks-changed failed: ${describeError(error).message}`))
  }
  // One subscription per running code host, kept in step with the roster so a code host that starts
  // or stops after this plugin is followed too.
  const hosts = new Map<string, Disposable>()
  const followCodeHosts = () => {
    const running = new Set(ctx.core.codeHosts())
    for (const [id, subscription] of hosts) {
      if (running.has(id)) continue
      subscription.dispose()
      hosts.delete(id)
    }
    for (const id of running) {
      if (hosts.has(id)) continue
      try {
        hosts.set(id, ctx.events.on(`plugin:${id}:checks-changed`, sweep))
      } catch {
        // A code host that doesn't emit `checks-changed` refuses the subscription. Its tasks wait for
        // the clock.
      }
    }
  }
  followCodeHosts()
  ctx.events.on('plugins:changed', followCodeHosts)
  ctx.schedules.register({
    scheduleId: 'triggers',
    name: 'Workflow triggers',
    cadence: { every: 300 },
    run: async () => {
      const { started, errors } = await runner.pollTriggers()
      if (errors.length) throw new Error(errors.join('; '))
      return started ? `started ${started}` : undefined
    },
  })
}
