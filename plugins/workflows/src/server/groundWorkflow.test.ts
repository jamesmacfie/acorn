import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { BUILTIN_STEP_DESCRIPTIONS } from '../shared/stepFields'
import type { StepKindDescription, WorkflowCatalog, WorkflowDef } from '../shared/workflowContracts'
import { BUILTIN_EXAMPLES } from './generateWorkflow'
import { BUILTIN_STEP_KINDS } from './workflowBuiltins'
import { extractJsonObject, groundWorkflow, parseGeneratedWorkflow, stripJsonFences, type GroundedWorkflow } from './groundWorkflow'

// One test per row of the grounding table, driven from a fixture catalog: the module is pure, so
// none of this needs a runner, a provider or a database.

// The real `http:request` fields, `auth` and `vars` deliberately absent, so the known false positive
// below is pinned against the shape it actually has (../../../http/src/server/workflowStep.ts).
const httpKind: StepKindDescription = {
  label: 'Call an HTTP endpoint',
  fields: [
    { id: 'method', label: 'Method', type: 'select', required: true, options: [{ value: 'GET', label: 'GET' }] },
    { id: 'url', label: 'URL', type: 'text', required: true },
    { id: 'headers', label: 'Headers', type: 'textarea' },
    { id: 'body', label: 'Body', type: 'textarea' },
  ],
}

const catalog: WorkflowCatalog = {
  kinds: [
    ...BUILTIN_STEP_KINDS.map((id) => ({ id, pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS[id] ?? null })),
    { id: 'http:request', pluginId: 'http', describe: httpKind },
    // A contributed kind with no description at all: its `with` is unreadable, so nothing in it is dropped.
    { id: 'notes:write', pluginId: 'notes', describe: null },
  ],
  policies: [{ id: 'checks-green', pluginId: null }],
  profiles: [
    { id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: true },
    { id: 'plain', label: 'Plain', managed: false, structured: false },
  ],
}

const ground = (def: unknown): GroundedWorkflow => groundWorkflow(def as WorkflowDef, catalog)
const codes = (result: GroundedWorkflow): string[] => result.notes.map((note) => note.code)
const messages = (result: GroundedWorkflow): string => result.notes.map((note) => note.message).join('\n')
const parsed = (text: string): GroundedWorkflow => {
  const result = parseGeneratedWorkflow(text)
  if ('error' in result) throw new Error(`expected a definition, got: ${result.error}`)
  return result
}

const workflow = (steps: unknown[], over: Record<string, unknown> = {}): unknown =>
  ({ name: 'Investigate', ...over, steps })

describe('reading the reply', () => {
  const body = '{"name":"W","steps":[{"name":"a","prompt":"Do it."}]}'

  it('takes a bare object', () => {
    expect(parsed(body).def.name).toBe('W')
  })

  it('takes a fenced object', () => {
    expect(parsed(`\`\`\`json\n${body}\n\`\`\``).def.name).toBe('W')
    expect(parsed(`\`\`\`\n${body}\n\`\`\``).def.name).toBe('W')
  })

  it('takes prose before, prose after, and both', () => {
    expect(parsed(`Here is the workflow.\n\n${body}`).def.name).toBe('W')
    expect(parsed(`${body}\n\nHope that helps.`).def.name).toBe('W')
    expect(parsed(`Here you go:\n\`\`\`json\n${body}\n\`\`\`\nTell me if you want changes.`).def.name).toBe('W')
  })

  it('keeps counting braces through a prompt that holds one', () => {
    // The case that breaks a naive brace count: every reference in a prompt closes a brace.
    const withReference = '{"name":"W","steps":[{"name":"a","after":[],"prompt":"Do it."},'
      + '{"name":"b","after":["a"],"prompt":"Read ${steps.a.output} and answer with {json}."}]}'
    const def = parsed(withReference).def
    expect(def.steps).toHaveLength(2)
    expect(def.steps[1]?.prompt).toContain('${steps.a.output}')
  })

  it('keeps counting braces through an escaped quote', () => {
    const escaped = String.raw`{"name":"W","steps":[{"name":"a","prompt":"They said \"} done \" and left."}]}`
    expect(parsed(escaped).def.steps[0]?.prompt).toBe('They said "} done " and left.')
  })

  it('skips a balanced pair of braces in the prose in front', () => {
    // A preamble explaining ${inputs.issue} is a balanced object as far as a brace count is concerned.
    expect(parsed(`This uses \${inputs.issue} for the issue.\n${body}`).def.name).toBe('W')
  })

  it('finds the object even without the fence stripper', () => {
    expect(extractJsonObject('noise {"a":"}"} more')).toBe('{"a":"}"}')
    expect(extractJsonObject('no object here')).toBeUndefined()
  })

  it('strips a fence only when the whole reply is one', () => {
    expect(stripJsonFences('```json\n{}\n```').trim()).toBe('{}')
    const backticks = '{"name":"W","steps":[{"name":"a","prompt":"Answer in a ```json block."}]}'
    expect(stripJsonFences(backticks)).toBe(backticks)
  })
})

