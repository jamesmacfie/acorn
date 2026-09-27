import type { NodePlugin } from '@acorn/plugin-api/node'
import { compareDataValues, parseDataPredicate, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { queryReferenceSchema, type QueryScope, type ResolvedQuery } from '@acorn/protocol/dataQueries.ts'
import { readDataBinding, resolveDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import { dataRecordRefSchema, type DataSourceRequest, type DataSourceResponse } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { StepHandler, StepHandlerContext, WorkflowStepRow } from '../../shared/workflowContracts'

type PluginContext = Parameters<NonNullable<NodePlugin['init']>>[0]
export type WorkflowDataAccess = {
  scope: QueryScope
  resolve(reference: Parameters<PluginContext['dataSources']['resolveQuery']>[1], context: Parameters<PluginContext['dataSources']['resolveQuery']>[2]): Promise<ResolvedQuery>
  invoke<R extends DataSourceRequest>(request: R): Promise<DataSourceResponse<R>>
}
export type WorkflowDataServices = {
  incremental?(runId: string, stepId: string, query: ResolvedQuery['query']): ResolvedQuery['query']
  access?(taskId: string, signal: AbortSignal): Promise<WorkflowDataAccess>
  setStep(id: string, patch: Partial<WorkflowStepRow>): Promise<void>
}

export function assertWorkflowDataScope(scope: QueryScope, candidate: { workspaceId?: string; projectId?: string }): void {
  if (candidate.workspaceId !== scope.workspaceId || (candidate.projectId !== undefined && candidate.projectId !== scope.projectId)) throw new Error('Query is outside the workflow project')
}

export function evaluateWorkflowCondition(input: DataPredicate, context: StepHandlerContext): boolean {
  const values = { inputs: { ...context.inputs }, steps: { ...context.predecessorValues } }
  function evaluate(predicate: DataPredicate): boolean {
    if (predicate.kind !== 'comparison') return predicate.kind === 'all' ? predicate.predicates.every(evaluate) : predicate.predicates.some(evaluate)
    return compareDataValues(readDataBinding(predicate.left, values), predicate.operator,
      predicate.right ? readDataBinding(predicate.right, values) : undefined)
  }
  return evaluate(parseDataPredicate(input))
}

/** The source facade owns paging, authority and schema validation; these handlers own durable workflow values. */
export function workflowDataHandlers(services: WorkflowDataServices): Record<'find-records' | 'get-record-details' | 'if', StepHandler> {
  return {
    if: async context => {
      if (!context.def.condition) throw new Error('If needs a condition')
      const matched = evaluateWorkflowCondition(context.def.condition, context)
      return { status: 'done', structured: { matched, verdict: matched ? 'true' : 'otherwise' } }
    },
    'find-records': async context => {
      if (!services.access) throw new Error('Data sources unavailable')
      const access = await services.access(context.run.taskId, context.signal)
      const prior = context.step.inputsJson ? JSON.parse(context.step.inputsJson) : {}
      let frozen = prior.dataSelection as { resolved: ResolvedQuery; evaluationTime: number } | undefined
      if (!frozen) {
        const evaluationTime = Date.now()
        const reference = queryReferenceSchema.parse(context.def.query)
        const resolved = await access.resolve(reference, { inputs: { ...context.inputs }, steps: { ...context.predecessorValues }, evaluationTime })
        if (context.def.incremental || resolved.query.incremental) {
          if (!services.incremental) throw new Error('Incremental processing is unavailable')
          resolved.query = services.incremental(context.run.id, context.step.id, resolved.query)
        }
        frozen = { resolved, evaluationTime }
        // Crash/retry resumes these exact arguments, even if a saved query or wall clock changes.
        await services.setStep(context.step.id, { inputsJson: JSON.stringify({ ...prior, dataSelection: frozen }) })
      }
      const result = await access.invoke({ operation: 'query', query: frozen.resolved.query, evaluationTime: frozen.evaluationTime, mode: 'execution', pageSize: DATA_LIMITS.options })
      if (!['complete', 'bounded'].includes(result.completeness.kind)) throw new Error('Incomplete selection; dependent steps cannot run')
      const structured = { ...result, provenance: frozen.resolved }
      parseDataValue(structured, DATA_LIMITS.selectionBytes)
      return { status: 'done', structured }
    },
    'get-record-details': async context => {
      if (!services.access || !context.def.record) throw new Error('Record details need a record binding and source access')
      const access = await services.access(context.run.taskId, context.signal)
      const ref = dataRecordRefSchema.parse(resolveDataBinding(context.def.record, { inputs: { ...context.inputs }, steps: { ...context.predecessorValues } }))
      const scope = ref.scope ?? { ...access.scope, connectionId: ref.connectionId, parameters: {} }
      const result = await access.invoke({ operation: 'details', ref, scope, projection: context.def.projection ?? [] })
      if (result.kind === 'not-found') throw new Error('Record not found')
      return { status: 'done', structured: { ref, ...result } }
    },
  }
}
