import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { WorkflowCatalog } from '../shared/workflowContracts'
import { createPublishedDef as createDef } from '../testkit/publishedDefinition'
import { createDef as createDraftDef } from './workflowDefs'
import {
  GENERATE_MAX_WORKFLOW_CATALOG_JSON_CHARS,
  GENERATE_MAX_WORKFLOW_TARGETS,
  generationWorkflowCatalog,
  scopedWorkflowCatalog,
} from './workflowCatalog'
import type { WorkflowValidationCatalog } from './workflowValidation'

const base: WorkflowCatalog = {
  kinds: [{
    id: 'agent',
    pluginId: null,
    describe: { label: 'Ask an agent', fields: [], output: { description: 'Answer.' } },
  }],
  policies: [],
  profiles: [{ id: 'claude-code', label: 'Claude Code', managed: true, structured: true }],
}

const validation: WorkflowValidationCatalog = {
  stepKinds: new Set(['agent']),
  policies: new Set(),
  profiles: new Set(['claude-code']),
  structuredProfiles: new Set(['claude-code']),
}

describe('the project-scoped workflow catalog', () => {
  let store: TestPluginDb
  let root: string
  let repoDir: string
  let userDir: string

  beforeEach(() => {
    store = makeTestPluginDb('workflows')
    root = mkdtempSync(join(tmpdir(), 'acorn-workflow-catalog-'))
    repoDir = join(root, 'repo')
    userDir = join(root, 'user')
    mkdirSync(join(repoDir, '.acorn', 'workflows'), { recursive: true })
    mkdirSync(join(userDir, '.acorn', 'workflows'), { recursive: true })
  })

  afterEach(() => {
    store.cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  it('lists only resolvable rows and files, without input values or definition bodies', async () => {
    const row = await createDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      def: {
        formatVersion: 2,
        name: 'Review one ticket',
        inputs: [{ name: 'ticket', schema: { type: 'string' }, description: 'Ticket number', required: true, default: 'SECRET-42' }],
        outputs: [{
          name: 'summary',
          schema: { type: 'object', properties: { summary: { type: 'string' } } },
          binding: { address: { from: 'step', stepId: 'answer', pointer: '' } },
        }],
        steps: [{
          id: 'answer',
          name: 'answer',
          prompt: 'Review it.',
          schema: {
            type: 'object',
            properties: { summary: { type: 'string', examples: ['SECRET-SUMMARY'] } },
          },
        }],
      },
    })
    await createDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-2',
      def: { formatVersion: 2, name: 'Other project', steps: [{ id: 'work', name: 'work', prompt: 'Work.' }] },
    })
    await createDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      def: { name: 'Invalid draft', steps: [] },
    })
    await createDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      def: {
        formatVersion: 2, name: 'Parent workflow',
        steps: [{
          id: 'child',
          name: 'child',
          kind: 'workflow',
          childWorkflow: { ref: { source: 'database', id: row.id } },
        }],
      },
    })
    writeFileSync(join(repoDir, '.acorn', 'workflows', 'repo-review.toml'), 'format_version = 2\nname = "Repo review"\n[[steps]]\nid = "work"\nname = "work"\nprompt = "Review."\n')
    writeFileSync(join(userDir, '.acorn', 'workflows', 'personal.toml'), 'format_version = 2\nname = "Personal"\n[[steps]]\nid = "work"\nname = "work"\nprompt = "Review."\n')

    const catalog = await scopedWorkflowCatalog({
      db: store.db,
      base,
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      repoDir,
      userDir,
      validation,
    })

    expect(catalog.workflows?.map((target) => target.name)).toEqual(['Invalid draft', 'Personal', 'Repo review', 'Review one ticket'])
    expect(catalog.workflows).toContainEqual(expect.objectContaining({
      ref: { source: 'database', id: row.id },
      published: true,
      inputs: [{ name: 'ticket', schema: { type: 'string' }, description: 'Ticket number', required: true, hasDefault: true }],
      outputs: [{ name: 'summary', schema: { type: 'object', properties: { summary: { type: 'string' } } } }],
    }))
    expect(catalog.workflows).toContainEqual(expect.objectContaining({ name: 'Invalid draft', published: true }))
    expect(JSON.stringify(catalog)).not.toContain('SECRET-42')
    expect(JSON.stringify(catalog)).not.toContain('Review it.')
  })

  it('bounds the model catalog and excludes the definition being edited', () => {
    const workflows = Array.from({ length: GENERATE_MAX_WORKFLOW_TARGETS + 5 }, (_, index) => ({
      ref: { source: 'database' as const, id: `row-${index}` },
      name: `Workflow ${index}`,
      inputs: [],
    }))
    const catalog = generationWorkflowCatalog({ ...base, workflows }, 'row-3')
    expect(catalog.workflows).toHaveLength(GENERATE_MAX_WORKFLOW_TARGETS)
    expect(catalog.workflows?.some((target) => target.ref.source === 'database' && target.ref.id === 'row-3')).toBe(false)
    expect(JSON.stringify(catalog.workflows).length).toBeLessThanOrEqual(GENERATE_MAX_WORKFLOW_CATALOG_JSON_CHARS)
  })

  it('offers unpublished leaf drafts to the editor but not to generation', async () => {
    const draft = await createDraftDef(store.db, {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      def: {
        formatVersion: 2,
        name: 'New record reviewer',
        inputs: [{ name: 'record', schema: { type: 'object' }, required: true }],
        steps: [],
      },
    })

    const catalog = await scopedWorkflowCatalog({
      db: store.db,
      base,
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      repoDir,
      userDir,
      validation,
    })

    expect(catalog.workflows).toContainEqual(expect.objectContaining({
      ref: { source: 'database', id: draft.id },
      name: 'New record reviewer',
      published: false,
      inputs: [{ name: 'record', schema: { type: 'object' }, required: true }],
    }))
    expect(generationWorkflowCatalog(catalog).workflows).not.toContainEqual(expect.objectContaining({
      ref: { source: 'database', id: draft.id },
    }))
  })
})