describe('what cannot be applied', () => {
  it('refuses a reply that is not JSON', () => {
    expect(parseGeneratedWorkflow('I cannot write that workflow.')).toEqual({ error: 'The model did not answer with JSON.' })
  })

  it('refuses a reply that is not an object', () => {
    expect(parseGeneratedWorkflow('[1, 2]')).toEqual({ error: "The model's answer is not a JSON object." })
  })

  it('refuses a workflow with no name', () => {
    expect(parseGeneratedWorkflow('{"steps":[{"name":"a"}]}')).toEqual({ error: 'The workflow the model wrote has no name.' })
    expect(parseGeneratedWorkflow('{"name":"  ","steps":[{"name":"a"}]}')).toEqual({ error: 'The workflow the model wrote has no name.' })
  })

  it('refuses a workflow with no steps', () => {
    const nothing = { error: 'The workflow the model wrote has no steps.' }
    expect(parseGeneratedWorkflow('{"name":"W"}')).toEqual(nothing)
    expect(parseGeneratedWorkflow('{"name":"W","steps":[]}')).toEqual(nothing)
    expect(parseGeneratedWorkflow('{"name":"W","steps":"first do this"}')).toEqual(nothing)
    // Every entry dropped is the same thing as no steps.
    expect(parseGeneratedWorkflow('{"name":"W","steps":["do the thing"]}')).toEqual(nothing)
  })

  it('drops an entry that is not a step and keeps the rest', () => {
    const result = parsed('{"name":"W","steps":["do the thing",{"name":"a"},{"prompt":"nameless"}]}')
    expect(result.def.steps.map((step) => step.name)).toEqual(['a'])
    expect(codes(result)).toEqual(['dropped-step', 'dropped-step'])
    expect(messages(result)).toContain('Step 1 is not a step')
    expect(messages(result)).toContain('Step 3 has no name')
  })
})

