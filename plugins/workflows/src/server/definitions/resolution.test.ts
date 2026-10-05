import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { getDef, updateDef } from './store'
import { createPublishedDef as createDef, publishFixtureDef } from '../../testkit/publishedDefinition'
import {
  resolveScopedWorkflowDefinition,
  resolveWorkflowGraph,
  workflowContentFingerprint,
  type WorkflowResolutionScope,
} from './resolution'
import type { WorkflowValidationCatalog } from '../validation/definition'

const catalog: WorkflowValidationCatalog = {
  stepKinds: new Set(['agent']),
  policies: new Set(),
  profiles: new Set(['claude-code']),
  structuredProfiles: new Set(['claude-code']),
}

const leaf = (name = 'child', inputs?: WorkflowDef['inputs']): WorkflowDef => ({
  baseline: 'acorn-1' as const,
  formatVersion: 1 as const,
  name,
  inputs,
  steps: [{ id: 'work', name: 'work', prompt: 'Do it.' }],
})

describe('scoped workflow resolution', () => {
  let store: TestPluginDb
  let dir: string
  let repoDir: string
  let userDir: string
  let scope: WorkflowResolutionScope

  const writeWorkflow = (base: string, id: string, text: string) => {
    const folder = join(base, '.acorn', 'workflows')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${id}.toml`), text)
  }

  beforeEach(() => {
    store = makeTestPluginDb('workflows')
    dir = mkdtempSync(join(tmpdir(), 'acorn-workflow-resolution-'))
    repoDir = join(dir, 'repo')
    userDir = join(dir, 'user')
    mkdirSync(repoDir)
    mkdirSync(userDir)
    scope = { workspaceId: 'workspace-1', projectId: 'project-1', repoDir, userDir }
  })

  afterEach(() => {
    store.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('freezes child defaults and source provenance into one stable graph fingerprint', async () => {
    const child = await createDef(store.db, {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      def: leaf('Review', [
        { name: 'ticket', schema: { type: 'string' }, required: true },
        { name: 'focus', schema: { type: 'string' }, default: 'tests' },
      ]),
    })
    const root: WorkflowDef = {
      baseline: 'acorn-1' as const,
      formatVersion: 1 as const,
      name: 'Parent',
      inputs: [{ name: 'ticket', schema: { type: 'string' }, required: true }],
      steps: [{
        id: 'review',
        name: 'review',
        kind: 'workflow',
        childWorkflow: {
          ref: { source: 'database', id: child.id },
          inputs: { ticket: { address: { from: 'input', name: 'ticket', pointer: '' } } },
        },
      }],
    }

    const first = await resolveWorkflowGraph(store.db, root, { scope, catalog, inputs: { ticket: 'ACORN-42' } })
    const second = await resolveWorkflowGraph(store.db, root, { scope, catalog, inputs: { ticket: 'ACORN-42' } })

    expect(first).toEqual(second)
    expect(first.root.inputs?.[0].default).toBe('ACORN-42')
    expect(first.nodes).toHaveLength(2)
    expect(first.nodes[1]).toMatchObject({
      path: ['$', 'review'],
      depth: 1,
      provenance: { source: 'database', id: child.id, revision: 1 },
      defaultInputs: { focus: 'tests' },
    })
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(first.requiresRepoTrust).toBe(false)
  })

  it('resolves repository and user sources without accepting traversal', async () => {
    writeWorkflow(repoDir, 'review', 'format_version = 1\nbaseline = "acorn-1"\nname = "Repo review"\n[[steps]]\nid = "work"\nname = "work"\nprompt = "Review."\n')
    writeWorkflow(userDir, 'personal', 'format_version = 1\nbaseline = "acorn-1"\nname = "Personal"\n[[steps]]\nid = "work"\nname = "work"\nprompt = "Review."\n')

    await expect(resolveScopedWorkflowDefinition(
      store.db,
      { source: 'repo', path: '.acorn/workflows/review.toml' },
      scope,
      catalog,
    )).resolves.toMatchObject({ provenance: { source: 'repo', path: '.acorn/workflows/review.toml' } })
    await expect(resolveScopedWorkflowDefinition(
      store.db,
      { source: 'user', id: 'personal' },
      scope,
      catalog,
    )).resolves.toMatchObject({ provenance: { source: 'user', id: 'personal' } })
    await expect(resolveScopedWorkflowDefinition(
      store.db,
      { source: 'repo', path: '../review.toml' },
      scope,
      catalog,
    )).rejects.toThrow('could not be resolved')
  })

  it('refuses missing and out-of-scope database definitions', async () => {
    const otherProject = await createDef(store.db, {
      workspaceId: scope.workspaceId,
      projectId: 'project-2',
      def: leaf(),
    })
    const otherWorkspace = await createDef(store.db, { workspaceId: 'workspace-2', def: leaf() })

    for (const id of ['missing', otherProject.id, otherWorkspace.id]) {
      await expect(resolveScopedWorkflowDefinition(store.db, { source: 'database', id }, scope, catalog))
        .rejects.toThrow('could not be resolved')
    }
  })

  it('refuses child cycles and definitions deeper than four child levels', async () => {
    const first = await createDef(store.db, { workspaceId: scope.workspaceId, def: leaf('first') })
    const second = await createDef(store.db, { workspaceId: scope.workspaceId, def: leaf('second') })
    const dispatch = (name: string, id: string): WorkflowDef => ({
      baseline: 'acorn-1' as const,
      formatVersion: 1 as const,
      name,
      steps: [{ id: 'next', name: 'next', kind: 'workflow', childWorkflow: { ref: { source: 'database', id } } }],
    })
    await updateDef(store.db, first.id, dispatch('first', second.id), 1)
    await updateDef(store.db, second.id, dispatch('second', first.id), 1)
    await publishFixtureDef(store.db, first.id)
    await publishFixtureDef(store.db, second.id)

    const firstAfterUpdate = await getDef(store.db, first.id)
    await expect(resolveWorkflowGraph(store.db, firstAfterUpdate!.def, {
      scope,
      catalog,
      provenance: { source: 'database', id: first.id, revision: firstAfterUpdate!.revision },
    }))
      .rejects.toThrow('child workflow cycle')

    const leafRow = await createDef(store.db, { workspaceId: scope.workspaceId, def: leaf('leaf') })
    let nested = leafRow
    for (let depth = 1; depth <= 3; depth++) nested = await createDef(store.db, { workspaceId: scope.workspaceId, def: dispatch(`nested-${depth}`, nested.id) })
    const graph = await resolveWorkflowGraph(store.db, dispatch('root', nested.id), { scope, catalog })
    expect(graph.nodes.map(node => node.depth)).toEqual([0, 1, 2, 3, 4])
    nested = await createDef(store.db, { workspaceId: scope.workspaceId, def: dispatch('too-deep', nested.id) })
    await expect(resolveWorkflowGraph(store.db, dispatch('root', nested.id), { scope, catalog }))
      .rejects.toThrow('depth exceeds the 4-level limit')
  })

  it('refuses undeclared and missing required child inputs before dispatch is available', async () => {
    const child = await createDef(store.db, {
      workspaceId: scope.workspaceId,
      def: leaf('child', [{ name: 'ticket', schema: { type: 'string' }, required: true }]),
    })
    const root = (inputs: NonNullable<WorkflowDef['steps'][number]['childWorkflow']>['inputs']): WorkflowDef => ({
      baseline: 'acorn-1' as const,
      formatVersion: 1 as const,
      name: 'root',
      steps: [{ id: 'child', name: 'child', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: child.id }, inputs } }],
    })

    await expect(resolveWorkflowGraph(store.db, root({ extra: { address: { from: 'literal', value: 'x' } } }), { scope, catalog }))
      .rejects.toThrow("binds undeclared child input 'extra'")
    await expect(resolveWorkflowGraph(store.db, root({}), { scope, catalog }))
      .rejects.toThrow("needs a binding for child input 'ticket'")
    await expect(resolveWorkflowGraph(
      store.db,
      root({ ticket: { address: { from: 'literal', value: 'ACORN-42' } } }),
      { scope, catalog, allowDatabaseDefinitions: false },
    )).rejects.toThrow('task-confined caller')
    expect(await getDef(store.db, child.id)).not.toBeNull()
  })

  it('fingerprints object keys independently of insertion order', () => {
    expect(workflowContentFingerprint({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(workflowContentFingerprint({ b: { d: 3, c: 2 }, a: 1 }))
  })

  it('keeps persisted bytes when undefined object fields are omitted and arrays stay ordered', () => {
    const value = { z: { omitted: undefined, b: 2 }, a: [2, 1] }
    expect(workflowContentFingerprint(value)).toBe('3b5cc773ff0224d8008a6fa1f3489d79e5e798615c5cc8309d587bdda8667f3e')
    expect(workflowContentFingerprint({ a: [1, 2], z: { b: 2 } }))
      .toBe('28e8b268b5dd568b3eaf446e54a6b8db3401e5f47ff4ad4cb78c0b8848d26444')
  })
})
