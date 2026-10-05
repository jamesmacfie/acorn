import { homedir } from 'node:os'
import { type NodePlugin, type PluginDatabase } from '@acorn/plugin-api/node'
import { workflowTaskResolutionScope } from '../definitions/resolution'
import { validateWorkflowDestination } from '../validation/destination'
import { WorkflowStartService } from './admission'
import type { WorkflowRunner } from './runner'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]
type StartContext = Pick<PluginContext, 'core' | 'events' | 'dataSources'>

export const workflowStartService = (
  store: PluginDatabase,
  runner: WorkflowRunner,
  ctx: StartContext,
  reconciled: Promise<void>,
): WorkflowStartService => {
  const core = ctx.core
  // Scope construction lives beside definition resolution, so routes, child dispatch, and the
  // later scheduler adapter cannot disagree about which workspace, project, or checkout applies.
  const taskScope = (taskId: string) => workflowTaskResolutionScope(core, taskId, homedir())
  return new WorkflowStartService(store, runner, {
    reconciled: reconciled,
    taskScope,
    project: (projectId) => core.projects.byId(projectId),
    authorizeRepoConfig: (taskId) => core.projects.assertConfigTrusted(taskId),
    authorizeProjectConfig: (projectId) => core.projects.assertProjectConfigTrusted(projectId),
    onTrustRequired: (taskId) => ctx.events.repoConfigTrustNotice(taskId),
    validateDestination: async (graph, scope) => {
      const userId = core.identity.active()
      if (!userId) throw new Error('Destination validation requires an active owner')
      await validateWorkflowDestination(graph, { workspaceId: scope.workspaceId, projectId: scope.projectId }, (reference, inputs) =>
        ctx.dataSources.resolveQuery({ workspaceId: scope.workspaceId, projectId: scope.projectId }, reference, { inputs },
          { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) }))
    },
    queryRevision: async (queryId, scope) => {
      const userId = core.identity.active()
      if (!userId) throw new Error('Query resolution requires an active owner')
      const result = await ctx.dataSources.queryPublication({ action: 'inspect', queryId, workspaceId: scope.workspaceId, projectId: scope.projectId },
        { principal: { kind: 'internal', scope: 'service', userId }, signal: AbortSignal.timeout(60_000) })
      if (!result.published) throw new Error('Query is not published')
      return result.published.revision
    },
  }, homedir())
}
