import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as schema from '../node/schema'
import type { WorkflowDef } from '../shared/workflowContracts'
import { createDef, getDef, updateDef } from './workflowDefs'
import { workflowPublication, type WorkflowPublicationServices } from './workflowPublication'
import { publishedWorkflow } from './workflowPublicationStore'
import { resolveScopedWorkflowDefinition, resolveWorkflowGraph } from './workflowResolution'
import type { QueryDraft, QueryRevision } from '@acorn/protocol/dataQueries.ts'

const catalog = { stepKinds: new Set(['agent']), policies: new Set<string>(), profiles: new Set(['claude-code']), structuredProfiles: new Set(['claude-code']) }
const scope = { workspaceId: 'workspace', projectId: 'project', repoDir: null, userDir: null }
const leaf = (name = 'Child'): WorkflowDef => ({ formatVersion: 2, name, steps: [{ id: 'work', name: 'Work', prompt: 'Do work.' }] })
describe('workflow publication', () => {
  let db: TestPluginDb
  let services: WorkflowPublicationServices
  beforeEach(() => {
    db = makeTestPluginDb('workflows')
    services = { catalog, scope: async () => scope, query: async () => ({}), validateQuery: async () => {}, queryConsumer: async () => {} }
  })
  afterEach(() => db.cleanup())
  const draft = (def: WorkflowDef) => createDef(db.db, { workspaceId: scope.workspaceId, projectId: scope.projectId, def })
  it('keeps unfinished drafts non-executable and admits only immutable publications', async () => {
    const row = await draft(leaf())
    const publication = workflowPublication(db.db, services)
    expect(await publishedWorkflow(db.db, row.id)).toBeNull()
    await expect(resolveScopedWorkflowDefinition(db.db, { source: 'database', id: row.id }, scope, catalog)).rejects.toThrow()
    const operation = await publication.prepare({ id: row.id, revision: 1 })
    await expect(publishedWorkflow(db.db, row.id)).rejects.toThrow('reconciliation')
    expect((await publication.publish(operation.id)).state).toBe('complete')
    await updateDef(db.db, row.id, { ...leaf(), name: 'Unfinished', steps: [] }, 1)
    expect((await publishedWorkflow(db.db, row.id))?.def.name).toBe('Child')
    expect((await getDef(db.db, row.id))?.def.steps).toEqual([])
    expect(await publication.publish(operation.id)).toEqual(publication.get(operation.id))
  })
  it('publishes unpublished dependencies first, without adopting unrelated dependency edits', async () => {
    const child = await draft(leaf())
    const parent = await draft({ formatVersion: 2, name: 'Parent', steps: [{ id: 'call', name: 'Call', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: child.id } } }] })
    const publication = workflowPublication(db.db, services)
    const operation = await publication.prepare({ id: parent.id, revision: 1 })
    expect(operation.writes.map(write => write.id)).toEqual([child.id, parent.id])
    expect((await publication.publish(operation.id)).state).toBe('complete')
    await updateDef(db.db, child.id, { ...leaf(), name: 'Unrelated edit' }, 1)
    const next = await publication.prepare({ id: parent.id, revision: 1 })
    expect(next.writes.map(write => write.id)).toEqual([parent.id])
    expect(next.reused).toContainEqual({ kind: 'workflow', id: child.id, revision: 1 })
    await publication.discard(next.id)
    expect((await publishedWorkflow(db.db, child.id))?.def.name).toBe('Child')
  })
  it('rejects concurrent saves and changed reviewed drafts before writing', async () => {
    const row = await draft(leaf())
    const publication = workflowPublication(db.db, services)
    const operation = await publication.prepare({ id: row.id, revision: 1 })
    const saves = await Promise.all([updateDef(db.db, row.id, leaf('First'), 1), updateDef(db.db, row.id, leaf('Second'), 1)])
    expect(saves.filter(result => result && 'row' in result)).toHaveLength(1)
    expect(saves.filter(result => result && 'conflict' in result)).toHaveLength(1)
    expect((await publication.publish(operation.id)).state).toBe('needs-reconciliation')
    await publication.discard(operation.id)
    expect(await publishedWorkflow(db.db, row.id)).toBeNull()
  })
  it('detects draft cycles and preserves unrelated published workflows during interruption', async () => {
    const one = await draft(leaf('One'))
    const two = await draft(leaf('Two'))
    const call = (id: string): WorkflowDef => ({ formatVersion: 2, name: 'Call', steps: [{ id: 'call', name: 'Call', kind: 'workflow', childWorkflow: { ref: { source: 'database', id } } }] })
    await updateDef(db.db, one.id, call(two.id), 1)
    await updateDef(db.db, two.id, call(one.id), 1)
    await expect(workflowPublication(db.db, services).prepare({ id: one.id, revision: 2 })).rejects.toThrow('cycle')
    const unrelated = await draft(leaf('Unaffected'))
    const publication = workflowPublication(db.db, services)
    await publication.publish((await publication.prepare({ id: unrelated.id, revision: 1 })).id)
    const pending = await draft(leaf('Pending'))
    await publication.prepare({ id: pending.id, revision: 1 })
    expect((await resolveScopedWorkflowDefinition(db.db, { source: 'database', id: unrelated.id }, scope, catalog)).definition.name).toBe('Unaffected')
  })
  it('pins saved query revisions once at run admission', async () => {
    const def: WorkflowDef = { formatVersion: 2, name: 'Query', steps: [{ id: 'find', name: 'Find', kind: 'find-records', query: { kind: 'saved', queryId: 'query', bindings: {} } }] }
    const graph = await resolveWorkflowGraph(db.db, def, { scope, catalog: { ...catalog, stepKinds: new Set(['find-records']) }, queryRevision: async () => 3 })
    expect(graph.root.steps[0]?.query).toMatchObject({ revision: 3 })
  })
  it('moves schedules using a republished workflow to review without replacing their approved snapshot', async () => {
    const row = await draft(leaf())
    const publication = workflowPublication(db.db, services)
    await publication.publish((await publication.prepare({ id: row.id, revision: 1 })).id)
    const published = (await publishedWorkflow(db.db, row.id))!
    const graph = await resolveWorkflowGraph(db.db, published.def, {
      scope,
      catalog,
      provenance: { source: 'database', id: row.id, revision: published.revision },
    })
    db.db.insert(schema.workflowSchedules).values({
      id: 'schedule', workspaceId: scope.workspaceId, projectId: scope.projectId, workflowId: row.id,
      inputsJson: '{}', timezone: 'UTC', limitsJson: '{}', approvedGraphJson: JSON.stringify(graph),
      approvedGraphDigest: graph.fingerprint, epoch: 'history', state: 'active', createdAt: 1, updatedAt: 1,
    }).run()

    await updateDef(db.db, row.id, leaf('Changed'), 1)
    expect((await publication.publish((await publication.prepare({ id: row.id, revision: 2 })).id)).state).toBe('complete')
    const schedule = db.db.select().from(schema.workflowSchedules).where(eq(schema.workflowSchedules.id, 'schedule')).get()!
    expect(schedule).toMatchObject({ state: 'needs-review', epoch: 'history' })
    expect(schedule.approvedGraphJson).toBe(JSON.stringify(graph))
    expect(schedule.error).toMatch(/workflow dependency changed/i)
  })
  it.each(['hold', 'write', 'consumer', 'release'])('resumes after an ambiguous %s without creating another revision', async failAt => {
    const query: QueryDraft = { id: 'query', ...scope, draftRevision: 1, basePublishedRevision: null, publishedRevision: null, createdAt: 1, updatedAt: 1,
      content: { name: 'Query', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
        query: { source: { pluginId: 'fixture', sourceId: 'items' }, scope: { workspaceId: scope.workspaceId, projectId: scope.projectId, parameters: {} }, sort: [] } } }
    let written: QueryRevision | undefined
    let failed = false
    const interrupt = (point: string) => { if (!failed && failAt === point) { failed = true; throw new Error('Response lost') } }
    services.query = async request => {
      if (request.action === 'inspect') return { draft: query, published: written }
      if (request.action === 'prepare') return { plan: { draft: query, intendedRevision: 1, sourceRevision: 'source' } }
      if (request.action === 'write') written ??= { ...scope, queryId: query.id, revision: 1, content: query.content, digest: 'digest', sourceRevision: 'source', createdAt: 1 }
      interrupt(request.action)
      return { published: written }
    }
    services.queryConsumer = async () => { interrupt('consumer') }
    const row = await draft({ formatVersion: 2, name: 'Consumer', steps: [{ id: 'find', name: 'Find', kind: 'find-records', query: { kind: 'saved', queryId: query.id, bindings: {} } }] })
    services.catalog = { ...catalog, stepKinds: new Set(['find-records']) }
    const publication = workflowPublication(db.db, services)
    const operation = await publication.prepare({ id: row.id, revision: 1 })
    expect((await publication.publish(operation.id)).state).toBe('needs-reconciliation')
    await expect(publishedWorkflow(db.db, row.id)).rejects.toThrow('reconciliation')
    const restarted = workflowPublication(db.db, services)
    const complete = await restarted.publish(operation.id)
    expect(complete.state).toBe('complete')
    expect(complete.landed).toEqual([{ kind: 'query', id: query.id, revision: 1 }, { kind: 'workflow', id: row.id, revision: 1 }])
    expect((await restarted.publish(operation.id)).landed).toEqual(complete.landed)
  })
})
