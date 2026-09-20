import { randomUUID, createHash } from 'node:crypto'
import { and, eq, isNull, or } from 'drizzle-orm'
import { queryContentSchema, queryConsumerSchema, type QueryContent, type QueryConsumer, type QueryDraft, type QueryRevision, type QueryScope } from '@acorn/protocol/dataQueries.ts'
import { canonicalDataEncoding, parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { AppDatabase } from '../db'
import { queryDrafts, queryRevisions, queryConsumers, queryPublicationHolds } from './schema'

export class QueryLibraryError extends Error {
  constructor(readonly code: 'not-found' | 'conflict' | 'unpublished' | 'referenced' | 'invalid-query') { super(code) }
}
const scopeWhere = (scope: QueryScope) => and(eq(queryDrafts.workspaceId, scope.workspaceId), scope.projectId
  ? or(isNull(queryDrafts.projectId), eq(queryDrafts.projectId, scope.projectId)) : isNull(queryDrafts.projectId))
function draft(row: typeof queryDrafts.$inferSelect): QueryDraft {
  return { ...row, projectId: row.projectId ?? undefined, content: queryContentSchema.parse(JSON.parse(row.content)) }
}
function revision(row: typeof queryRevisions.$inferSelect): QueryRevision {
  return { ...row, projectId: row.projectId ?? undefined, content: queryContentSchema.parse(JSON.parse(row.content)) }
}
export function queryStore(db: AppDatabase) {
  const store = {
    list(scope: QueryScope): QueryDraft[] {
      return db.select().from(queryDrafts).where(scopeWhere(scope)).all().map(draft)
    },
    get(scope: QueryScope, id: string): QueryDraft {
      const row = db.select().from(queryDrafts).where(and(eq(queryDrafts.id, id), scopeWhere(scope))).get()
      if (!row) throw new QueryLibraryError('not-found')
      return draft(row)
    },
    create(scope: QueryScope, content: QueryContent): QueryDraft {
      const now = Date.now()
      const id = randomUUID()
      db.insert(queryDrafts).values({ ...scope, id, content: JSON.stringify(queryContentSchema.parse(content)), draftRevision: 1, createdAt: now, updatedAt: now }).run()
      return store.get(scope, id)
    },
    save(scope: QueryScope, id: string, expectedRevision: number, content: QueryContent): QueryDraft {
      const result = db.update(queryDrafts).set({ content: JSON.stringify(queryContentSchema.parse(content)), draftRevision: expectedRevision + 1, updatedAt: Date.now() })
        .where(and(eq(queryDrafts.id, id), scopeWhere(scope), eq(queryDrafts.draftRevision, expectedRevision))).run()
      if (result.changes !== 1) throw new QueryLibraryError('conflict')
      return store.get(scope, id)
    },
    published(scope: QueryScope, id: string, exactRevision?: number, operationId?: string): QueryRevision {
      const hold = db.select().from(queryPublicationHolds).where(eq(queryPublicationHolds.queryId, id)).get()
      if (hold && !hold.released && hold.operationId !== operationId) throw new QueryLibraryError('unpublished')
      // Immutable rows outlive a deleted draft so already-pinned runs can still inspect them.
      const number = exactRevision ?? store.get(scope, id).publishedRevision
      if (!number) throw new QueryLibraryError('unpublished')
      const row = db.select().from(queryRevisions).where(and(eq(queryRevisions.queryId, id), eq(queryRevisions.revision, number), eq(queryRevisions.workspaceId, scope.workspaceId),
        scope.projectId ? or(isNull(queryRevisions.projectId), eq(queryRevisions.projectId, scope.projectId)) : isNull(queryRevisions.projectId))).get()
      if (!row) throw new QueryLibraryError('not-found')
      return revision(row)
    },
    publish(scope: QueryScope, id: string, expectedRevision: number, sourceRevision: string, operationId?: string): { published: QueryRevision; consumers: QueryConsumer[] } {
      return db.transaction(() => {
        const hold = db.select().from(queryPublicationHolds).where(eq(queryPublicationHolds.queryId, id)).get()
        if (hold && !hold.released && hold.operationId !== operationId) throw new QueryLibraryError('conflict')
        const current = store.get(scope, id)
        if (current.draftRevision !== expectedRevision) throw new QueryLibraryError('conflict')
        const digest = createHash('sha256').update(canonicalDataEncoding(parseDataValue(current.content))).digest('hex')
        if (current.publishedRevision && store.published(scope, id, undefined, operationId).digest === digest) return { published: store.published(scope, id, undefined, operationId), consumers: store.consumers(scope, id) }
        const next = (current.publishedRevision ?? 0) + 1
        const result = db.update(queryDrafts).set({ publishedRevision: next, basePublishedRevision: next, draftRevision: expectedRevision + 1, updatedAt: Date.now() })
          .where(and(eq(queryDrafts.id, id), scopeWhere(scope), eq(queryDrafts.draftRevision, expectedRevision))).run()
        if (result.changes !== 1) throw new QueryLibraryError('conflict')
        db.insert(queryRevisions).values({ queryId: id, revision: next, workspaceId: current.workspaceId, projectId: current.projectId, content: JSON.stringify(current.content), digest, sourceRevision, createdAt: Date.now() }).run()
        return { published: store.published(scope, id, next, operationId), consumers: store.consumers(scope, id) }
      })
    },
    consumers(scope: QueryScope, id: string): QueryConsumer[] {
      store.get(scope, id)
      return db.select().from(queryConsumers).where(eq(queryConsumers.queryId, id)).all().map(row => queryConsumerSchema.parse(JSON.parse(row.content)))
    },
    setConsumer(scope: QueryScope, id: string, consumer: QueryConsumer, remove = false): void {
      db.transaction(() => {
        store.get(scope, id)
        const key = and(eq(queryConsumers.queryId, id), eq(queryConsumers.pluginId, consumer.pluginId), eq(queryConsumers.kind, consumer.kind), eq(queryConsumers.consumerId, consumer.id))
        if (remove) { db.delete(queryConsumers).where(key).run(); return }
        db.insert(queryConsumers).values({ ...scope, queryId: id, pluginId: consumer.pluginId, kind: consumer.kind, consumerId: consumer.id, content: JSON.stringify(queryConsumerSchema.parse(consumer)) })
          .onConflictDoUpdate({ target: [queryConsumers.queryId, queryConsumers.pluginId, queryConsumers.kind, queryConsumers.consumerId], set: { content: JSON.stringify(consumer) } }).run()
      })
    },
    delete(scope: QueryScope, id: string, expectedRevision: number): void {
      db.transaction(() => {
        const hold = db.select().from(queryPublicationHolds).where(eq(queryPublicationHolds.queryId, id)).get()
        if (hold && !hold.released) throw new QueryLibraryError('referenced')
        const current = store.get(scope, id)
        if (current.draftRevision !== expectedRevision) throw new QueryLibraryError('conflict')
        if (store.consumers(scope, id).length) throw new QueryLibraryError('referenced')
        const result = db.delete(queryDrafts).where(and(eq(queryDrafts.id, id), scopeWhere(scope), eq(queryDrafts.draftRevision, expectedRevision))).run()
        if (result.changes !== 1) throw new QueryLibraryError('conflict')
      })
    },
  }
  return store
}
