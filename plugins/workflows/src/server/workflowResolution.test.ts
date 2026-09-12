import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { WorkflowDef } from '../shared/workflowContracts'
import { createDef, getDef, updateDef } from './workflowDefs'
import {
  assertRuntimeWorkflowDispatchUnavailable,
  resolveScopedWorkflowDefinition,
  resolveWorkflowGraph,
  workflowContentFingerprint,
  type WorkflowResolutionScope,
} from './workflowResolution'
import type { WorkflowValidationCatalog } from './workflowValidation'

const catalog: WorkflowValidationCatalog = {
  stepKinds: new Set(['agent']),
  policies: new Set(),
  profiles: new Set(['claude-code']),
  structuredProfiles: new Set(['claude-code']),
}

const leaf = (name = 'child', inputs?: WorkflowDef['inputs']): WorkflowDef => ({
  name,
  inputs,
  steps: [{ name: 'work', prompt: 'Do it.' }],
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
      def: leaf('Review', [{ name: 'ticket', required: true }, { name: 'focus', default: 'tests' }]),
    })
    const root: WorkflowDef = {
      name: 'Parent',
      inputs: [{ name: 'ticket', required: true }],
      steps: [{
        name: 'review',
        kind: 'workflow',
        childWorkflow: {
          ref: { source: 'database', id: child.id },
          inputs: { ticket: { from: 'input', name: 'ticket' } },
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
    writeWorkflow(repoDir, 'review', 'name = "Repo review"\n[[steps]]\nname = "work"\nprompt = "Review."\n')
    writeWorkflow(userDir, 'personal', 'name = "Personal"\n[[steps]]\nname = "work"\nprompt = "Review."\n')

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

  it('refuses child cycles and definitions deeper than one child level', async () => {
    const first = await createDef(store.db, { workspaceId: scope.workspaceId, def: leaf('first') })
    const second = await createDef(store.db, { workspaceId: scope.workspaceId, def: leaf('second') })
    const dispatch = (name: string, id: string): WorkflowDef => ({
      name,
      steps: [{ name: 'next', kind: 'workflow', childWorkflow: { ref: { source: 'database', id } } }],
    })
    await updateDef(store.db, first.id, dispatch('first', second.id), 1)
    await updateDef(store.db, second.id, dispatch('second', first.id), 1)

    const firstAfterUpdate = await getDef(store.db, first.id)
    await expect(resolveWorkflowGraph(store.db, firstAfterUpdate!.def, {
      scope,
      catalog,
      provenance: { source: 'database', id: first.id, revision: firstAfterUpdate!.revision },
    }))
      .rejects.toThrow('child workflow cycle')

    const leafRow = await createDef(store.db, { workspaceId: scope.workspaceId, def: leaf('leaf') })
    const nested = await createDef(store.db, { workspaceId: scope.workspaceId, def: dispatch('nested', leafRow.id) })
    await expect(resolveWorkflowGraph(store.db, dispatch('root', nested.id), { scope, catalog }))
      .rejects.toThrow('depth exceeds the 1-level limit')
  })

  it('refuses undeclared and missing required child inputs before dispatch is available', async () => {
    const child = await createDef(store.db, {
      workspaceId: scope.workspaceId,
      def: leaf('child', [{ name: 'ticket', required: true }]),
    })
    const root = (inputs: NonNullable<WorkflowDef['steps'][number]['childWorkflow']>['inputs']): WorkflowDef => ({
      name: 'root',
      steps: [{ name: 'child', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: child.id }, inputs } }],
    })

    await expect(resolveWorkflowGraph(store.db, root({ extra: { from: 'literal', value: 'x' } }), { scope, catalog }))
      .rejects.toThrow("binds undeclared child input 'extra'")
    await expect(resolveWorkflowGraph(store.db, root({}), { scope, catalog }))
      .rejects.toThrow("needs a binding for child input 'ticket'")
    await expect(resolveWorkflowGraph(
      store.db,
      root({ ticket: { from: 'literal', value: 'ACORN-42' } }),
      { scope, catalog, allowDatabaseDefinitions: false },
    )).rejects.toThrow('task-confined caller')
    expect(await getDef(store.db, child.id)).not.toBeNull()
    expect(() => assertRuntimeWorkflowDispatchUnavailable(root({ ticket: { from: 'literal', value: 'ACORN-42' } })))
      .toThrow('not available in this build')
  })

  it('fingerprints object keys independently of insertion order', () => {
    expect(workflowContentFingerprint({ a: 1, b: { c: 2, d: 3 } }))
      .toBe(workflowContentFingerprint({ b: { d: 3, c: 2 }, a: 1 }))
  })
})
