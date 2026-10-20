import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { workflowToolCalls } from '../../node/schema'
import { createDef, getDef, updateDef } from '../definitions/store'
import { createPublishedDef } from '../../testkit/publishedDefinition'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { z } from 'zod'
import { bootWorkflowTools, managed, workflowDef as def, type WorkflowToolHarness } from './test/helpers/toolHarness'

// What the agents plugin publishes as its default profile, which these tests stand in for.
const DEFAULT_PROFILE_ID = 'claude-code'

let harness: WorkflowToolHarness | null = null
const boot = bootWorkflowTools

beforeEach(async () => {
  harness = await boot()
})
afterEach(async () => {
  await harness?.cleanup()
  harness = null
})

describe('the workflow tool surface', () => {
  it('registers every tool with an MCP schema a harness can read', async () => {
    const tools = harness!.tools
    expect(tools.map((tool) => [tool.name, tool.risk, !!tool.requiresSession])).toEqual([
      ['workflow_catalog', 'read', false],
      ['workflows_list', 'read', false],
      ['workflow_get', 'read', false],
      ['workflow_validate', 'read', false],
      ['workflow_draft', 'write', true],
      ['workflow_run', 'execute', true],
      ['workflow_read', 'read', true],
      ['workflow_wait', 'read', true],
      ['workflow_cancel', 'execute', true],
    ])
    // The projection the MCP route makes (node-core routes/plugins/agentTools.ts).
    for (const tool of tools)
      expect(z.toJSONSchema(tool.input, { target: 'draft-7', io: 'input' })).toMatchObject({ type: 'object' })
  })

  it('hides session tools from a terminal session and workflow_run from a workflow step', async () => {
    const shown = async (sessionId: string) => {
      const visible = []
      for (const tool of harness!.tools) {
        if (!tool.when || (await tool.when({ taskId: 'task', userLogin: 'owner', sessionId }))) visible.push(tool.name)
      }
      return visible
    }
    expect(await shown('terminal-session')).toEqual([
      'workflow_catalog',
      'workflows_list',
      'workflow_get',
      'workflow_validate',
    ])
    harness!.sessions.set('step-session', { workflowOwned: true, workflowRunId: 'run' })
    expect(await shown('step-session')).not.toContain('workflow_run')
    expect(await shown('step-session')).toContain('workflow_read')
  })
})

