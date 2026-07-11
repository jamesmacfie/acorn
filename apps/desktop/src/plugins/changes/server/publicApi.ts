import { z } from 'zod'
import { IdSchema } from '../../../core/shared/publicApi/primitives'
import {
  CommitResultSchema,
  CommitSchema,
  DiscardSchema,
  GitActionSchema,
  GitBlobQuerySchema,
  GitBlobSchema,
  GitDiffQuerySchema,
  GitPathsSchema,
  GitPatchSchema,
  GitStatusSchema,
} from '../../../core/shared/publicApi/git'
import { defineEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type { LocalGitService } from '../main/localGitService'

// Changes (git) plugin public API (docs/next/api/terminal-git-files.md §7–§8). Base
// /plugins/changes/tasks/:taskId/git. Thin adapters over LocalGitService.

const PLUGIN = 'changes'
const TaskParams = z.strictObject({ taskId: IdSchema })

export function buildChangesPublicApi(git: LocalGitService): PluginApiContribution {
  return {
    pluginId: PLUGIN,
    endpoints: [
      defineEndpoint({
        operationId: 'changes.git.status',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/git/status',
        scope: 'read',
        risk: 'read',
        summary: 'Working-tree status',
        params: TaskParams,
        response: GitStatusSchema,
        handler: (_ctx, { params }) => git.status(params.taskId),
      }),
      defineEndpoint({
        operationId: 'changes.git.diff',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/git/diff',
        scope: 'read',
        risk: 'read',
        summary: 'Bounded patch for one file',
        params: TaskParams,
        query: GitDiffQuerySchema,
        response: GitPatchSchema,
        handler: (_ctx, { params, query }) => git.diff(params.taskId, query.path, query.scope),
      }),
      defineEndpoint({
        operationId: 'changes.git.blob',
        pluginId: PLUGIN,
        method: 'GET',
        path: '/tasks/:taskId/git/blob',
        scope: 'read',
        risk: 'read',
        summary: 'Bounded file content at a ref',
        params: TaskParams,
        query: GitBlobQuerySchema,
        response: GitBlobSchema,
        handler: (_ctx, { params, query }) => git.blob(params.taskId, query.path, query.ref),
      }),
      defineEndpoint({
        operationId: 'changes.git.stage',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/git/stage',
        scope: 'write',
        risk: 'execute',
        summary: 'Stage paths or all',
        params: TaskParams,
        body: GitPathsSchema,
        response: GitActionSchema,
        handler: (_ctx, { params, body }) => git.stage(params.taskId, body),
      }),
      defineEndpoint({
        operationId: 'changes.git.unstage',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/git/unstage',
        scope: 'write',
        risk: 'execute',
        summary: 'Unstage paths or all',
        params: TaskParams,
        body: GitPathsSchema,
        response: GitActionSchema,
        handler: (_ctx, { params, body }) => git.unstage(params.taskId, body),
      }),
      defineEndpoint({
        operationId: 'changes.git.discard',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/git/discard',
        scope: 'write',
        risk: 'execute',
        summary: 'Discard changes (irreversible)',
        params: TaskParams,
        body: DiscardSchema,
        response: GitActionSchema,
        handler: (_ctx, { params, body }) => git.discard(params.taskId, body),
      }),
      defineEndpoint({
        operationId: 'changes.git.commit',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/git/commit',
        scope: 'write',
        risk: 'execute',
        summary: 'Commit staged changes',
        params: TaskParams,
        body: CommitSchema,
        response: CommitResultSchema,
        handler: (_ctx, { params, body }) => git.commit(params.taskId, body),
      }),
      defineEndpoint({
        operationId: 'changes.git.push',
        pluginId: PLUGIN,
        method: 'POST',
        path: '/tasks/:taskId/git/push',
        scope: 'write',
        risk: 'execute',
        summary: 'Push the task branch to its upstream',
        params: TaskParams,
        body: z.undefined(),
        response: GitActionSchema,
        handler: (_ctx, { params }) => git.push(params.taskId),
      }),
    ],
  }
}
