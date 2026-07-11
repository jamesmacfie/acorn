import { z } from 'zod'
import { IdSchema, PageSchema } from '../../../core/shared/publicApi/primitives'
import {
  ResolveGateSchema,
  RunsQuerySchema,
  StartRunSchema,
  WorkflowDefinitionsResponseSchema,
  WorkflowRunSchema,
  WorkflowStepSchema,
} from '../../../core/shared/publicApi/workflows'
import { defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type { WorkflowService } from '../main/workflowService'

// Workflows plugin public API (docs/next/api/plugin-api.md §11). Base /plugins/workflows.
// Runs start by definitionId only. /triggers/evaluate is intentionally not exposed in v1 (no
// standalone trigger-poller service to reuse yet — see the plugin docs).

const PLUGIN = 'workflows'
const TaskParams = z.strictObject({ taskId: IdSchema })
const RunParams = z.strictObject({ runId: IdSchema })
const GateParams = z.strictObject({ runId: IdSchema, stepId: IdSchema })

export function buildWorkflowsPublicApi(workflows: WorkflowService): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'workflows.definitions.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/definitions',
        scope: 'read',
        risk: 'read',
        summary: 'Validated workflow definitions + parse errors',
        params: TaskParams,
        response: WorkflowDefinitionsResponseSchema,
        handler: (_ctx, { params }) => workflows.definitions(params.taskId),
      }),
      defineEndpoint({
        operationId: 'workflows.runs.start',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/runs',
        scope: 'write',
        risk: 'execute',
        summary: 'Start a workflow run by definition id',
        idempotency: 'required',
        params: TaskParams,
        body: StartRunSchema,
        response: WorkflowRunSchema,
        status: 202,
        handler: (_ctx, { params, body }) => workflows.startRun(params.taskId, body.definitionId, body.posture),
      }),
      defineEndpoint({
        operationId: 'workflows.runs.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/runs',
        scope: 'read',
        risk: 'read',
        summary: 'List workflow runs',
        params: TaskParams,
        query: RunsQuerySchema,
        response: PageSchema(WorkflowRunSchema),
        handler: async (_ctx, { params, query }) => {
          const items = await workflows.listRuns(params.taskId, query.status)
          return { items: items.slice(0, query.limit), nextCursor: null }
        },
      }),
      defineEndpoint({
        operationId: 'workflows.runs.get',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/runs/:runId',
        scope: 'read',
        risk: 'read',
        summary: 'Get a workflow run',
        params: RunParams,
        response: WorkflowRunSchema,
        handler: (_ctx, { params }) => workflows.getRun(params.runId),
      }),
      defineEndpoint({
        operationId: 'workflows.runs.steps',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/runs/:runId/steps',
        scope: 'read',
        risk: 'read',
        summary: 'List a run’s steps',
        params: RunParams,
        response: PageSchema(WorkflowStepSchema),
        handler: async (_ctx, { params }) => ({ items: await workflows.getSteps(params.runId), nextCursor: null }),
      }),
      defineEndpoint({
        operationId: 'workflows.gates.resolve',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/runs/:runId/gates/:stepId/resolve',
        scope: 'write',
        risk: 'execute',
        summary: 'Approve or reject a workflow gate',
        params: GateParams,
        body: ResolveGateSchema,
        response: z.strictObject({ run: WorkflowRunSchema, step: WorkflowStepSchema }),
        handler: (_ctx, { params, body }) => workflows.resolveGate(params.runId, params.stepId, body.approved),
      }),
      defineEndpoint({
        operationId: 'workflows.runs.cancel',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/runs/:runId/cancel',
        scope: 'write',
        risk: 'execute',
        summary: 'Cancel a workflow run',
        params: RunParams,
        body: z.undefined(),
        response: WorkflowRunSchema,
        handler: (_ctx, { params }) => workflows.cancel(params.runId),
      }),
      defineEndpoint({
        operationId: 'workflows.triggers.evaluate',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/triggers/evaluate',
        scope: 'write',
        risk: 'execute',
        summary: 'Evaluate workflow triggers (a match starts a run)',
        body: z.undefined(),
        response: z.strictObject({ started: z.number().int().nonnegative(), errors: z.array(z.string()) }),
        handler: () => workflows.evaluateTriggers(),
      }),
      defineEndpoint({
        operationId: 'workflows.steps.kill',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/runs/:runId/steps/:stepId/kill',
        scope: 'write',
        risk: 'execute',
        summary: 'Kill a running workflow step',
        params: GateParams,
        body: z.undefined(),
        response: WorkflowStepSchema,
        handler: (_ctx, { params }) => workflows.killStep(params.runId, params.stepId),
      }),
    ],
  }
}