describe('identifiers the catalog can refute', () => {
  it('turns an invented kind into an agent step and keeps its prompt', () => {
    const result = ground(workflow([{ name: 'review', kind: 'code-review', with: { prompt: 'Review the change.' } }]))
    expect(result.def.steps[0]).toEqual({ name: 'review', prompt: 'Review the change.' })
    expect(codes(result)).toEqual(['unknown-kind'])
    expect(messages(result)).toContain("Step 'review' asked for the kind 'code-review'")
  })

  it('drops an invented policy, keeps the gate, and names the real ones', () => {
    const result = ground(workflow([{ name: 'checks', kind: 'gate-policy', after: [], policy: 'all-green' }]))
    expect(result.def.steps[0]).toEqual({ name: 'checks', kind: 'gate-policy', after: [] })
    expect(codes(result)).toEqual(['unknown-policy'])
    expect(messages(result)).toContain('checks-green')
  })

  it('drops an invented profile so the step runs on the default', () => {
    const result = ground(workflow([
      { name: 'a', after: [], profileId: 'gpt-9', prompt: 'Go.' },
      { name: 'b', after: ['a'], kind: 'fan-out', prompt: 'Plan.', childStep: { profileId: 'gpt-9', prompt: 'Fix one.' } },
    ]))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.' })
    expect(result.def.steps[1]?.childStep).toEqual({ prompt: 'Fix one.' })
    expect(codes(result)).toEqual(['unknown-profile', 'unknown-profile'])
  })

  it('leaves a real profile alone, even an unstructured one on a decide', () => {
    // The checker says decide needs a structured profile, and its message is better than any note.
    const def = workflow([{ name: 'pick', kind: 'decide', after: [], profileId: 'plain', prompt: 'Verdict?', branches: { yes: 'pick' } }])
    const result = ground(def)
    expect(result.notes).toEqual([])
    expect(JSON.stringify(result.def)).toBe(JSON.stringify(def))
  })

  it('drops a with key the contributed kind does not take', () => {
    const result = ground(workflow([{ name: 'call', kind: 'http:request', after: [], with: { method: 'GET', url: 'https://example.com', retries: 3 } }]))
    expect(result.def.steps[0]?.with).toEqual({ method: 'GET', url: 'https://example.com' })
    expect(codes(result)).toEqual(['unknown-with-key'])
    expect(messages(result)).toContain("Step 'call' set 'retries' inside `with`")
  })

  it("drops http:request's auth, which is the known false positive", () => {
    // `auth` is deliberately not one of the kind's fields, so grounding cannot tell it from a key the
    // model invented. Accepted: an unknown `with` key is otherwise silent everywhere.
    const result = ground(workflow([{ name: 'call', kind: 'http:request', after: [], with: { method: 'GET', url: 'https://example.com', auth: { mode: 'bearer' } } }]))
    expect(result.def.steps[0]?.with).toEqual({ method: 'GET', url: 'https://example.com' })
    expect(codes(result)).toEqual(['unknown-with-key'])
  })

  it('leaves the with table of a kind that describes no fields', () => {
    const def = workflow([{ name: 'note', kind: 'notes:write', after: [], with: { body: 'anything at all' } }])
    const result = ground(def)
    expect(result.notes).toEqual([])
    expect(JSON.stringify(result.def)).toBe(JSON.stringify(def))
  })

  it('drops a with table from a built-in, hoisting its prompt first', () => {
    const result = ground(workflow([
      { name: 'a', after: [], kind: 'agent', with: { prompt: 'Do the thing.' } },
      { name: 'b', after: ['a'], prompt: 'Already has one.', with: { prompt: 'Ignored.' } },
    ]))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], kind: 'agent', prompt: 'Do the thing.' })
    expect(result.def.steps[1]).toEqual({ name: 'b', after: ['a'], prompt: 'Already has one.' })
    expect(codes(result)).toEqual(['with-on-builtin', 'with-on-builtin'])
  })

  it('has nothing to hoist into a gate', () => {
    const result = ground(workflow([{ name: 'approve', kind: 'gate-human', after: [], with: { prompt: 'Please look.' } }]))
    expect(result.def.steps[0]).toEqual({ name: 'approve', kind: 'gate-human', after: [] })
    expect(codes(result)).toEqual(['with-on-builtin'])
  })

  it('drops a schema that is not an object', () => {
    const result = ground(workflow([
      { name: 'a', after: [], prompt: 'Go.', schema: 'a JSON schema' },
      { name: 'b', after: ['a'], kind: 'fan-out', prompt: 'Plan.', childStep: { schema: [] } },
    ]))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.' })
    expect(result.def.steps[1]?.childStep).toEqual({})
    expect(codes(result)).toEqual(['dropped-schema', 'dropped-schema'])
  })
})

describe('keys outside the vocabulary', () => {
  it('drops a key that is not part of a workflow, a step, a child step or an input', () => {
    const result = ground(workflow(
      [{ name: 'a', after: [], prompt: 'Go.', retries: 2, childStep: { prompt: 'Fix.', timeout: 5 } }],
      { schedule: 'daily', inputs: [{ name: 'issue', kind: 'text' }] },
    ))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.', childStep: { prompt: 'Fix.' } })
    expect(result.def.inputs).toEqual([{ name: 'issue' }])
    expect(codes(result)).toEqual(['unknown-key', 'unknown-key', 'unknown-key', 'unknown-key'])
    expect(messages(result)).toContain("The workflow set 'schedule'")
    expect(messages(result)).toContain("Input 'issue' set 'kind'")
    expect(messages(result)).toContain("Step 'a' set 'retries'")
    expect(messages(result)).toContain("Step 'a' set 'childStep.timeout'")
  })

  it('drops the five keys nothing can ground', () => {
    const result = ground(workflow(
      [{
        name: 'a',
        after: [],
        prompt: 'Go.',
        model: 'claude-4',
        configOptions: { reasoning: 'high' },
        requiresRun: 'web',
        tools: { allow: ['bash'], maxRisk: 'write' },
        childStep: { prompt: 'Fix.', model: 'claude-4', tools: { allow: ['bash'] } },
      }],
      { trigger: 'on-push', tools: { allow: ['bash'], maxRisk: 'execute' } },
    ))
    expect(result.def.tools).toEqual({ maxRisk: 'execute' })
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.', tools: { maxRisk: 'write' }, childStep: { prompt: 'Fix.' } })
    expect(codes(result)).toEqual(Array<string>(8).fill('forbidden-key'))
    expect(messages(result)).toContain("The workflow set 'trigger'")
    expect(messages(result)).toContain('The workflow set `tools.allow`')
    expect(messages(result)).toContain("Step 'a' set 'childStep.model'")
  })

  it('drops a value the checker would walk into and trip over', () => {
    const result = ground(workflow([{ name: 'a', after: 'the first one', prompt: 'Go.' }], { inputs: 'the issue' }))
    expect(result.def.steps[0]).toEqual({ name: 'a', prompt: 'Go.' })
    expect(result.def.inputs).toBeUndefined()
    expect(codes(result)).toEqual(['unknown-key', 'unknown-key'])
  })
})

