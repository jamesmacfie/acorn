import { randomUUID } from 'node:crypto'
import { and, desc, eq, ne } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { QueryConsumer, QueryScope } from '@acorn/protocol/dataQueries.ts'
import { workflowDefs, workflowDependencies, workflowRevisions } from '../../node/schema'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { createDef, getDef, removeDef, updateDef, type StoredWorkflowDef } from '../definitions/store'

type QueryConsumerWriter = (scope: QueryScope, queryId: string, consumer: Omit<QueryConsumer, 'pluginId'>, remove?: boolean) => Promise<void>
const ids = (def: WorkflowDef) => new Set(def.steps.flatMap(step => step?.query?.kind === 'saved' ? [step.query.queryId] : []))
const scopeOf = (row: StoredWorkflowDef): QueryScope => ({ workspaceId: row.workspaceId, projectId: row.projectId ?? undefined })

/** Draft and published consumers have separate identities. Tracked claims make interrupted
 * cross-store writes conservative and recoverable without making the draft executable. */
export function workflowDraftQueries(db: PluginDatabase, writeConsumer: QueryConsumerWriter) {
  const pending = new Map<string, Promise<unknown>>()
  const serial = async <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const prior = pending.get(id)
    const next = (prior ?? Promise.resolve()).catch(() => undefined).then(work)
    pending.set(id, next)
    try { return await next } finally { if (pending.get(id) === next) pending.delete(id) }
  }
  const claims = (id: string) => db.select().from(workflowDependencies)
    .where(and(eq(workflowDependencies.consumerId, id), eq(workflowDependencies.kind, 'draft-query'))).all()
  const track = (id: string, scope: QueryScope, queryIds: Iterable<string>) => {
    for (const queryId of queryIds) db.insert(workflowDependencies).values({
      id: JSON.stringify(['draft-query', id, scope.workspaceId, scope.projectId ?? null, queryId]),
      consumerId: id, kind: 'draft-query', targetId: queryId,
    }).onConflictDoNothing().run()
  }
  const consumer = (id: string, name: string): Omit<QueryConsumer, 'pluginId'> => ({ kind: 'workflow', id: `draft:${id}`, name: `${name} (draft)`, href: `/workflows/db:${id}` })
  const protect = async (id: string, scope: QueryScope, def: WorkflowDef) => {
    const queryIds = ids(def)
    track(id, scope, queryIds)
    for (const queryId of queryIds) await writeConsumer(scope, queryId, consumer(id, def.name))
  }
  const reconcileOne = async (id: string) => {
    const row = await getDef(db, id)
    if (row) await protect(id, scopeOf(row), row.def)
    const desired = row ? ids(row.def) : new Set<string>()
    for (const claim of claims(id)) {
      if (desired.has(claim.targetId)) continue
      const [, , workspaceId, projectId] = JSON.parse(claim.id) as [string, string, string, string | null, string]
      try { await writeConsumer({ workspaceId, projectId: projectId ?? undefined }, claim.targetId, consumer(id, row?.name ?? 'Deleted workflow'), true) }
      catch (error) { if (!(error instanceof Error) || error.message !== 'not-found') throw error }
      db.delete(workflowDependencies).where(eq(workflowDependencies.id, claim.id)).run()
    }
    if (!row) {
      const published = db.select().from(workflowRevisions).where(eq(workflowRevisions.definitionId, id)).orderBy(desc(workflowRevisions.revision)).get()
      for (const dependency of db.select().from(workflowDependencies).where(and(eq(workflowDependencies.consumerId, id), eq(workflowDependencies.kind, 'query'))).all()) {
        if (published) await writeConsumer({ workspaceId: published.workspaceId, projectId: published.projectId ?? undefined }, dependency.targetId,
          { kind: 'workflow', id, name: 'Deleted workflow', href: `/workflows/db:${id}` }, true)
      }
      db.delete(workflowDependencies).where(and(eq(workflowDependencies.consumerId, id), ne(workflowDependencies.kind, 'draft-query'))).run()
    }
  }
  return {
    async create(input: { workspaceId: string; projectId?: string; def: WorkflowDef }) {
      const id = randomUUID()
      return serial(id, async () => {
        await protect(id, { workspaceId: input.workspaceId, projectId: input.projectId }, input.def)
        const row = await createDef(db, { ...input, id })
        return row
      })
    },
    async update(id: string, def: WorkflowDef, revision: number) {
      return serial(id, async () => {
        const current = await getDef(db, id)
        if (!current) return null
        if (current.revision !== revision) return { conflict: current }
        await protect(id, scopeOf(current), def)
        const answer = await updateDef(db, id, def, revision)
        await reconcileOne(id)
        return answer
      })
    },
    async remove(id: string) {
      return serial(id, async () => {
        await removeDef(db, id)
        await reconcileOne(id)
      })
    },
    async reconcile(definitionId?: string) {
      const all = definitionId ? new Set([definitionId]) : new Set([
        ...db.select({ id: workflowDefs.id }).from(workflowDefs).all().map(row => row.id),
        ...db.select().from(workflowDependencies).all().map(row => row.consumerId),
      ])
      const errors: unknown[] = []
      for (const id of all) {
        try { await serial(id, () => reconcileOne(id)) } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Some draft query references need reconciliation')
    },
  }
}
