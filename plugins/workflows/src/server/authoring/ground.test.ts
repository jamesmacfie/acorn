import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import type { StepKindDescription, WorkflowCatalog, WorkflowDef } from '../../shared/workflowContracts'
import { BUILTIN_EXAMPLES } from './generate'
import { BUILTIN_STEP_KINDS } from '../steps/builtins'
import { extractJsonObject, groundWorkflow, parseGeneratedWorkflow, stripJsonFences, type GroundedWorkflow } from './ground'

// One test per row of the grounding table, driven from a fixture catalog: the module is pure, so
// none of this needs a runner, a provider or a database.

// The real `http:request` fields, `auth` and `vars` deliberately absent, so the known false positive
// below is pinned against the shape it actually has (../../../../http/src/server/workflowStep.ts).
const httpKind: StepKindDescription = {
  label: 'Call an HTTP endpoint',
  description: 'Call an HTTP endpoint.', icon: 'globe', output: { description: 'HTTP response.' },
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
  ({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Investigate', ...over, steps })

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
    const result = ground(workflow([{ name: 'a', after: [], profileId: 'gpt-9', prompt: 'Go.' }]))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.' })
    expect(codes(result)).toEqual(['unknown-profile'])
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
    const result = ground(workflow([{ name: 'a', after: [], prompt: 'Go.', schema: 'a JSON schema' }]))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.' })
    expect(codes(result)).toEqual(['dropped-schema'])
  })
})