describe('step names', () => {
  const messy = workflow([
    { name: 'Read the issue', after: [], prompt: 'Read it.' },
    {
      name: 'Plan the work',
      kind: 'fan-out',
      after: ['Read the issue'],
      prompt: 'Plan from ${steps.Read the issue.output}.',
      schema: {},
      childStep: { prompt: 'Fix one, given ${steps.Read the issue.output}.' },
    },
    { name: 'collect', kind: 'join', after: ['Plan the work'], joins: 'Plan the work' },
    { name: 'pick', kind: 'decide', after: ['collect'], prompt: 'Again?', branches: { again: 'Plan the work', default: 'collect' } },
    { name: 'call', kind: 'http:request', after: ['collect'], with: { method: 'GET', url: 'https://example.com/${steps.Read the issue.output}' } },
  ])

  it('renames a step the editor could not, and rewrites every place its name is written', () => {
    // The checker never asks about the shape of a step name, so the repair pass would never be told.
    const result = ground(messy)
    const [read, plan, collect, pick, call] = result.def.steps
    expect(read?.name).toBe('read-the-issue')
    expect(plan?.name).toBe('plan-the-work')
    expect(plan?.after).toEqual(['read-the-issue'])
    expect(plan?.prompt).toBe('Plan from ${steps.read-the-issue.output}.')
    expect(plan?.childStep?.prompt).toBe('Fix one, given ${steps.read-the-issue.output}.')
    expect(collect?.joins).toBe('plan-the-work')
    expect(collect?.after).toEqual(['plan-the-work'])
    expect(pick?.branches).toEqual({ again: 'plan-the-work', default: 'collect' })
    expect(call?.with?.url).toBe('https://example.com/${steps.read-the-issue.output}')
    expect(codes(result)).toEqual(['renamed-step', 'renamed-step'])
    expect(messages(result)).toContain("Step 'Read the issue' is not a step name acorn can use, so it is now 'read-the-issue'.")
  })

  it('never takes a name another step already has', () => {
    const result = ground(workflow([
      { name: 'read-the-issue', after: [], prompt: 'One.' },
      { name: 'Read the issue', after: [], prompt: 'Two.' },
    ]))
    expect(result.def.steps.map((step) => step.name)).toEqual(['read-the-issue', 'read-the-issue-2'])
  })
})

