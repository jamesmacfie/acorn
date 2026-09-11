import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROFILE_ID, ProviderOperationError } from '@acorn/plugin-api/node'
import type { WorkflowCatalog, WorkflowDef } from '../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../shared/stepFields'
import { BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from './workflowBuiltins'
import { catalogValidation, GENERATE_MAX_OUTPUT_TOKENS, GENERATE_MAX_REPAIR_PROBLEMS } from './generateWorkflow'
import { generateWorkflowRequest, type GenerateWorkflowText } from './generateWorkflowRequest'
import { validateWorkflow, type WorkflowValidationCatalog } from './workflowValidation'

// The orchestrator's whole job is how many times it calls a model and which answer it keeps, so the
// provider is a vi.fn and every assertion here is about calls and choices. What goes into a prompt
// is ./generateWorkflow.test.ts, and what comes out of one is ./groundWorkflow.test.ts.

const catalog: WorkflowCatalog = {
  kinds: BUILTIN_STEP_KINDS.map((id) => ({ id, pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS[id] ?? null })),
  policies: [{ id: 'checks-green', pluginId: null }],
  profiles: [{ id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: true }],
}

const validation: WorkflowValidationCatalog = {
  ...catalogValidation(catalog),
  validateStepKind: (kind, step, context) => BUILTIN_STEP_VALIDATORS[kind as (typeof BUILTIN_STEP_KINDS)[number]]?.(step, context) ?? [],
}

const clean: WorkflowDef = {
  name: 'Investigate',
  steps: [
    { name: 'look', after: [], prompt: 'Read the issue and say what is wrong.' },
    { name: 'fix', after: ['look'], prompt: 'Write the fix.' },
  ],
}

// Two steps with one name: grounding leaves a duplicate alone on purpose, so this is the shortest
// answer that reaches the repair pass.
const duplicated: WorkflowDef = { ...clean, steps: [clean.steps[0]!, { ...clean.steps[1]!, name: 'look' }] }

const reply = (def: WorkflowDef) => JSON.stringify(def)

const answers = (...texts: string[]) => {
  let call = 0
  return vi.fn<GenerateWorkflowText>(async () => ({ text: texts[Math.min(call++, texts.length - 1)]!, providerId: 'anthropic', modelId: 'claude' }))
}

const run = (generateText: ReturnType<typeof answers>, over: Partial<{ description: string; modelId: string }> = {}) =>
  generateWorkflowRequest({
    request: { mode: 'overwrite', backendId: 'c1', modelId: 'claude-opus', description: 'two agents and a synthesiser', workspaceId: 'w1', ...over },
    catalog,
    validation,
    generateText,
  })

const promptOf = (generateText: ReturnType<typeof answers>, call: number) => generateText.mock.calls[call]![0].input.prompt
const systemOf = (generateText: ReturnType<typeof answers>, call: number) => generateText.mock.calls[call]![0].input.system

describe('generateWorkflowRequest', () => {
  it('makes one call when the first answer passes the checker', async () => {
    const generateText = answers(reply(clean))
    const result = await run(generateText)
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ repaired: false, problems: [], notes: [], providerId: 'anthropic', modelId: 'claude' })
    expect((result as { def: WorkflowDef }).def).toEqual(clean)
  })

  it('forwards the backend, the model and the output ceiling', async () => {
    const generateText = answers(reply(clean))
    await run(generateText)
    expect(generateText.mock.calls[0]![0]).toMatchObject({
      backendId: 'c1',
      input: { modelId: 'claude-opus', maxOutputTokens: GENERATE_MAX_OUTPUT_TOKENS },
    })
  })

  it('asks for an edit with the current graph and restores protected settings in the answer', async () => {
    const current: WorkflowDef = {
      name: 'Investigate',
      trigger: 'schedule:nightly',
      tools: { maxRisk: 'execute', allow: ['pnpm test'] },
      steps: [{ ...clean.steps[0]!, model: 'private-model', configOptions: { reasoning: 'high' } }, clean.steps[1]!],
    }
    const changed: WorkflowDef = {
      name: 'Investigate',
      tools: { maxRisk: 'read' },
      steps: [{ ...clean.steps[0]!, prompt: 'Inspect the issue from two angles.' }, clean.steps[1]!],
    }
    const generateText = answers(reply(changed))
    const result = await generateWorkflowRequest({
      request: { mode: 'edit', backendId: 'c1', description: 'Strengthen the investigation prompt.', workspaceId: 'w1', currentDef: current },
      catalog,
      validation,
      generateText,
    })
    expect(promptOf(generateText, 0)).toContain('Strengthen the investigation prompt.')
    expect(promptOf(generateText, 0)).toContain('"name": "look"')
    expect(promptOf(generateText, 0)).not.toContain('private-model')
    expect(result).toMatchObject({
      def: {
        trigger: 'schedule:nightly',
        tools: { maxRisk: 'read', allow: ['pnpm test'] },
        steps: [{ prompt: 'Inspect the issue from two angles.', model: 'private-model', configOptions: { reasoning: 'high' } }, clean.steps[1]],
      },
    })
  })

  it('leaves modelId out when none was asked for, so the backend picks its default', async () => {
    const generateText = answers(reply(clean))
    await generateWorkflowRequest({
      request: { mode: 'overwrite', backendId: 'c1', description: 'anything', workspaceId: 'w1' },
      catalog,
      validation,
      generateText,
    })
    expect(generateText.mock.calls[0]![0].input.modelId).toBeUndefined()
  })

  it('repairs once, on the same system prompt, carrying the description, the definition, the notes and every problem', async () => {
    // A step kind nothing has, so grounding writes a note and the checker still has the duplicate.
    const invented: WorkflowDef = { ...duplicated, steps: [{ ...duplicated.steps[0]!, kind: 'code-review' }, duplicated.steps[1]!] }
    const generateText = answers(reply(invented), reply(clean))
    const result = await run(generateText)
    expect(generateText).toHaveBeenCalledTimes(2)
    expect(systemOf(generateText, 1)).toBe(systemOf(generateText, 0))

    const repair = promptOf(generateText, 1)
    expect(repair).toContain('two agents and a synthesiser')
    expect(repair).toContain('"name": "look"')
    expect(repair).toContain("asked for the kind 'code-review'")
    for (const problem of validateWorkflow(duplicated, validation)) expect(repair).toContain(problem)
    expect(result).toMatchObject({ repaired: true, problems: [] })
  })

  it('caps the problems it sends and says how many it left out', async () => {
    const many: WorkflowDef = { name: 'Crowd', steps: Array.from({ length: 60 }, () => ({ name: 'look', prompt: 'Look.' })) }
    expect(validateWorkflow(many, validation).length).toBeGreaterThan(GENERATE_MAX_REPAIR_PROBLEMS)
    const generateText = answers(reply(many), reply(clean))
    await run(generateText)
    const repair = promptOf(generateText, 1)
    expect(repair.match(/^- step 'look' is declared more than once$/gm)).toHaveLength(GENERATE_MAX_REPAIR_PROBLEMS)
    expect(repair).toMatch(/- and \d+ more of the same kind\./)
  })

  it('keeps a repair answer that still has problems, because a problem count is not a quality measure', async () => {
    // The model deleted six of eight steps to shorten the list. Kept anyway: it parses and has a step.
    const generateText = answers(reply(duplicated), reply({ ...duplicated, name: 'Trimmed' }))
    const result = await run(generateText)
    expect(result).toMatchObject({ repaired: true, def: { name: 'Trimmed' } })
    expect((result as { problems: string[] }).problems.length).toBeGreaterThan(0)
  })

  it('keeps the first answer when the repair is not JSON, or has no steps', async () => {
    for (const bad of ['I could not do that.', reply({ name: 'Empty', steps: [] })]) {
      const generateText = answers(reply(duplicated), bad)
      const result = await run(generateText)
      expect(generateText).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({ repaired: false, def: { name: 'Investigate' } })
    }
  })

  it('reports only what changed in the answer it kept', async () => {
    const first: WorkflowDef = { ...duplicated, steps: [{ ...duplicated.steps[0]!, kind: 'code-review' }, duplicated.steps[1]!] }
    const second: WorkflowDef = { ...duplicated, steps: [duplicated.steps[0]!, { ...duplicated.steps[1]!, policy: 'ships-green' }] }
    const result = await run(answers(reply(first), reply(second)))
    // The invented kind was in the draft that was thrown away, so saying it was dropped would be a
    // note about a definition nobody sees.
    expect((result as { notes: { code: string }[] }).notes.map((note) => note.code)).toEqual(['unknown-policy'])
  })

  it('keeps the first pass\'s notes when the first answer is the one applied', async () => {
    const first: WorkflowDef = { ...duplicated, steps: [{ ...duplicated.steps[0]!, kind: 'code-review' }, duplicated.steps[1]!] }
    const result = await run(answers(reply(first), 'I could not do that.'))
    expect(result).toMatchObject({ repaired: false })
    expect((result as { notes: { code: string }[] }).notes.map((note) => note.code)).toEqual(['unknown-kind'])
  })

  it('answers with the reason when the first reply is not JSON, and never calls again', async () => {
    const generateText = answers('Here is a workflow: it starts with an agent.')
    expect(await run(generateText)).toEqual({ error: 'The model did not answer with JSON.' })
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('lets a provider failure on the first call through untouched', async () => {
    const generateText = vi.fn<GenerateWorkflowText>(async () => { throw new ProviderOperationError('provider_needs_auth', 401) })
    await expect(run(generateText as never)).rejects.toBeInstanceOf(ProviderOperationError)
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  // The one budget promise this makes to a person waiting on it, so it is a property over every
  // shape of reply rather than one case.
  it('never calls a third time, whatever comes back', async () => {
    const replies = ['', 'sorry', '{}', '[]', reply({ name: 'Empty', steps: [] }), reply(clean), reply(duplicated), `\`\`\`json\n${reply(duplicated)}\n\`\`\``]
    for (const first of replies) {
      for (const second of replies) {
        const generateText = answers(first, second)
        await run(generateText)
        expect(generateText.mock.calls.length).toBeLessThanOrEqual(2)
      }
    }
  })
})