describe('child workflow grounding', () => {
  const target = {
    ref: { source: 'database' as const, id: 'review-workflow' },
    name: 'Review ticket',
    inputs: [{ name: 'ticket', required: true }],
  }
  const withTarget: WorkflowCatalog = {
    ...catalog,
    kinds: [
      ...catalog.kinds,
      { id: 'workflow', pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS.workflow },
      { id: 'workflow-map', pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS['workflow-map'] },
    ],
    workflows: [target],
  }
  const grounded = (steps: unknown[], inputs?: WorkflowDef['inputs']) =>
    groundWorkflow({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Parent', inputs, steps } as WorkflowDef, withTarget)

  it('drops a target that the scoped catalog does not offer', () => {
    const result = grounded([{ name: 'child', kind: 'workflow', childWorkflow: { ref: { source: 'database', id: 'invented' } } }])
    expect(result.def.steps[0]?.childWorkflow).toBeUndefined()
    expect(codes(result)).toContain('unknown-workflow')
  })

  it('drops every generated target when the scoped catalog is empty', () => {
    const result = groundWorkflow({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'Parent',
      steps: [{
        name: 'child',
        kind: 'workflow',
        childWorkflow: { ref: target.ref },
      }],
    }, { ...withTarget, workflows: [] })
    expect(result.def.steps[0]?.childWorkflow).toBeUndefined()
    expect(codes(result)).toContain('unknown-workflow')
  })

  it('drops undeclared and unsupported bindings but keeps a valid parent input binding', () => {
    const result = grounded([{
      name: 'child',
      kind: 'workflow',
      childWorkflow: {
        ref: target.ref,
        inputs: {
          ticket: { from: 'input', name: 'ticket' },
          extra: { from: 'literal', value: 'x' },
          item: { from: 'item', pointer: '/number' },
        },
      },
    }], [{ name: 'ticket', required: true }])
    expect(result.def.steps[0]?.childWorkflow?.inputs).toEqual({ ticket: { from: 'input', name: 'ticket' } })
    expect(codes(result).filter((code) => code === 'unsupported-binding')).toHaveLength(2)
  })

  it('drops map sources and step bindings that do not name a structured predecessor', () => {
    const result = grounded([
      { name: 'plain', after: [], prompt: 'Answer in prose.' },
      {
        name: 'children',
        kind: 'workflow-map',
        after: ['plain'],
        items: { step: 'plain', pointer: '/tickets' },
        itemKey: '/id',
        childWorkflow: { ref: target.ref, inputs: { ticket: { from: 'step', step: 'plain', pointer: '/ticket' } } },
        title: { template: 'Review ${ticket}', bindings: { ticket: { from: 'step', step: 'plain', pointer: '/ticket' } } },
      },
    ])
    expect(result.def.steps[1]?.items).toBeUndefined()
    expect(result.def.steps[1]?.childWorkflow?.inputs).toBeUndefined()
    expect(result.def.steps[1]?.title?.bindings).toBeUndefined()
  })

})

describe('keys outside the vocabulary', () => {
  it('drops keys that are not part of a workflow, step, or input', () => {
    const result = ground(workflow(
      [{ name: 'a', after: [], prompt: 'Go.', retries: 2, childStep: { prompt: 'Fix.', timeout: 5 } }],
      { schedule: 'daily', inputs: [{ name: 'issue', kind: 'text' }] },
    ))
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.' })
    expect(result.def.inputs).toEqual([{ name: 'issue' }])
    expect(codes(result)).toEqual(['unknown-key', 'unknown-key', 'unknown-key', 'unknown-key'])
    expect(messages(result)).toContain("The workflow set 'schedule'")
    expect(messages(result)).toContain("Input 'issue' set 'kind'")
    expect(messages(result)).toContain("Step 'a' set 'retries'")
    expect(messages(result)).toContain("Step 'a' set 'childStep'")
  })

  it('drops protected execution keys', () => {
    const result = ground(workflow(
      [{
        name: 'a',
        after: [],
        prompt: 'Go.',
        model: 'claude-4',
        configOptions: { reasoning: 'high' },
        requiresRun: 'web',
        tools: { allow: ['bash'], maxRisk: 'write' },
      }],
      { trigger: 'on-push', tools: { allow: ['bash'], maxRisk: 'execute' } },
    ))
    expect(result.def.tools).toEqual({ maxRisk: 'execute' })
    expect(result.def.steps[0]).toEqual({ name: 'a', after: [], prompt: 'Go.', tools: { maxRisk: 'write' } })
    expect(codes(result)).toEqual(Array<string>(6).fill('forbidden-key'))
    expect(messages(result)).toContain("The workflow set 'trigger'")
    expect(messages(result)).toContain('The workflow set `tools.allow`')
  })

  it('drops a value the checker would walk into and trip over', () => {
    const result = ground(workflow([{ name: 'a', after: 'the first one', prompt: 'Go.' }], { inputs: 'the issue' }))
    expect(result.def.steps[0]).toEqual({ name: 'a', prompt: 'Go.' })
    expect(result.def.inputs).toBeUndefined()
    expect(codes(result)).toEqual(['unknown-key', 'unknown-key'])
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

describe('a generated gate form', () => {
  const draft = { id: 'draft', name: 'draft', prompt: 'Draft it.', schema: { type: 'object', properties: { title: { type: 'string' } } } }
  const form = { fields: [{ name: 'title', schema: { type: 'string' }, required: true }], values: { title: { address: { from: 'step', stepId: 'draft', pointer: '/title' } } } }

  it('keeps a form that would load, and a later binding to its values', () => {
    const def = workflow([
      draft,
      { id: 'approve', name: 'approve', kind: 'gate-human', after: ['draft'], form },
    ])
    const result = ground(def)
    expect(result.notes).toEqual([])
    expect(result.def).toBe(def)
  })

  it('drops a form that would not load and keeps the gate', () => {
    const result = ground(workflow([
      draft,
      { id: 'approve', name: 'approve', kind: 'gate-human', after: ['draft'], form: { fields: [{ name: 'title' }] } },
    ]))
    expect(codes(result)).toEqual(['dropped-form'])
    expect(messages(result)).toContain('still waits for a person')
    expect((result.def as WorkflowDef).steps[1]).toEqual({ id: 'approve', name: 'approve', kind: 'gate-human', after: ['draft'] })
  })
})
