import { describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { agentDefinitionView, agentDraftDefinition } from './projection'

const TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'

const source = (): WorkflowDef => ({
  baseline: ACORN_BASELINE,
  formatVersion: 1,
  name: 'Release',
  tools: { allow: ['git_log'], maxRisk: 'write' },
  budget: { maxInputTokens: 1000 },
  inputs: [{ name: 'region', schema: { type: 'string' }, default: 'ap-southeast-2' }],
  steps: [
    {
      id: 'plan',
      name: 'Plan',
      kind: 'agent',
      prompt: 'Plan it',
      model: 'opus',
      configOptions: { reasoning: 'high' },
      requiresRun: 'web',
    },
    {
      id: 'post',
      name: 'Post',
      kind: 'http',
      with: { url: 'https://example.com', auth: 'Bearer x', headers: { a: 'b' }, apiToken: 'hunter2' },
    },
    { id: 'note', name: 'Note', kind: 'agent', prompt: `Use ${TOKEN} to push` },
  ],
})

describe('agentDefinitionView', () => {
  it('omits protected configuration and flagged strings but keeps provider choices', () => {
    const { definition, withheld } = agentDefinitionView(source())
    expect(definition.tools).toEqual({ maxRisk: 'write' })
    expect(definition.steps[0]).toMatchObject({ model: 'opus', configOptions: { reasoning: 'high' } })
    expect(definition.steps[0]!.requiresRun).toBeUndefined()
    expect(definition.steps[1]!.with).toEqual({ url: 'https://example.com' })
    expect(definition.steps[2]!.prompt).toBeUndefined()
    expect(definition.inputs).toEqual([{ name: 'region', schema: { type: 'string' } }])
    expect(definition.budget).toEqual({ maxInputTokens: 1000 })
    expect(withheld).toEqual(
      expect.arrayContaining([
        { path: 'tools.allow', reason: 'protected' },
        { path: 'steps[plan].requiresRun', reason: 'protected' },
        { path: 'steps[post].with.auth', reason: 'protected' },
        { path: 'steps[post].with.headers', reason: 'protected' },
        { path: 'steps[note].prompt', reason: 'likely-secret' },
        { path: 'steps[post].with.apiToken', reason: 'likely-secret' },
        { path: 'inputs[region].default', reason: 'input-default' },
      ]),
    )
    expect(JSON.stringify(definition)).not.toContain(TOKEN)
  })
})

describe('agentDraftDefinition', () => {
  it('refuses protected values from the agent on a new draft', () => {
    const draft = agentDraftDefinition(source(), null)
    expect(draft.tools).toEqual({ maxRisk: 'write' })
    expect(draft.steps[1]!.with).toEqual({ url: 'https://example.com', apiToken: 'hunter2' })
  })

  it('restores withheld values by step ID and kind, never onto a changed kind or a new step', () => {
    const view = agentDefinitionView(source()).definition
    const edited: WorkflowDef = {
      ...view,
      steps: [
        { ...view.steps[1]!, name: 'Post renamed' },
        { ...view.steps[0]!, kind: 'decide' },
        view.steps[2]!,
        { id: 'extra', name: 'Extra', kind: 'http', with: { url: 'https://example.org' } },
      ],
    }
    const draft = agentDraftDefinition(edited, source())
    expect(draft.tools).toEqual({ allow: ['git_log'], maxRisk: 'write' })
    expect(draft.steps[0]!.with).toEqual({
      url: 'https://example.com',
      auth: 'Bearer x',
      headers: { a: 'b' },
      apiToken: 'hunter2',
    })
    expect(draft.inputs).toEqual([{ name: 'region', schema: { type: 'string' }, default: 'ap-southeast-2' }])
    expect(draft.steps[1]!.requiresRun).toBeUndefined()
    expect(draft.steps[2]!.prompt).toBe(`Use ${TOKEN} to push`)
    expect(draft.steps[3]!.with).toEqual({ url: 'https://example.org' })
  })

  it('keeps a replacement the agent wrote for a withheld ordinary value', () => {
    const view = agentDefinitionView(source()).definition
    const edited = {
      ...view,
      steps: view.steps.map((step) => (step.id === 'note' ? { ...step, prompt: 'Push with the stored token' } : step)),
    }
    expect(agentDraftDefinition(edited, source()).steps[2]!.prompt).toBe('Push with the stored token')
  })
})
