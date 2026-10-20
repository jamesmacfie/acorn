// How a record trigger reads its source: in the trigger's project scope, as the workflow's owner, the
// same way a Find records step does.
import type { QueryScope } from '@acorn/protocol/dataQueries.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import { WorkflowAuthorityError } from '../runs/authority'
import { assertWorkflowDataScope } from '../steps/data'
import { destinationQuery } from '../validation/destination'
import type { TriggerContext } from './activation'
import type { TriggerSourceDescriber } from './clock'
import type { TriggerRecordReader } from './records'

const PREVIEW_PAGE = 20

type Invocation = Parameters<TriggerContext['dataSources']['invoke']>[1]

export function triggerRecordReader(
  ctx: Pick<TriggerContext, 'core' | 'dataSources'>,
  invocation: () => Invocation,
  describeSource: TriggerSourceDescriber,
): TriggerRecordReader {
  const projectScope = async (projectId: string): Promise<QueryScope> => {
    const project = await ctx.core.projects.byId(projectId)
    if (!project) throw new WorkflowAuthorityError('missing', 'That project no longer exists.')
    return { workspaceId: project.workspaceId, projectId }
  }
  return {
    describe: async (projectId, reference) => describeSource(reference, await projectScope(projectId), {}),
    resolve: async (projectId, reference, evaluationTime) => {
      const scope = await projectScope(projectId)
      const resolved = await ctx.dataSources.resolveQuery(
        scope,
        destinationQuery(reference, scope),
        { evaluationTime },
        invocation(),
      )
      assertWorkflowDataScope(scope, resolved.query.scope)
      return resolved
    },
    read: async (projectId, query, evaluationTime, mode) => {
      assertWorkflowDataScope(await projectScope(projectId), query.scope)
      const pageSize = mode === 'preview' ? PREVIEW_PAGE : DATA_LIMITS.options
      return ctx.dataSources.invoke({ operation: 'query', query, evaluationTime, mode, pageSize }, invocation())
    },
    // The consumer kinds predate triggers. `schedule` names what a trigger replaced.
    consume: async (projectId, queryId, consumer, remove) =>
      ctx.dataSources.setQueryConsumer(
        await projectScope(projectId),
        queryId,
        { kind: 'schedule', ...consumer },
        invocation(),
        remove,
      ),
  }
}
