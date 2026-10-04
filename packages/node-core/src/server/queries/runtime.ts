import { queryContentSchema, queryReferenceSchema, queryScopeSchema, type QueryContent, type QueryReference, type QueryScope, type QueryBindingContext, type ResolvedQuery } from '@acorn/protocol/dataQueries.ts'
import { resolveQueryContent, resolveQueryParameters } from '@acorn/protocol/dataQueryResolution.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import { getDb } from '../db'
import { authorizeDataSource, type DataSourceInvocation } from '../dataSources/authority'
import { invokeDataSource } from '../dataSources/runtime'
import { queryStore, QueryLibraryError } from './store'
import { validateQueryChoices, validateQueryTemplate } from './validation'

export async function authorizeQueryScope(env: Env, scope: QueryScope, invocation: DataSourceInvocation): Promise<void> {
  queryScopeSchema.parse(scope)
  await authorizeDataSource(env, invocation, { ...scope, parameters: {} })
}
export function queryInScope(content: QueryContent, scope: QueryScope): void {
  if (content.query.scope.workspaceId !== scope.workspaceId || content.query.scope.projectId !== scope.projectId) throw new QueryLibraryError('invalid-query')
}
export async function validateQueryPublication(env: Env, content: QueryContent, parameters: Record<string, DataValue>, invocation: DataSourceInvocation): Promise<string> {
  const parsed = queryContentSchema.parse(content)
  const time = Date.now()
  const hostContext = await (await import('./sourceContext')).sourceBindingContext(env, parsed, invocation, time)
  const query = resolveQueryContent(parsed, parameters, time, hostContext)
  const bounded = { ...invocation, signal: AbortSignal.any([invocation.signal, AbortSignal.timeout(60_000)]) }
  const description = await invokeDataSource(env, { operation: 'describe', source: query.source, scope: query.scope }, bounded)
  validateQueryTemplate(content, description)
  await validateQueryChoices(env, query, description, bounded)
  return description.revision
}
export async function publishQuery(env: Env, scope: QueryScope, id: string, expectedRevision: number, parameters: Record<string, DataValue>, invocation: DataSourceInvocation) {
  await authorizeQueryScope(env, scope, invocation)
  const store = queryStore(getDb(env))
  const draft = store.get(scope, id)
  if (draft.draftRevision !== expectedRevision) throw new QueryLibraryError('conflict')
  queryInScope(draft.content, { workspaceId: draft.workspaceId, projectId: draft.projectId })
  const sourceRevision = await validateQueryPublication(env, draft.content, parameters, invocation)
  // Metadata calls may yield to another device's save; the transaction rechecks the reviewed revision.
  await authorizeQueryScope(env, scope, invocation)
  return store.publish(scope, id, expectedRevision, sourceRevision)
}
export async function resolveQuery(env: Env, scope: QueryScope, input: QueryReference, context: QueryBindingContext, invocation: DataSourceInvocation, allowedPluginId?: string): Promise<ResolvedQuery> {
  await authorizeQueryScope(env, scope, invocation)
  const reference = queryReferenceSchema.parse(input)
  const published = reference.kind === 'saved' ? queryStore(getDb(env)).published(scope, reference.queryId, reference.revision) : undefined
  const content = reference.kind === 'inline' ? reference.content : published!.content
  if (allowedPluginId && content.query.source.pluginId !== allowedPluginId) throw new QueryLibraryError('not-found')
  queryInScope(content, published ? { workspaceId: published.workspaceId, projectId: published.projectId } : scope)
  const evaluationTime = context.evaluationTime ?? Date.now()
  const hostContext = await (await import('./sourceContext')).sourceBindingContext(env, content, invocation, evaluationTime, context.timePolicy)
  const parameters = resolveQueryParameters(content, reference.bindings, { ...hostContext, ...context })
  const query = resolveQueryContent(content, parameters, evaluationTime, { ...hostContext, ...context })
  // A workspace query used by a project keeps its authored workspace scope, never silently narrows.
  await validateQueryPublication(env, content, parameters, invocation)
  return { query, parameters, ...(published ? { published } : {}) }
}
