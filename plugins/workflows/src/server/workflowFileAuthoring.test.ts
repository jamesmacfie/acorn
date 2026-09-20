import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { resolveInRoot } from '@acorn/plugin-api/node'
import { resolveQueryContent, resolveQueryParameters } from '@acorn/protocol/dataQueryResolution.ts'
import type { QueryContent } from '@acorn/protocol/dataQueries.ts'
import type { WorkflowDef } from '../shared/workflowContracts'
import { createPublishedDef, publishFixtureDef } from '../testkit/publishedDefinition'
import { createDef, getDef, updateDef } from './workflowDefs'
import { workflowFileAuthoring } from './workflowFileAuthoring'
import { loadWorkflowFiles, parseWorkflowToml } from './workflowFiles'
import { writeWorkflowToml } from './workflowToml'
import { resolveWorkflowGraph, resolveScopedWorkflowDefinition } from './workflowResolution'
import { validateWorkflowDestination } from './workflowDestination'
import type { WorkflowValidationCatalog } from './workflowValidation'

const catalog: WorkflowValidationCatalog = { stepKinds: new Set(['agent', 'workflow', 'find-records']), policies: new Set(), profiles: new Set(['claude-code']), structuredProfiles: new Set(['claude-code']) }
const def = (name = 'Example'): WorkflowDef => ({ formatVersion: 2, name, steps: [{ id: 'one', name: 'One', kind: 'agent', prompt: 'Work' }] })
const target = { projectId: 'project', source: 'repo' as const, path: '.acorn/workflows/example.toml' }
const query: QueryContent = { name: 'Selected records', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {}, query: {
  source: { pluginId: 'linear', sourceId: 'issues' }, scope: { workspaceId: 'origin-workspace', projectId: 'project', connectionId: 'private-connection-id', parameters: { projectId: 'provider-project-id', stateId: 'provider-state-id' } }, sort: [],
} }

