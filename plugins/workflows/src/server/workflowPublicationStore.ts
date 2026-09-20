import { and, eq, ne, isNull } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { workflowDefs, workflowDependencies, workflowPublications, workflowRevisions } from '../node/schema'
import type { WorkflowPublication, WorkflowPublicationWrite } from '../shared/workflowPublication'
import type { WorkflowDef } from '../shared/workflowContracts'

export function publicationStore(db: PluginDatabase) {
  const read = (row: typeof workflowPublications.$inferSelect): WorkflowPublication => ({
    ...row, state: row.state as WorkflowPublication['state'], ...JSON.parse(row.planJson), landed: JSON.parse(row.landedJson),
  })
  const store = {
    get(id: string): WorkflowPublication {
      const row = db.select().from(workflowPublications).where(eq(workflowPublications.id, id)).get()
      if (!row) throw new Error('Publication not found')
      return read(row)
    },
    list(workspaceId: string): WorkflowPublication[] {
      return db.select().from(workflowPublications).where(eq(workflowPublications.workspaceId, workspaceId)).all().map(read)
    },
    assertAvailable(kind: 'workflow' | 'query', id: string, operationId?: string): void {
      for (const row of db.select().from(workflowPublications).where(ne(workflowPublications.state, 'complete')).all()) {
        if (row.id === operationId) continue
        if (read(row).writes.some(write => write.kind === kind && write.id === id)) throw new Error(`Publication ${row.id} requires reconciliation`)
      }
    },
    prepare(operation: WorkflowPublication): WorkflowPublication {
      return db.transaction(() => {
        for (const write of operation.writes) store.assertAvailable(write.kind, write.id)
        db.insert(workflowPublications).values({ id: operation.id, workspaceId: operation.workspaceId, rootId: operation.rootId, state: operation.state,
          planJson: JSON.stringify({ writes: operation.writes, consumers: operation.consumers, reused: operation.reused }), landedJson: '[]', createdAt: operation.createdAt, updatedAt: operation.updatedAt }).run()
        return store.get(operation.id)
      })
    },
    state(id: string, state: WorkflowPublication['state'], error: string | null = null): void {
      db.update(workflowPublications).set({ state, error, updatedAt: Date.now() }).where(eq(workflowPublications.id, id)).run()
    },
    discard(id: string): void {
      if (store.get(id).landed.length || db.select().from(workflowRevisions).where(eq(workflowRevisions.operationId, id)).get()) throw new Error('This publication has landed revisions. Resume it instead.')
      db.delete(workflowPublications).where(eq(workflowPublications.id, id)).run()
    },
    landed(id: string, write: WorkflowPublication['landed'][number]): void {
      const operation = store.get(id)
      if (!operation.landed.some(item => item.kind === write.kind && item.id === write.id)) operation.landed.push(write)
      db.update(workflowPublications).set({ landedJson: JSON.stringify(operation.landed), updatedAt: Date.now() }).where(eq(workflowPublications.id, id)).run()
    },
    write(operationId: string, write: Extract<WorkflowPublicationWrite, { kind: 'workflow' }>): number {
      return db.transaction(() => {
        store.assertAvailable('workflow', write.id, operationId)
        const prior = db.select().from(workflowRevisions).where(and(eq(workflowRevisions.definitionId, write.id), eq(workflowRevisions.revision, write.revision))).get()
        if (prior) {
          if (prior.operationId !== operationId || prior.digest !== write.digest) throw new Error('Published revision conflict')
          return prior.revision
        }
        const changed = db.update(workflowDefs).set({ publishedRevision: write.revision, basePublishedRevision: write.revision })
          .where(and(eq(workflowDefs.id, write.id), write.basePublishedRevision === null ? isNull(workflowDefs.publishedRevision) : eq(workflowDefs.publishedRevision, write.basePublishedRevision))).returning().all()
        if (changed.length !== 1) throw new Error('Published workflow changed after review')
        db.insert(workflowRevisions).values({ id: `${write.id}:${write.revision}`, definitionId: write.id, revision: write.revision,
          workspaceId: write.scope.workspaceId, projectId: write.scope.projectId, defJson: JSON.stringify(write.def), digest: write.digest, operationId, createdAt: Date.now() }).run()
        db.delete(workflowDependencies).where(and(eq(workflowDependencies.consumerId, write.id), ne(workflowDependencies.kind, 'draft-query'))).run()
        for (const step of write.def.steps) {
          const child = step.childWorkflow?.ref
          const dependency = child?.source === 'database' ? { kind: 'workflow', targetId: child.id }
            : step.query?.kind === 'saved' ? { kind: 'query', targetId: step.query.queryId } : null
          if (dependency) db.insert(workflowDependencies).values({ id: `${write.id}:${dependency.kind}:${dependency.targetId}`, consumerId: write.id, ...dependency }).onConflictDoNothing().run()
        }
        return write.revision
      })
    },
  }
  return store
}

export async function publishedWorkflow(db: PluginDatabase, id: string, exactRevision?: number) {
  publicationStore(db).assertAvailable('workflow', id)
  const draft = db.select().from(workflowDefs).where(eq(workflowDefs.id, id)).get()
  const revision = exactRevision ?? draft?.publishedRevision
  if (!revision) return null
  const row = db.select().from(workflowRevisions).where(and(eq(workflowRevisions.definitionId, id), eq(workflowRevisions.revision, revision))).get()
  return row ? { ...row, id, name: (JSON.parse(row.defJson) as WorkflowDef).name, def: JSON.parse(row.defJson) as WorkflowDef } : null
}
