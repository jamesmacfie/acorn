import { and, eq, isNull } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { canonicalDataEncoding, parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { QueryPublicationRequest, QueryPublicationResult } from '@acorn/protocol/queryPublication.ts'
import type { Env } from '../bindings'
import type { DataSourceInvocation } from '../dataSources/authority'
import { authorizeQueryScope, queryInScope, validateQueryPublication } from './runtime'
import { queryStore, QueryLibraryError } from './store'
import { queryPublicationHolds, queryDrafts, queryRevisions } from './schema'

/** Compiled workflow coordination only. Holds survive process loss; writes replay exact revisions. */
export async function queryPublication(env: Env, request: QueryPublicationRequest, invocation: DataSourceInvocation): Promise<QueryPublicationResult> {
  const scope = { workspaceId: request.workspaceId, projectId: request.projectId }
  await authorizeQueryScope(env, scope, invocation)
  const db = env.DB
  const store = queryStore(db)
  if (request.action === 'inspect') {
    const draft = store.get(scope, request.queryId)
    return { draft, consumers: store.consumers(scope, draft.id), ...(draft.publishedRevision ? { published: store.published(scope, draft.id, request.revision) } : {}) }
  }
  if (request.action === 'prepare') {
    const draft = store.get(scope, request.queryId)
    if (draft.draftRevision !== request.expectedRevision) throw new QueryLibraryError('conflict')
    queryInScope(draft.content, { workspaceId: draft.workspaceId, projectId: draft.projectId })
    const sourceRevision = await validateQueryPublication(env, draft.content, request.parameters, invocation)
    if (store.get(scope, draft.id).draftRevision !== draft.draftRevision) throw new QueryLibraryError('conflict')
    return { plan: { draft, intendedRevision: (draft.publishedRevision ?? 0) + 1, sourceRevision }, consumers: store.consumers(scope, draft.id) }
  }
  return db.transaction(() => {
    if (request.action === 'release' || request.action === 'abandon') {
      const holds = db.select().from(queryPublicationHolds).where(eq(queryPublicationHolds.operationId, request.operationId)).all()
      for (const hold of holds) {
        const plan = JSON.parse(hold.plan) as import('@acorn/protocol/queryPublication.ts').QueryPublicationPlan
        if (plan.draft.workspaceId !== scope.workspaceId) throw new QueryLibraryError('not-found')
        store.get({ workspaceId: plan.draft.workspaceId, projectId: plan.draft.projectId }, hold.queryId)
        if (request.action === 'release' ? !hold.revision : !!hold.revision) throw new QueryLibraryError('conflict')
      }
      db.update(queryPublicationHolds).set({ released: true }).where(eq(queryPublicationHolds.operationId, request.operationId)).run()
      return {}
    }
    if (!('plan' in request)) throw new QueryLibraryError('invalid-query')
    const { plan, operationId } = request
    const id = plan.draft.id
    const hold = db.select().from(queryPublicationHolds).where(eq(queryPublicationHolds.queryId, id)).get()
    if (hold?.operationId === operationId) {
      if (hold.plan !== JSON.stringify(plan)) throw new QueryLibraryError('conflict')
      if (hold.revision) return { published: store.published(scope, id, hold.revision, operationId) }
    } else {
      if (hold && !hold.released) throw new QueryLibraryError('conflict')
      if (request.action !== 'hold') throw new QueryLibraryError('conflict')
      const draft = store.get(scope, id)
      if (draft.draftRevision !== plan.draft.draftRevision || JSON.stringify(draft.content) !== JSON.stringify(plan.draft.content)
        || draft.publishedRevision !== plan.draft.publishedRevision) throw new QueryLibraryError('conflict')
      db.insert(queryPublicationHolds).values({ queryId: id, operationId, plan: JSON.stringify(plan), released: false })
        .onConflictDoUpdate({ target: queryPublicationHolds.queryId, set: { operationId, plan: JSON.stringify(plan), revision: null, released: false } }).run()
    }
    if (request.action === 'hold') return {}
    const digest = createHash('sha256').update(canonicalDataEncoding(parseDataValue(plan.draft.content))).digest('hex')
    const prior = plan.draft.publishedRevision ? store.published(scope, id, plan.draft.publishedRevision, operationId) : undefined
    if (prior?.digest !== digest) {
      const changed = db.update(queryDrafts).set({ publishedRevision: plan.intendedRevision, basePublishedRevision: plan.intendedRevision, updatedAt: Date.now() })
        .where(and(eq(queryDrafts.id, id), plan.draft.publishedRevision === null ? isNull(queryDrafts.publishedRevision) : eq(queryDrafts.publishedRevision, plan.draft.publishedRevision))).run()
      if (changed.changes !== 1) throw new QueryLibraryError('conflict')
      db.insert(queryRevisions).values({ queryId: id, revision: plan.intendedRevision, workspaceId: plan.draft.workspaceId, projectId: plan.draft.projectId,
        content: JSON.stringify(plan.draft.content), digest, sourceRevision: plan.sourceRevision, createdAt: Date.now() }).run()
    }
    const published = prior?.digest === digest ? prior : store.published(scope, id, plan.intendedRevision, operationId)
    db.update(queryPublicationHolds).set({ revision: published.revision }).where(eq(queryPublicationHolds.queryId, id)).run()
    return { published }
  })
}
