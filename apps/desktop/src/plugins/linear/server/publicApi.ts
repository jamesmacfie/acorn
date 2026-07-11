import { z } from 'zod'
import { PageSchema } from '../../../core/shared/publicApi/primitives'
import {
  CreateLinearCommentSchema,
  LinearIssueDetailSchema,
  LinearIssueQuerySchema,
  LinearIssueSummarySchema,
  LinearProjectIssuesQuerySchema,
  LinearProjectSchema,
  LinearProjectsQuerySchema,
  ResolveLinearIssuesSchema,
} from '../../../core/shared/publicApi/linear'
import { defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type { LinearService } from './linearService'

// Linear provider public API (docs/public-api.md). Base /plugins/linear.

const PLUGIN = 'linear'

export function buildLinearPublicApi(linear: LinearService): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'linear.projects.list',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/projects',
        scope: 'read',
        risk: 'read',
        summary: 'List Linear projects',
        query: LinearProjectsQuerySchema,
        response: z.strictObject({ items: z.array(LinearProjectSchema) }),
        handler: async (ctx, { query }) => ({ items: await linear.projects(ctx.actor.principalId, query.connectionId) }),
      }),
      defineEndpoint({
        operationId: 'linear.projects.issues',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/projects/:projectId/issues',
        scope: 'read',
        risk: 'read',
        summary: 'Issues within a Linear project',
        params: z.strictObject({ projectId: z.string().min(1).max(256) }),
        query: LinearProjectIssuesQuerySchema,
        response: PageSchema(LinearIssueSummarySchema),
        handler: async (ctx, { params, query }) => {
          const items = await linear.projectIssues(ctx.actor.principalId, query.connectionId, [params.projectId])
          return { items: items.slice(0, query.limit), nextCursor: null }
        },
      }),
      defineEndpoint({
        operationId: 'linear.issues.resolve',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/issues/resolve',
        scope: 'read', // read even though POST carries the identifier list
        risk: 'read',
        summary: 'Resolve Linear issue identifiers to summaries',
        body: ResolveLinearIssuesSchema,
        response: z.strictObject({ items: z.array(LinearIssueSummarySchema) }),
        handler: async (ctx, { body }) => ({ items: await linear.resolve(ctx.actor.principalId, body.identifiers, body.connectionId) }),
      }),
      defineEndpoint({
        operationId: 'linear.issues.get',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/issues/:identifier',
        scope: 'read',
        risk: 'read',
        summary: 'Get a Linear issue',
        params: z.strictObject({ identifier: z.string().min(1).max(256) }),
        query: LinearIssueQuerySchema,
        response: LinearIssueDetailSchema,
        handler: (ctx, { params, query }) => linear.detail(ctx.actor.principalId, params.identifier, query.connectionId, query.refresh === 'true'),
      }),
      defineEndpoint({
        operationId: 'linear.issues.comment',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/issues/:identifier/comments',
        scope: 'write',
        risk: 'write',
        summary: 'Comment on a Linear issue',
        idempotency: 'required',
        params: z.strictObject({ identifier: z.string().min(1).max(256) }),
        body: CreateLinearCommentSchema,
        response: z.strictObject({ created: z.literal(true) }),
        status: 201,
        handler: (ctx, { params, body }) => linear.comment(ctx.actor.principalId, params.identifier, body.body, body.connectionId, body.parentId),
      }),
    ],
  }
}
