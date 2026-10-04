import type { DashboardContent, DashboardRevision, DashboardScope } from '@acorn/protocol/dashboards.ts'
import type { DashboardProblem } from '@acorn/dashboards-core/projection'
import { upgradePanelContent, validatePanelPlan, type PlanSource } from '@acorn/dashboards-core/plan.ts'
import type { Env } from '../bindings'
import { getDb } from '../db'
import type { DataSourceInvocation } from '../dataSources/authority'
import { invokeDataSource } from '../dataSources/runtime'
import { describeError } from '../telemetry/logger'
import { queryStore } from '../queries/store'
import { authorizeQueryScope, resolveQuery } from '../queries/runtime'
import { dashboardStore, DashboardLibraryError } from './store'

/** Every reason publication would refuse this content, each naming its path. Empty means it fits. */
export async function dashboardContentProblems(
  env: Env,
  scope: DashboardScope,
  content: DashboardContent,
  invocation: DataSourceInvocation,
): Promise<DashboardProblem[]> {
  const plan = 'version' in content ? content : upgradePanelContent(content)
  const problems: DashboardProblem[] = []
  const described: PlanSource[] = []
  for (const [index, entry] of plan.sources.entries()) {
    try {
      const resolved = await resolveQuery(env, scope, entry.reference, {}, invocation)
      const description = await invokeDataSource(env, { operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }, invocation)
      described.push({ instanceId: entry.id, label: entry.label, query: resolved.query, description })
    } catch (error) {
      problems.push({
        path: `/sources/${index}/reference`,
        message: `${entry.label} can't be read (${describeError(error).message}). Check that its account is connected and its saved query still exists.`,
      })
    }
  }
  // The rest needs every source's description, so an unreadable query is the only answer for now.
  return problems.length ? problems : validatePanelPlan(plan, described).filter(problem => problem.severity === 'error')
}

export async function validateDashboardContent(
  env: Env,
  scope: DashboardScope,
  content: DashboardContent,
  invocation: DataSourceInvocation,
): Promise<void> {
  const problems = await dashboardContentProblems(env, scope, content, invocation)
  if (problems.length) throw new DashboardLibraryError('invalid-dashboard', problems)
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
  const referenced = new Set(published.content.sources.flatMap(entry => entry.reference.kind === 'saved' ? [entry.reference.queryId] : []))
  const removed = new Set(previous?.content.sources.flatMap(entry => entry.reference.kind === 'saved' ? [entry.reference.queryId] : []) ?? [])
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
  for (const queryId of new Set(published?.content.sources.flatMap(entry => entry.reference.kind === 'saved' ? [entry.reference.queryId] : []) ?? [])) {
    queryStore(getDb(env)).setConsumer(scope, queryId, consumer, true)
  }
  store.delete(scope, id, expectedRevision)
}
