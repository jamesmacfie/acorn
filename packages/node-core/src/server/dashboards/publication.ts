import type { DashboardPanelContent, DashboardRevision, DashboardScope } from '@acorn/protocol/dashboards.ts'
import type { Env } from '../bindings'
import { getDb } from '../db'
import type { DataSourceInvocation } from '../dataSources/authority'
import { queryStore } from '../queries/store'
import { authorizeQueryScope, resolveQuery } from '../queries/runtime'
import { dashboardStore, DashboardLibraryError } from './store'

export async function validateDashboardContent(
  env: Env,
  scope: DashboardScope,
  content: DashboardPanelContent,
  invocation: DataSourceInvocation,
): Promise<void> {
  const ids = new Set<string>()
  for (const entry of content.queries) {
    if (ids.has(entry.id)) throw new DashboardLibraryError('invalid-dashboard')
    ids.add(entry.id)
    await resolveQuery(env, scope, entry.reference, {}, invocation)
  }
}

export async function publishDashboard(
  env: Env,
  scope: DashboardScope,
  id: string,
  expectedRevision: number,
  invocation: DataSourceInvocation,
): Promise<DashboardRevision> {
  await authorizeQueryScope(env, scope, invocation)
  const store = dashboardStore(getDb(env))
  const draft = store.get(scope, id)
  if (draft.draftRevision !== expectedRevision) throw new DashboardLibraryError('conflict')
  const previous = draft.publishedRevision ? store.published(scope, id) : undefined
  await validateDashboardContent(env, scope, draft.content, invocation)
  const published = store.publish(scope, id, expectedRevision)
  const consumer = { pluginId: 'core', kind: 'panel' as const, id, name: published.content.title, href: '/' }
  const referenced = new Set(published.content.queries.flatMap(entry => entry.reference.kind === 'saved' ? [entry.reference.queryId] : []))
  const removed = new Set(previous?.content.queries.flatMap(entry => entry.reference.kind === 'saved' ? [entry.reference.queryId] : []) ?? [])
  for (const queryId of referenced) removed.delete(queryId)
  for (const queryId of removed) queryStore(getDb(env)).setConsumer(scope, queryId, consumer, true)
  for (const queryId of referenced) queryStore(getDb(env)).setConsumer(scope, queryId, consumer)
  return published
}

export function deleteDashboard(env: Env, scope: DashboardScope, id: string, expectedRevision: number): void {
  const store = dashboardStore(getDb(env))
  const draft = store.get(scope, id)
  const published = draft.publishedRevision ? store.published(scope, id) : undefined
  const consumer = { pluginId: 'core', kind: 'panel' as const, id, name: draft.content.title, href: '/' }
  for (const queryId of new Set(published?.content.queries.flatMap(entry => entry.reference.kind === 'saved' ? [entry.reference.queryId] : []) ?? [])) {
    queryStore(getDb(env)).setConsumer(scope, queryId, consumer, true)
  }
  store.delete(scope, id, expectedRevision)
}