describe('workflow discovery tools', () => {
  it('pages the catalog of step kinds and names the profiles', async () => {
    const first = await harness!.call('workflow_catalog', {})
    expect(first.kinds.map((kind: { id: string }) => kind.id)).toContain('agent')
    expect(first.profiles.some((profile: { id: string }) => profile.id === DEFAULT_PROFILE_ID)).toBe(true)
    expect(first.format).toEqual({ formatVersion: 1, baseline: ACORN_BASELINE })
  })

  it("lists only this task's project, with drafts, files, and the reasons a file failed", async () => {
    const published = await createPublishedDef(harness!.store, {
      workspaceId: 'workspace',
      projectId: 'project',
      def: def('Published flow'),
    })
    const draft = await createDef(harness!.store, {
      workspaceId: 'workspace',
      projectId: 'project',
      def: def('Draft flow'),
    })
    await createDef(harness!.store, { workspaceId: 'workspace', projectId: 'other', def: def('Foreign flow') })

    const { workflows } = await harness!.call('workflows_list', {})
    const byName = new Map(workflows.map((entry: { name: string }) => [entry.name, entry]))
    expect([...byName.keys()]).not.toContain('Foreign flow')
    expect(byName.get('Published flow')).toMatchObject({
      ref: { source: 'database', id: published.id },
      published: true,
      digest: expect.any(String),
    })
    expect(byName.get('Draft flow')).toMatchObject({
      ref: { source: 'database', id: draft.id },
      published: false,
      revision: 1,
    })
    expect(byName.get('Repo review')).toMatchObject({
      ref: { source: 'repo', path: '.acorn/workflows/review.toml' },
      published: true,
      inputs: [{ name: 'ticket_id', hasDefault: true }],
    })
    expect(JSON.stringify(byName.get('Repo review'))).not.toContain('ABC-1')
    const broken = workflows.find(
      (entry: { ref: { path?: string } }) => entry.ref.path === '.acorn/workflows/broken.toml',
    )
    expect(broken.problems[0]).toMatch(/Incompatible workflow/)

    expect(
      (await harness!.call('workflows_list', { search: 'draft' })).workflows.map(
        (entry: { name: string }) => entry.name,
      ),
    ).toEqual(['Draft flow'])
  })

  it('reads a draft, a published revision, and a file without protected settings', async () => {
    const row = await createPublishedDef(harness!.store, {
      workspaceId: 'workspace',
      projectId: 'project',
      def: def('Flow'),
    })
    const draft = await harness!.call('workflow_get', { ref: { source: 'database', id: row.id } })
    expect(draft).toMatchObject({
      showing: 'draft',
      revision: 1,
      editable: true,
      published: { revision: 1 },
      target: { kind: 'workflow-definition', resourceId: `db:${row.id}`, projectId: 'project' },
    })
    expect(await harness!.call('workflow_get', { ref: { source: 'database', id: row.id }, revision: 1 })).toMatchObject(
      { showing: 'published', digest: draft.digest },
    )
    await expect(
      harness!.call('workflow_get', { ref: { source: 'database', id: row.id }, revision: 2 }),
    ).rejects.toMatchObject({ kind: 'not_found' })

    const file = await harness!.call('workflow_get', { ref: { source: 'repo', path: '.acorn/workflows/review.toml' } })
    expect(file).toMatchObject({
      showing: 'file',
      editable: false,
      withheld: [{ path: 'inputs[ticket_id].default', reason: 'input-default' }],
    })
    expect(JSON.stringify(file)).not.toContain('ABC-1')
    expect(file.definition.trigger).toBeUndefined()
    expect(
      (
        await harness!.call('workflow_get', {
          ref: { source: 'repo', path: '.acorn/workflows/review.toml' },
          step: 'review',
        })
      ).step.name,
    ).toBe('Review')
  })

  it("answers another project's definition as not found", async () => {
    const foreign = await createDef(harness!.store, {
      workspaceId: 'workspace',
      projectId: 'other',
      def: def('Foreign'),
    })
    await expect(harness!.call('workflow_get', { ref: { source: 'database', id: foreign.id } })).rejects.toMatchObject({
      kind: 'not_found',
    })
    await expect(harness!.call('workflow_get', { ref: { source: 'database', id: 'missing' } })).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('validates structure first, then kinds and references, without saving', async () => {
    expect(await harness!.call('workflow_validate', { definition: { name: 'x' } })).toMatchObject({
      valid: false,
      problems: expect.arrayContaining([expect.stringMatching(/^baseline:/)]),
    })
    const unknown = await harness!.call('workflow_validate', {
      definition: def('Unknown', [{ id: 'x', name: 'X', kind: 'not-a-kind' }]),
    })
    expect(unknown.valid).toBe(false)
    expect(unknown.problems.join('\n')).toMatch(/not-a-kind/)
    expect(await harness!.call('workflow_validate', { definition: def('Fine') })).toEqual({ valid: true, problems: [] })
    expect(
      (await harness!.call('workflows_list', {})).workflows.some((entry: { name: string }) => entry.name === 'Fine'),
    ).toBe(false)
  })
})

describe('workflow_draft', () => {
  const draft = (name: string, steps?: WorkflowDef['steps']) => ({
    definition: def(name, steps) as unknown as Record<string, unknown>,
  })

  it('creates a project draft with agent provenance, a diff, and its problems', async () => {
    const saved = await harness!.call(
      'workflow_draft',
      draft('Agent flow', [{ id: 'plan', name: 'Plan', kind: 'not-a-kind' }]),
      managed('session-a', 'call-1'),
    )
    expect(saved).toMatchObject({
      ref: { source: 'database', id: saved.id },
      revision: 1,
      created: true,
      diff: { steps: { added: ['plan'], removed: [], changed: [] } },
      target: { kind: 'workflow-definition', resourceId: `db:${saved.id}`, projectId: 'project' },
    })
    expect(saved.problems.join('\n')).toMatch(/not-a-kind/)
    expect(await getDef(harness!.store, saved.id)).toMatchObject({
      projectId: 'project',
      publishedRevision: null,
      agentOrigin: { taskId: 'task', sessionId: 'session-a', callId: 'call-1', lastCallId: 'call-1' },
    })
    const listed = (await harness!.call('workflows_list', { search: 'Agent flow' }, { sessionId: 'session-b' }))
      .workflows[0]
    expect(listed).toMatchObject({ published: false, agentDraft: { yours: false } })
  })

  it('returns the same answer for a repeated call and refuses a reused call ID with other content', async () => {
    const first = await harness!.call('workflow_draft', draft('Once'), managed('session-a', 'call-1'))
    expect(await harness!.call('workflow_draft', draft('Once'), managed('session-a', 'call-1'))).toEqual(first)
    expect((await harness!.call('workflows_list', { search: 'Once' })).workflows).toHaveLength(1)
    await expect(
      harness!.call('workflow_draft', draft('Different'), managed('session-a', 'call-1')),
    ).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('recovers a call whose write landed before its answer was recorded', async () => {
    const first = await harness!.call('workflow_draft', draft('Landed'), managed('session-a', 'call-1'))
    harness!.store.update(workflowToolCalls).set({ state: 'reserved' }).run()
    expect(await harness!.call('workflow_draft', draft('Landed'), managed('session-a', 'call-1'))).toEqual(first)
    expect((await harness!.call('workflows_list', { search: 'Landed' })).workflows).toHaveLength(1)
  })

  it('replaces only its own draft, at the revision it read', async () => {
    const created = await harness!.call('workflow_draft', draft('Mine'), managed('session-a', 'call-1'))
    const replaced = await harness!.call(
      'workflow_draft',
      {
        ...draft('Mine', [{ id: 'plan', name: 'Plan', prompt: 'Plan it better.' }]),
        draftId: created.id,
        expectedRevision: 1,
      },
      managed('session-a', 'call-2'),
    )
    expect(replaced).toMatchObject({
      id: created.id,
      revision: 2,
      created: false,
      diff: { steps: { changed: [{ step: 'plan', fields: ['prompt'] }] } },
    })

    await expect(
      harness!.call(
        'workflow_draft',
        { ...draft('Mine'), draftId: created.id, expectedRevision: 1 },
        managed('session-a', 'call-3'),
      ),
    ).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('revision 2') })
    await expect(
      harness!.call(
        'workflow_draft',
        { ...draft('Mine'), draftId: created.id, expectedRevision: 2 },
        managed('session-b', 'call-4'),
      ),
    ).rejects.toMatchObject({ kind: 'not_found' })

    // The owner saves in the editor while the agent still holds revision 2.
    const owner = await getDef(harness!.store, created.id)
    await updateDef(harness!.store, created.id, { ...owner!.def, name: 'Mine, edited' }, 2)
    await expect(
      harness!.call(
        'workflow_draft',
        { ...draft('Mine'), draftId: created.id, expectedRevision: 2 },
        managed('session-a', 'call-5'),
      ),
    ).rejects.toMatchObject({ kind: 'conflict', message: expect.stringContaining('revision 3') })
    expect((await getDef(harness!.store, created.id))!.name).toBe('Mine, edited')
  })

  it('proposes a separate draft from a source and keeps what the agent could not read', async () => {
    const source = await createPublishedDef(harness!.store, {
      workspaceId: 'workspace',
      projectId: 'project',
      def: def('Source', [{ id: 'post', name: 'Post', kind: 'agent', prompt: 'Post it', requiresRun: 'web' }]),
    })
    const view = await harness!.call('workflow_get', { ref: { source: 'database', id: source.id } })
    expect(view.withheld.map((field: { path: string }) => field.path)).toEqual(['steps[post].requiresRun'])

    const proposed = await harness!.call(
      'workflow_draft',
      {
        definition: {
          ...view.definition,
          steps: [{ ...view.definition.steps[0], prompt: 'Post it twice' }],
        },
        source: { source: 'database', id: source.id },
      },
      managed('session-a', 'call-1'),
    )
    expect(proposed.id).not.toBe(source.id)
    expect(proposed.diff).toMatchObject({ settings: [], steps: { changed: [{ step: 'post', fields: ['prompt'] }] } })
    const saved = await getDef(harness!.store, proposed.id)
    expect(saved!.def).toMatchObject({ steps: [{ prompt: 'Post it twice', requiresRun: 'web' }] })
    expect(saved!.agentOrigin).toMatchObject({
      source: { source: 'database', id: source.id },
      baseRevision: 1,
      baseDigest: expect.any(String),
    })
    expect(await getDef(harness!.store, source.id)).toMatchObject({
      revision: 1,
      publishedRevision: 1,
      def: { steps: [{ prompt: 'Post it' }] },
    })
  })

  it('refuses a caller without a managed session and a definition with no structure', async () => {
    await expect(harness!.call('workflow_draft', draft('Nobody'), { callId: 'call-1' })).rejects.toMatchObject({
      kind: 'not_found',
    })
    await expect(
      harness!.call('workflow_draft', draft('Terminal'), managed('terminal-session', 'call-1')),
    ).rejects.toMatchObject({ kind: 'not_found' })
    await expect(
      harness!.call('workflow_draft', { definition: { name: 'No steps' } }, managed('session-a', 'call-1')),
    ).rejects.toMatchObject({ kind: 'bad_request' })
  })

  it('keeps creator and source provenance across a restart', async () => {
    const saved = await harness!.call('workflow_draft', draft('Durable'), managed('session-a', 'call-1'))
    const root = harness!.root
    await harness!.stop()
    harness = await boot(root)
    expect((await getDef(harness.store, saved.id))!.agentOrigin).toMatchObject({
      sessionId: 'session-a',
      callId: 'call-1',
    })
    expect(await harness.call('workflow_draft', draft('Durable'), managed('session-a', 'call-1'))).toEqual(saved)
  })
})
