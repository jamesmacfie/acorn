import { z } from 'zod'
import { IdSchema } from '../../../core/shared/publicApi/primitives'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import { getRunBridge } from '../../../core/server/routes/harness'
import { defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'

// Run targets (docs/public-api.md). Base /plugins/terminal/tasks/:taskId/run-targets.
// Reuses the harness RunBridge (merged config + DB targets, config-trust gate, run reconciliation).
// ponytail: run results pass through as z.unknown() — the bridge's internal shapes aren't modeled as
// strict schemas yet; the endpoints, auth, scope, and trust gating are all in place.

const PLUGIN = 'terminal'
const TaskParams = z.strictObject({ taskId: IdSchema })
const TargetParams = TaskParams.extend({ targetId: z.string().min(1).max(100) })

function bridge() {
  const b = getRunBridge()
  if (!b) throw new PublicApiError('capability_unavailable', 'Run-target engine is not available')
  return b
}

export function buildRunTargetsContribution(): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'terminal.run-targets.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/run-targets',
        scope: 'read',
        risk: 'read',
        summary: 'Merged run targets + layout recipes + parse errors',
        params: TaskParams,
        response: z.unknown(),
        handler: (_ctx, { params }) => bridge().targets(params.taskId),
      }),
      defineEndpoint({
        operationId: 'terminal.run-targets.get',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/run-targets/:targetId',
        scope: 'read',
        risk: 'read',
        summary: 'Run target definition + live status',
        params: TargetParams,
        response: z.unknown(),
        handler: (_ctx, { params }) => bridge().status(params.taskId, params.targetId),
      }),
      defineEndpoint({
        operationId: 'terminal.run-targets.start',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/run-targets/:targetId/start',
        scope: 'write',
        risk: 'execute',
        summary: 'Start a run target (config-trust gated)',
        params: TargetParams,
        body: z.undefined(),
        response: z.unknown(),
        handler: (_ctx, { params }) => bridge().start(params.taskId, params.targetId),
      }),
      defineEndpoint({
        operationId: 'terminal.run-targets.stop',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/run-targets/:targetId/stop',
        scope: 'write',
        risk: 'execute',
        summary: 'Stop a run target',
        params: TargetParams,
        body: z.undefined(),
        response: z.unknown(),
        handler: (_ctx, { params }) => bridge().stop(params.taskId, params.targetId),
      }),
      defineEndpoint({
        operationId: 'terminal.run-targets.restart',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/run-targets/:targetId/restart',
        scope: 'write',
        risk: 'execute',
        summary: 'Restart a run target (config-trust gated)',
        params: TargetParams,
        body: z.undefined(),
        response: z.unknown(),
        handler: (_ctx, { params }) => bridge().restart(params.taskId, params.targetId),
      }),
    ],
  }
}