describe('references that cannot resolve', () => {
  it('removes a reference to a step that does not exist', () => {
    const result = ground(workflow([
      { name: 'a', after: [], prompt: 'Go.' },
      { name: 'b', after: ['a'], prompt: 'Read ${steps.ghost.output} and answer.' },
    ]))
    expect(result.def.steps[1]?.prompt).toBe('Read  and answer.')
    expect(codes(result)).toEqual(['unknown-step-reference'])
    expect(messages(result)).toContain("Step 'b' referenced the step 'ghost'")
  })

  it('adds the edge to a real step this one does not wait for', () => {
    const result = ground(workflow([
      { name: 'a', after: [], prompt: 'Left.' },
      { name: 'b', after: [], prompt: 'Right.' },
      { name: 'c', after: ['a'], prompt: 'Read ${steps.b.output} too.' },
    ]))
    expect(result.def.steps[2]?.after).toEqual(['a', 'b'])
    expect(result.def.steps[2]?.prompt).toBe('Read ${steps.b.output} too.')
    expect(codes(result)).toEqual(['added-edge'])
  })

  it('removes a reference when the edge would close a loop', () => {
    const result = ground(workflow([
      { name: 'a', after: ['b'], prompt: 'Go.' },
      { name: 'b', after: [], prompt: 'Read ${steps.a.output} first.' },
      { name: 'c', after: ['a'], prompt: 'Read ${steps.c.output}.' },
    ]))
    expect(result.def.steps[1]?.prompt).toBe('Read  first.')
    expect(result.def.steps[1]?.after).toEqual([])
    expect(result.def.steps[2]?.prompt).toBe('Read .')
    expect(codes(result)).toEqual(['cyclic-reference', 'cyclic-reference'])
  })

  it('removes a token that is not a reference', () => {
    const result = ground(workflow([
      { name: 'a', after: [], prompt: 'Go.' },
      { name: 'b', after: ['a'], prompt: 'Read ${steps.a} and ${steps.a.result} and ${inputs.}.' },
    ]))
    expect(result.def.steps[1]?.prompt).toBe('Read  and  and .')
    expect(codes(result)).toEqual(['malformed-reference', 'malformed-reference', 'malformed-reference'])
  })

  it('declares an input a prompt reaches for', () => {
    const result = ground(workflow([
      { name: 'a', after: [], prompt: 'Work on ${inputs.issue}.' },
      { name: 'b', after: ['a'], prompt: 'Also ${inputs.issue}, and ${inputs.branch}.' },
    ]))
    expect(result.def.inputs).toEqual([{ name: 'issue' }, { name: 'branch' }])
    expect(result.def.steps[0]?.prompt).toBe('Work on ${inputs.issue}.')
    expect(codes(result)).toEqual(['declared-input', 'declared-input'])
    expect(messages(result)).toContain("Step 'a' referenced the input 'issue'")
  })

  it('reads the three places a reference works', () => {
    const result = ground(workflow([
      { name: 'a', after: [], prompt: 'Go.' },
      { name: 'b', after: [], kind: 'fan-out', prompt: 'Plan.', schema: {}, childStep: { prompt: 'Child of ${steps.a.output}.' } },
      { name: 'c', after: [], kind: 'http:request', with: { method: 'GET', url: 'https://example.com/${steps.a.output}' } },
    ]))
    expect(result.def.steps[1]?.after).toEqual(['a'])
    expect(result.def.steps[2]?.after).toEqual(['a'])
    expect(codes(result)).toEqual(['added-edge', 'added-edge'])
  })
})

describe('where grounding stops', () => {
  it('leaves the checker its own work', () => {
    // A duplicate name, a decide with no branches, a step waiting on a step that is not there, a
    // cycle and a widened budget are all things `validateWorkflow` says something useful about, and
    // the repair pass sends those messages back verbatim.
    const def = workflow(
      [
        { name: 'a', after: ['b'], prompt: 'One.', budget: { maxTurns: 90 } },
        { name: 'b', after: ['a', 'ghost'], prompt: 'Two.' },
        { name: 'a', after: [], prompt: 'Also called a.' },
        { name: 'pick', kind: 'decide', after: [] },
      ],
      { budget: { maxTurns: 4 } },
    )
    const result = ground(def)
    expect(result.notes).toEqual([])
    expect(JSON.stringify(result.def)).toBe(JSON.stringify(def))
  })
})

describe('the two properties that matter', () => {
  const wrong = workflow(
    [
      { name: 'Read the issue', after: [], kind: 'code-review', model: 'claude-4', with: { prompt: 'Read ${inputs.issue}.' } },
      { name: 'check', kind: 'gate-policy', after: ['Read the issue'], policy: 'all-green', retries: 2 },
      { name: 'call', kind: 'http:request', after: [], with: { method: 'GET', url: 'https://example.com', auth: {} } },
      { name: 'write-it-up', after: ['check'], profileId: 'gpt-9', prompt: 'Read ${steps.call.output} and ${steps.ghost.output}.', schema: 3 },
    ],
    { trigger: 'on-push', schedule: 'daily' },
  )

  it('grounds a grounded definition without a second note', () => {
    // The repair pass grounds a second answer through this same path.
    const once = ground(wrong)
    expect(once.notes.length).toBeGreaterThan(6)
    const twice = groundWorkflow(once.def, catalog)
    expect(twice.notes).toEqual([])
    expect(JSON.stringify(twice.def)).toBe(JSON.stringify(once.def))
  })

  for (const [index, example] of BUILTIN_EXAMPLES.entries()) {
    it(`leaves a clean definition untouched, key for key (example ${index + 1})`, () => {
      // The editor's dirty flag compares definitions, so a grounding that reorders or adds a key
      // would make every generated draft look edited.
      const result = ground(example.def)
      expect(result.notes).toEqual([])
      expect(JSON.stringify(result.def, null, 2)).toBe(JSON.stringify(example.def, null, 2))
    })
  }
})