describe('file drafts and portable export', () => {
  let db: TestPluginDb
  let root: string
  let failAfter: number
  let writes: number
  const service = () => workflowFileAuthoring(db.db, {
    catalog, scope: async () => ({ root, workspaceId: 'origin-workspace', resolveInRoot }),
    query: async (_scope, _id, revision) => ({ ...query, name: revision === 2 ? 'Selected revision' : query.name }),
    afterWrite: () => { writes++; if (writes === failAfter) throw new Error('Process interrupted') },
  })
  const write = (value: WorkflowDef) => { mkdirSync(join(root, '.acorn/workflows'), { recursive: true }); writeFileSync(join(root, target.path), writeWorkflowToml(value)) }
  beforeEach(() => { db = makeTestPluginDb('workflows'); root = mkdtempSync(join(tmpdir(), 'acorn-file-authoring-')); failAfter = -1; writes = 0 })
  afterEach(() => { db.cleanup(); rmSync(root, { recursive: true, force: true }) })

  it('recovers a draft across service restart and merges external changes by stable step ID', async () => {
    write(def())
    const opened = (await service()({ action: 'open', target })).draft!
    const local = def('Local name')
    const saved = (await service()({ action: 'save', target, revision: opened.revision, def: local })).draft!
    const external = def(); external.steps[0]!.prompt = 'External prompt'; write(external)
    expect((await service()({ action: 'open', target })).draft!.def.name).toBe('Local name')
    const review = await service()({ action: 'review', target, revision: saved.revision })
    expect(review.draft!.def).toMatchObject({ name: 'Local name', steps: [{ prompt: 'External prompt' }] })
    const published = await service()({ action: 'publish', id: review.operation!.id })
    expect(published.operation!.state).toBe('complete')
    expect(readFileSync(join(root, target.path), 'utf8')).toContain('Local name')
    expect((await service()({ action: 'open', target })).draft!.baseText).toContain('External prompt')
  })

  it('requires explicit same-field conflict choices and refuses stale draft saves', async () => {
    write(def()); const opened = (await service()({ action: 'open', target })).draft!
    const saved = (await service()({ action: 'save', target, revision: opened.revision, def: def('Mine') })).draft!
    await expect(service()({ action: 'save', target, revision: opened.revision, def: def('Lost') })).rejects.toThrow('another device')
    write(def('Theirs'))
    const review = await service()({ action: 'review', target, revision: saved.revision })
    expect(review.conflicts).toMatchObject([{ path: '/name', local: 'Mine', external: 'Theirs' }])
    expect(review.operation).toBeUndefined()
    expect((await service()({ action: 'review', target, revision: saved.revision, externalHash: review.externalHash, choices: { '/name': 'external' } })).draft!.def.name).toBe('Theirs')
  })

  it('refuses deletion and an edit after review without overwriting either', async () => {
    write(def()); const opened = (await service()({ action: 'open', target })).draft!
    unlinkSync(join(root, target.path))
    await expect(service()({ action: 'review', target, revision: opened.revision })).rejects.toThrow('deleted')
    write(def()); const review = await service()({ action: 'review', target, revision: opened.revision })
    write(def('Changed after review'))
    expect((await service()({ action: 'publish', id: review.operation!.id })).operation).toMatchObject({ state: 'needs-reconciliation', writes: [{ landed: false }] })
    expect(readFileSync(join(root, target.path), 'utf8')).toContain('Changed after review')
  })

  it('pins same-layer file dependencies during review and refuses a later external edit', async () => {
    mkdirSync(join(root, '.acorn/workflows'), { recursive: true })
    writeFileSync(join(root, '.acorn/workflows/child.toml'), writeWorkflowToml(def('Child')))
    const parent = def('Parent')
    parent.steps = [{ id: 'child', name: 'Child', kind: 'workflow', childWorkflow: { ref: { source: 'repo', path: '.acorn/workflows/child.toml' } } }]
    write(parent)
    const opened = (await service()({ action: 'open', target })).draft!
    const review = (await service()({ action: 'review', target, revision: opened.revision })).operation!
    expect(review.reused).toEqual([{ path: '.acorn/workflows/child.toml', hash: expect.any(String) }])

    writeFileSync(join(root, '.acorn/workflows/child.toml'), writeWorkflowToml(def('Changed child')))
    const result = (await service()({ action: 'publish', id: review.id })).operation!
    expect(result).toMatchObject({ state: 'needs-reconciliation', writes: [{ landed: false }] })
    expect(readFileSync(join(root, target.path), 'utf8')).toContain('Parent')
  })

  it('refuses path traversal, symlink escape, and unreadable TOML without an empty draft', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'acorn-outside-'))
    try {
      symlinkSync(outside, join(root, '.acorn'))
      await expect(service()({ action: 'open', target })).rejects.toThrow('outside')
      expect(loadWorkflowFiles(root, null, catalog).workflows).toEqual([])
    } finally { rmSync(outside, { recursive: true, force: true }); unlinkSync(join(root, '.acorn')) }
    await expect(service()({ action: 'open', target: { ...target, path: '../escape.toml' } })).rejects.toThrow('inside')
    write(def()); writeFileSync(join(root, target.path), 'bad = [')
    await expect(service()({ action: 'open', target })).rejects.toThrow('text editor')
  })

  it('round-trips nested typed values and constrained connection inputs through TOML', () => {
    const value = def(); value.inputs = [{ name: 'payload', schema: { type: 'object' }, default: { items: [1, true, null, { nested: 'value' }] } }, { name: 'connection', schema: { type: 'string' }, required: true, connection: { source: query.query.source } }]
    value.steps[0]!.query = { kind: 'inline', content: query, bindings: {} }
    const parsed = parseWorkflowToml(writeWorkflowToml(value), 'example', 'repo', [])!
    expect(parsed.inputs).toEqual(value.inputs)
    expect(parsed.steps[0]!.query).toEqual(value.steps[0]!.query)
  })

  it.each([1, 2])('resumes after write %i, inlines published queries, rewrites children, and preserves originals', async stop => {
    const childDef = def('Child'); childDef.steps = [{ id: 'find', name: 'Find', kind: 'find-records', query: { kind: 'saved', queryId: 'opaque-query-id', revision: 2, bindings: {} } }]
    const child = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: childDef })
    const parentDef = def('Parent'); parentDef.steps = [{ id: 'child', name: 'Child', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: child.id } } }]
    const parent = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: parentDef })
    await updateDef(db.db, child.id, def('Unpublished edit'), 1)
    const review = (await service()({ action: 'export', projectId: 'project', id: parent.id })).operation!
    expect(review.writes.map(write => write.path)).toEqual(['.acorn/workflows/child.toml', '.acorn/workflows/parent.toml'])
    const text = review.writes.map(write => write.text).join('\n')
    for (const secret of ['opaque-query-id', 'private-connection-id', 'origin-workspace', child.id, 'Unpublished edit']) expect(text).not.toContain(secret)
    expect(text).toContain('Selected revision')
    expect(text).toContain('provider-project-id')
    expect(review.setup.join()).toContain('provider-state-id')
    failAfter = stop
    expect((await service()({ action: 'publish', id: review.id })).operation!.state).toBe('needs-reconciliation')
    await expect(resolveScopedWorkflowDefinition(db.db, { source: 'repo', path: review.rootPath }, { workspaceId: 'origin-workspace', projectId: 'project', repoDir: root, userDir: null }, catalog)).rejects.toThrow('Resume file publication')
    failAfter = -1
    const completed = (await service()({ action: 'publish', id: review.id })).operation!
    expect(completed.state).toBe('complete')
    expect(completed.writes.every(write => write.landed)).toBe(true)
    expect(await getDef(db.db, child.id)).not.toBeNull()
    expect(await getDef(db.db, parent.id)).not.toBeNull()
    const loaded = loadWorkflowFiles(root, null, catalog)
    expect(loaded.errors).toEqual([])
    const graph = await resolveWorkflowGraph(db.db, loaded.workflows.find(file => file.id === 'parent')!, { scope: { workspaceId: 'destination', projectId: 'destination-project', repoDir: root, userDir: null }, catalog, inputs: { connection_1: 'destination-connection' } })
    await validateWorkflowDestination(graph, { workspaceId: 'destination', projectId: 'destination-project' }, async (reference, inputs) => {
      if (reference.kind !== 'inline') throw new Error('Not portable')
      const resolved = resolveQueryContent(reference.content, resolveQueryParameters(reference.content, reference.bindings, { inputs }))
      expect(resolved.scope).toMatchObject({ workspaceId: 'destination', projectId: 'destination-project', connectionId: 'destination-connection', parameters: { projectId: 'provider-project-id' } })
    })
    await expect(validateWorkflowDestination(graph, { workspaceId: 'destination' }, async () => { throw new Error('Provider state unavailable') })).rejects.toThrow('Provider state unavailable')
  })

  it('adds only the connection inputs each exported child subtree needs', async () => {
    const queried = (name: string, connectionId: string): WorkflowDef => {
      const value = def(name)
      value.steps = [{ id: 'find', name: 'Find', kind: 'find-records', query: {
        kind: 'inline', bindings: {}, content: { ...structuredClone(query), query: { ...structuredClone(query.query), scope: { ...structuredClone(query.query.scope), connectionId } } },
      } }]
      return value
    }
    const first = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: queried('First child', 'first-private-connection') })
    const second = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: queried('Second child', 'second-private-connection') })
    const parent = def('Parent')
    parent.steps = [
      { id: 'first', name: 'First', kind: 'workflow', after: [], childWorkflow: { ref: { source: 'database', id: first.id } } },
      { id: 'second', name: 'Second', kind: 'workflow', after: [], childWorkflow: { ref: { source: 'database', id: second.id } } },
    ]
    const row = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: parent })

    const operation = (await service()({ action: 'export', projectId: 'project', id: row.id })).operation!
    const parsed = operation.writes.map(write => parseWorkflowToml(write.text, write.path, 'repo', [])!)
    expect(parsed.find(item => item.name === 'Parent')?.inputs?.map(input => input.name)).toEqual(['connection_1', 'connection_2'])
    expect(parsed.find(item => item.name === 'First child')?.inputs?.map(input => input.name)).toEqual(['connection_1'])
    expect(parsed.find(item => item.name === 'Second child')?.inputs?.map(input => input.name)).toEqual(['connection_2'])
    expect(operation.writes.map(write => write.text).join('\n')).not.toMatch(/first-private-connection|second-private-connection/)
  })

  it('refuses unpublished exports and existing paths', async () => {
    const draft = await createDef(db.db, { workspaceId: 'origin-workspace', def: def() })
    await expect(service()({ action: 'export', projectId: 'project', id: draft.id })).rejects.toThrow('could not be resolved')
    const published = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: def() }); write(def())
    await expect(service()({ action: 'export', projectId: 'project', id: published.id })).rejects.toThrow('already exists')
  })

  it('refuses to reuse a repository dependency with a Node-local connection', async () => {
    const dependency = def('Dependency')
    const content = structuredClone(query)
    content.query.scope = { parameters: content.query.scope.parameters }
    content.connection = { address: { from: 'literal', value: 'private-connection-id' } }
    dependency.steps = [{ id: 'find', name: 'Find', kind: 'find-records', query: { kind: 'inline', content, bindings: {} } }]
    mkdirSync(join(root, '.acorn/workflows'), { recursive: true })
    writeFileSync(join(root, '.acorn/workflows/dependency.toml'), writeWorkflowToml(dependency))
    const parent = def('Parent')
    parent.steps = [{ id: 'child', name: 'Child', kind: 'workflow', childWorkflow: { ref: { source: 'repo', path: '.acorn/workflows/dependency.toml' } } }]
    const row = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: parent })
    await expect(service()({ action: 'export', projectId: 'project', id: row.id })).rejects.toThrow('Node-local connection')
  })

  it('refuses cycles and unresolved repository dependencies before writing', async () => {
    const row = await createDef(db.db, { workspaceId: 'origin-workspace', def: def('Cycle') })
    const cyclic = def('Cycle'); cyclic.steps = [{ id: 'self', name: 'Self', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: row.id } } }]
    await updateDef(db.db, row.id, cyclic, 1); await publishFixtureDef(db.db, row.id)
    await expect(service()({ action: 'export', projectId: 'project', id: row.id })).rejects.toThrow('cyclic')
    cyclic.steps[0]!.childWorkflow!.ref = { source: 'repo', path: '.acorn/workflows/missing.toml' }
    await updateDef(db.db, row.id, cyclic, 2); await publishFixtureDef(db.db, row.id)
    await expect(service()({ action: 'export', projectId: 'project', id: row.id })).rejects.toThrow('could not be resolved')
  })

  it('retains a partial export when an external edit changes its written file', async () => {
    const child = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: def('Child') })
    const parent = def('Parent'); parent.steps = [{ id: 'child', name: 'Child', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: child.id } } }]
    const row = await createPublishedDef(db.db, { workspaceId: 'origin-workspace', def: parent })
    const plan = (await service()({ action: 'export', projectId: 'project', id: row.id })).operation!
    failAfter = 1
    await service()({ action: 'publish', id: plan.id })
    writeFileSync(join(root, plan.writes[0]!.path), 'External change')
    failAfter = -1
    const resumed = (await service()({ action: 'publish', id: plan.id })).operation!
    expect(resumed.state).toBe('needs-reconciliation')
    expect(readFileSync(join(root, plan.writes[0]!.path), 'utf8')).toBe('External change')
    expect((await service()({ action: 'list', projectId: 'project' })).operations).toHaveLength(1)
  })

  it('blocks a global user-file workflow in every project while its publication is incomplete', async () => {
    const userTarget = { projectId: 'project', source: 'user' as const, path: target.path }
    write(def())
    const opened = (await service()({ action: 'open', target: userTarget })).draft!
    const review = (await service()({ action: 'review', target: userTarget, revision: opened.revision })).operation!
    await expect(resolveScopedWorkflowDefinition(db.db, { source: 'user', id: 'example' }, {
      workspaceId: 'origin-workspace', projectId: 'another-project', repoDir: null, userDir: root,
    }, catalog)).rejects.toThrow(`Resume file publication ${review.id}`)
  })
})
