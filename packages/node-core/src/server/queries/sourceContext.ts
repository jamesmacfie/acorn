import { and, eq, or } from 'drizzle-orm'
import type { DataBinding, DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { QueryBindingContext, QueryContent } from '@acorn/protocol/dataQueries.ts'
import type { Env } from '../bindings'
import { getDb, schema } from '../db'
import type { DataSourceInvocation } from '../dataSources/authority'
import { invokeDataSource } from '../dataSources/runtime'

const hasContext = (binding: DataBinding, name: 'viewer' | 'workspaceLinks'): boolean =>
  binding.address.from === 'context' && binding.address.name === name
function predicateUsesContext(predicate: DataPredicate, name: 'viewer' | 'workspaceLinks'): boolean {
  return predicate.kind === 'comparison' ? hasContext(predicate.left, name) || !!predicate.right && hasContext(predicate.right, name)
    : predicate.predicates.some(part => predicateUsesContext(part, name))
}

/** Context is host data, scoped to the caller and selected account before a provider query is built. */
export async function sourceBindingContext(env: Env, content: QueryContent, invocation: DataSourceInvocation, evaluationTime: number,
  timePolicy: QueryBindingContext['timePolicy'] = { zone: 'UTC', weekStart: 'monday' }): Promise<QueryBindingContext> {
  const bindings = [...Object.values(content.sourceParameters), ...(content.connection ? [content.connection] : [])]
  const usesViewer = bindings.some(binding => hasContext(binding, 'viewer'))
    || !!content.query.predicate && predicateUsesContext(content.query.predicate, 'viewer')
  const usesLinks = bindings.some(binding => hasContext(binding, 'workspaceLinks'))
    || !!content.query.predicate && predicateUsesContext(content.query.predicate, 'workspaceLinks')
  const context: QueryBindingContext = { evaluationTime, timePolicy }
  const scope = content.query.scope
  if (usesViewer) {
    if (!scope.connectionId) throw new Error('Viewer binding requires a selected account')
    context.viewer = await invokeDataSource(env, { operation: 'identity', source: content.query.source, scope }, invocation)
  }
  if (usesLinks) {
    if (!scope.workspaceId || !scope.connectionId) throw new Error('Workspace links require a workspace and account')
    const db = getDb(env)
    const rows = await db.select({ externalId: schema.workspaceExternalProjects.externalId })
      .from(schema.workspaceExternalProjects)
      .where(and(eq(schema.workspaceExternalProjects.workspaceId, scope.workspaceId),
        eq(schema.workspaceExternalProjects.integrationId, scope.connectionId),
        scope.projectId ? or(eq(schema.workspaceExternalProjects.projectId, ''), eq(schema.workspaceExternalProjects.projectId, scope.projectId)) : undefined))
    const links = rows.map(row => row.externalId)
    if (content.query.source.pluginId === 'github') {
      const projects = await db.select({ owner: schema.projects.githubOwner, name: schema.projects.githubName })
        .from(schema.projects).where(and(eq(schema.projects.workspaceId, scope.workspaceId),
          scope.projectId ? eq(schema.projects.id, scope.projectId) : undefined))
      links.push(...projects.flatMap(project => project.owner && project.name ? [`${project.owner}/${project.name}`] : []))
    }
    context.workspaceLinks = [...new Set(links)].sort()
  }
  return context
}
