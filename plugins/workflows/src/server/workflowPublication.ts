import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { QueryPublicationRequest, QueryPublicationResult } from '@acorn/protocol/queryPublication.ts'
import type { QueryBindingContext, QueryConsumer, QueryReference, QueryScope } from '@acorn/protocol/dataQueries.ts'
import { resolveQueryParameters } from '@acorn/protocol/dataQueryResolution.ts'
import { workflowDependencies, workflowSchedules } from '../node/schema'
import type { WorkflowPublication, WorkflowPublicationSelection } from '../shared/workflowPublication'
import type { WorkflowDef } from '../shared/workflowContracts'
import { getDef } from './workflowDefs'
import { publicationStore, publishedWorkflow } from './workflowPublicationStore'
import { resolveScopedWorkflowDefinition, workflowContentFingerprint, type WorkflowResolutionScope } from './workflowResolution'
import { validateWorkflow, type WorkflowValidationCatalog } from './workflowValidation'

export type WorkflowPublicationServices = {
  query(request: QueryPublicationRequest): Promise<QueryPublicationResult>
  validateQuery(scope: QueryScope, reference: QueryReference, context: QueryBindingContext): Promise<void>
  queryConsumer(scope: QueryScope, queryId: string, consumer: Omit<QueryConsumer, 'pluginId'>, remove?: boolean): Promise<void>
  catalog: WorkflowValidationCatalog
  scope(workspaceId: string, projectId?: string): Promise<WorkflowResolutionScope>
}

/** Coordinates owning stores. Each call can be retried after losing its response. */
export function workflowPublication(db: PluginDatabase, services: WorkflowPublicationServices) {
  const store = publicationStore(db)
  return {
    get: store.get,
    list: store.list,
    async discard(id: string): Promise<void> {
      const operation = store.get(id)
      if (operation.landed.length) throw new Error('This publication has landed revisions. Resume it instead.')
      await services.query({ workspaceId: operation.workspaceId, action: 'abandon', operationId: id })
      store.discard(id)
    },
    async prepare(selection: WorkflowPublicationSelection): Promise<WorkflowPublication> {
      const root = await getDef(db, selection.id)
      if (!root) throw new Error('Workflow not found')
      if (root.revision !== selection.revision) throw new Error('Draft changed before publication review')
      const scope = await services.scope(root.workspaceId, root.projectId ?? undefined)
      const operation: WorkflowPublication = { id: randomUUID(), workspaceId: root.workspaceId, rootId: root.id, state: 'prepared', writes: [], reused: [], consumers: [], landed: [], error: null, createdAt: Date.now(), updatedAt: Date.now() }
      const visited = new Set<string>()
      const selected = { ...selection.workflows, [root.id]: root.revision }
      const inspectQuery = async (reference: QueryReference, owner: WorkflowDef, ownerScope: QueryScope, ownerId: string) => {
        const inputs = { ...Object.fromEntries((owner.inputs ?? []).filter(input => input.default !== undefined).map(input => [input.name, input.default!])), ...selection.validation?.[ownerId]?.inputs }
        const context = { inputs, steps: selection.validation?.[ownerId]?.steps }
        if (reference.kind === 'inline') { await services.validateQuery(ownerScope, reference, context); return }
        const key = `query:${reference.queryId}`
        if (visited.has(key)) return
        visited.add(key)
        store.assertAvailable('query', reference.queryId)
        const info = await services.query({ ...ownerScope, action: 'inspect', queryId: reference.queryId })
        if (!info.draft) throw new Error('Query draft not found')
        const review = selection.queries?.[reference.queryId]
        if (info.published && !review) {
          await services.validateQuery(ownerScope, reference, context)
          operation.reused.push({ kind: 'query', id: reference.queryId, revision: reference.revision ?? info.published.revision, scope: ownerScope, pinned: reference.revision !== undefined })
          return
        }
        const parameters = review?.parameters ?? resolveQueryParameters(info.draft.content, reference.bindings, context)
        const prepared = await services.query({ ...ownerScope, action: 'prepare', queryId: reference.queryId, expectedRevision: review?.revision ?? info.draft.draftRevision, parameters })
        if (!prepared.plan) throw new Error('Query publication could not be prepared')
        operation.writes.push({ kind: 'query', id: reference.queryId, name: prepared.plan.draft.content.name, scope: ownerScope, plan: prepared.plan })
        operation.consumers.push(...prepared.consumers ?? [])
      }
      const walk = async (id: string, chain: string[], depth: number): Promise<WorkflowDef> => {
        if (chain.includes(id)) throw new Error(`Workflow dependency cycle: ${[...chain, id].join(' → ')}`)
        if (depth > 4) throw new Error('Workflow nesting exceeds four child levels')
        store.assertAvailable('workflow', id)
        const draft = await getDef(db, id)
        if (!draft || draft.workspaceId !== root.workspaceId || (draft.projectId && draft.projectId !== scope.projectId)) throw new Error('Workflow dependency is outside this scope')
        const published = await publishedWorkflow(db, id)
        const useDraft = selected[id] !== undefined || !published
        if (selected[id] !== undefined && draft.revision !== selected[id]) throw new Error('Dependency changed before publication review')
        const def = useDraft ? draft.def : published!.def
        const problems = validateWorkflow(def, services.catalog)
        if (problems.length) throw new Error(problems.join('; '))
        if (visited.has(`workflow:${id}`)) return def
        const ownScope = { workspaceId: draft.workspaceId, projectId: draft.projectId ?? undefined }
        for (const step of def.steps) {
          if (step.query) await inspectQuery(step.query, def, ownScope, id)
          if (!step.childWorkflow) continue
          const ref = step.childWorkflow.ref
          const child = ref.source === 'database' ? await walk(ref.id, [...chain, id], depth + 1)
            : (await resolveScopedWorkflowDefinition(db, ref, scope, services.catalog)).definition
          const declared = new Set((child.inputs ?? []).map(input => input.name))
          for (const name of Object.keys(step.childWorkflow.inputs ?? {})) if (!declared.has(name)) throw new Error(`Undeclared child input: ${name}`)
          for (const input of child.inputs ?? []) if (input.required && input.default === undefined && !step.childWorkflow.inputs?.[input.name]) throw new Error(`Missing child input: ${input.name}`)
        }
        visited.add(`workflow:${id}`)
        if (!useDraft) { operation.reused.push({ kind: 'workflow', id, revision: published!.revision }); return def }
        const dependents = db.select().from(workflowDependencies).where(eq(workflowDependencies.targetId, id)).all()
        for (const dependent of dependents) {
          const consumer = await getDef(db, dependent.consumerId)
          if (consumer) operation.consumers.push({ pluginId: 'workflows', kind: 'workflow', id: consumer.id, name: consumer.name, href: `/workflows/db:${consumer.id}` })
        }
        operation.writes.push({ kind: 'workflow', id, name: def.name, draftRevision: draft.revision, basePublishedRevision: draft.publishedRevision ?? null,
          revision: (draft.publishedRevision ?? 0) + 1, scope: ownScope, def: structuredClone(def), digest: workflowContentFingerprint(def),
          previousQueryIds: (published?.def.steps ?? []).flatMap(step => step.query?.kind === 'saved' ? [step.query.queryId] : []) })
        return def
      }
      await walk(root.id, [], 0)
      // Metadata work may have yielded to another device's save. Recheck every reviewed draft.
      for (const write of operation.writes) if (write.kind === 'workflow' && (await getDef(db, write.id))?.revision !== write.draftRevision) throw new Error('Draft changed during publication review')
      return store.prepare(operation)
    },
    async publish(id: string): Promise<WorkflowPublication> {
      const operation = store.get(id)
      if (operation.state === 'complete') return operation
      try {
        if (operation.state === 'prepared') for (const write of operation.writes) {
          if (write.kind === 'workflow' && (await getDef(db, write.id))?.revision !== write.draftRevision) throw new Error('Draft changed after publication review')
        }
        for (const dependency of operation.reused) {
          const current = dependency.kind === 'workflow' ? (await publishedWorkflow(db, dependency.id))?.revision
            : dependency.pinned ? dependency.revision : (await services.query({ ...dependency.scope!, action: 'inspect', queryId: dependency.id })).published?.revision
          if (current !== dependency.revision) throw new Error('A reviewed dependency changed. Review the publication again.')
        }
        store.state(id, 'publishing')
        for (const write of operation.writes) if (write.kind === 'query') await services.query({ ...write.scope, action: 'hold', operationId: id, plan: write.plan })
        for (const write of operation.writes) {
          const revision = write.kind === 'workflow' ? store.write(id, write)
            : (await services.query({ ...write.scope, action: 'write', operationId: id, plan: write.plan })).published!.revision
          store.landed(id, { kind: write.kind, id: write.id, revision })
          if (write.kind === 'workflow') {
            const ids = new Set(write.def.steps.flatMap(step => step.query?.kind === 'saved' ? [step.query.queryId] : []))
            const consumer = { kind: 'workflow' as const, id: write.id, name: write.name, href: `/workflows/db:${write.id}` }
            for (const queryId of ids) await services.queryConsumer(write.scope, queryId, consumer)
            for (const queryId of write.previousQueryIds ?? []) if (!ids.has(queryId)) await services.queryConsumer(write.scope, queryId, consumer, true)
          }
        }
        // All writes exist before any held query becomes readable. Workflow admission remains held
        // until the final local checkpoint, including after an ambiguous release response.
        for (const scope of new Map(operation.writes.filter(write => write.kind === 'query').map(write => [JSON.stringify(write.scope), write.scope])).values()) {
          await services.query({ ...scope, action: 'release', operationId: id })
        }
        store.state(id, 'complete')
        const changedWorkflows = new Set(operation.writes.filter(write => write.kind === 'workflow').map(write => write.id))
        const changedQueries = new Set(operation.writes.filter(write => write.kind === 'query').map(write => write.id))
        for (const schedule of db.select().from(workflowSchedules).all()) {
          if (!schedule.approvedGraphJson || schedule.state === 'deleted') continue
          const graph = JSON.parse(schedule.approvedGraphJson) as import('../shared/workflowContracts').ResolvedWorkflowGraph
          const affectedWorkflow = graph.nodes.some(node => node.provenance.source === 'database' && changedWorkflows.has(node.provenance.id))
          const affectedQuery = graph.nodes.some(node => node.definition.steps.some(step => step.query?.kind === 'saved' && changedQueries.has(step.query.queryId)))
          if (!affectedWorkflow && !affectedQuery) continue
          db.update(workflowSchedules).set({
            state: 'needs-review',
            error: affectedQuery ? 'A published shared query changed. Review this schedule before it runs again.' : 'A published workflow dependency changed. Review this schedule before it runs again.',
            updatedAt: Date.now(),
          }).where(eq(workflowSchedules.id, schedule.id)).run()
        }
      } catch (error) {
        store.state(id, 'needs-reconciliation', error instanceof Error ? error.message : 'Publication interrupted')
      }
      return store.get(id)
    },
  }
}
