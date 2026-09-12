import { describe, expect, it } from 'vitest'
import { BUILTIN_POLICIES, BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from './workflowBuiltins'
import { renderWith, resolveWorkflowInputs, validateWorkflow, workflowEdges, type WorkflowValidationCatalog } from './workflowValidation'
import type { WorkflowDef } from '../shared/workflowContracts'

// The graph rules `after` brought with it (docs/workflows.md § Execution model). The parser is tested
// in apps/node/test/integration/plugins/workflowFiles.test.ts and the runner beside it.

const catalog: WorkflowValidationCatalog = {
  stepKinds: new Set<string>(BUILTIN_STEP_KINDS),
  policies: new Set<string>(BUILTIN_POLICIES),
  profiles: new Set(['claude-code']),
  structuredProfiles: new Set(['claude-code']),
  validateStepKind: (kind, step, context) =>
    BUILTIN_STEP_VALIDATORS[kind as (typeof BUILTIN_STEP_KINDS)[number]]?.(step, context) ?? [],
}

const check = (def: WorkflowDef) => validateWorkflow({ ...def, steps: def.steps.map((step) => ({ profileId: 'claude-code', ...step })) }, catalog)

describe('a draft in progress', () => {
  // The editor creates a definition with no steps and draws what this reports in its footer. Storing
  // it is fine; `WorkflowRunner.start` is what refuses to run it (plugins/workflows/src/node/index.ts).
  it('reports a definition with no steps rather than being a shape the store refuses', () => {
    expect(check({ name: 'Untitled workflow', steps: [] })).toEqual(['workflow has no steps'])
  })
})

describe('the derived graph', () => {
  it('reads an absent after as the step before it, and an empty one as a root', () => {
    const edges = workflowEdges([{ name: 'a' }, { name: 'b' }, { name: 'c', after: [] }, { name: 'd', after: ['a', 'c'] }])
    expect([...edges]).toEqual([['a', []], ['b', ['a']], ['c', []], ['d', ['a', 'c']]])
  })

  it('names the cycle it found', () => {
    const problems = check({ name: 'loop', steps: [{ name: 'a', after: ['b'] }, { name: 'b', after: ['a'] }] })
    expect(problems.join('\n')).toContain('has a cycle: a → b → a')
  })

  it('refuses an after that names an unknown step or the step itself', () => {
    const problems = check({ name: 'w', steps: [{ name: 'a', after: ['ghost'] }, { name: 'b', after: ['b'] }] })
    expect(problems).toContain("step 'a' waits on unknown step 'ghost'")
    expect(problems).toContain("step 'b' waits on itself")
  })
})

describe('template references follow the graph, not the list', () => {
  it('refuses a reference to a step that is not a predecessor', () => {
    // `later` is declared after `first`, so it can never have run.
    const problems = check({ name: 'w', steps: [{ name: 'first', prompt: '${steps.later.output}' }, { name: 'later' }] })
    expect(problems.join('\n')).toContain("references 'later', which is not one of its predecessors")
  })

  it('refuses a reference to a parallel sibling', () => {
    const problems = check({
      name: 'w',
      steps: [
        { name: 'left', after: [] },
        { name: 'right', after: [], prompt: 'Read ${steps.left.output}' },
      ],
    })
    expect(problems.join('\n')).toContain("references 'left', which is not one of its predecessors")
  })

  it('accepts a reference to a predecessor two edges back', () => {
    expect(check({
      name: 'w',
      steps: [
        { name: 'one', after: [] },
        { name: 'two', after: ['one'] },
        { name: 'three', after: ['two'], prompt: '${steps.one.output}' },
      ],
    })).toEqual([])
  })

  it('checks a with table one level deep', () => {
    const problems = check({
      name: 'w',
      steps: [{ name: 'call', kind: 'agent', with: { url: '${steps.ghost.output}/x', retries: 3 } }],
    })
    expect(problems.join('\n')).toContain("invalid template reference 'ghost'")
  })
})

describe('inputs', () => {
  it('refuses a reference to an input the definition does not declare', () => {
    const problems = check({ name: 'w', inputs: [{ name: 'issue' }], steps: [{ name: 'a', prompt: '${inputs.issue} ${inputs.focus}' }] })
    expect(problems).toEqual(["step 'a' references undeclared input 'focus'"])
  })

  it('refuses a malformed input name and a malformed reference', () => {
    const problems = check({ name: 'w', inputs: [{ name: '2bad' }], steps: [{ name: 'a', prompt: '${inputs.}' }] })
    expect(problems.join('\n')).toContain("input 1 has an invalid name '2bad'")
    expect(problems.join('\n')).toContain("invalid template expression '${inputs.}'")
  })

  it('fills a default, keeps a supplied value, and refuses what it cannot resolve', () => {
    const def: WorkflowDef = {
      name: 'w',
      inputs: [{ name: 'issue', required: true }, { name: 'focus', default: 'anything' }],
      steps: [{ name: 'a' }],
    }
    expect(resolveWorkflowInputs(def, { issue: 'It crashes' })).toEqual({ issue: 'It crashes', focus: 'anything' })
    expect(() => resolveWorkflowInputs(def, {})).toThrow("needs a value for input 'issue'")
    expect(() => resolveWorkflowInputs(def, { issue: 'x', other: 'y' })).toThrow("has no input 'other'")
  })

  it('substitutes into a with table, leaving anything that is not a string alone', () => {
    expect(renderWith({ command: 'echo ${inputs.issue}', timeoutMs: 5 }, [], { issue: 'hi' }))
      .toEqual({ command: 'echo hi', timeoutMs: 5 })
  })
})

describe('the agent-only fields', () => {
  it('refuses isolation on a gate', () => {
    expect(check({ name: 'w', steps: [{ name: 'ok?', kind: 'gate-human', isolation: 'worktree' }] }))
      .toEqual(["step 'ok?' is a 'gate-human' step, which cannot take isolation"])
  })

  it('refuses a step that sets both model and config_options.model', () => {
    const problems = check({ name: 'w', steps: [{ name: 'a', model: 'opus', configOptions: { model: 'sonnet' } }] })
    expect(problems.join('\n')).toContain('sets both model and config_options.model')
  })

  it('accepts isolation, the inputs mode and config options on an agent step', () => {
    expect(check({ name: 'w', steps: [{ name: 'a', isolation: 'worktree', inputs: 'none', configOptions: { reasoning: 'high' } }] })).toEqual([])
  })
})

describe('decide and join under the graph rule', () => {
  it('accepts the plain list a file written before the graph used', () => {
    expect(check({
      name: 'w',
      steps: [
        { name: 'route', kind: 'decide', branches: { yes: 'yes', no: 'no' } },
        { name: 'yes' },
        { name: 'no' },
      ],
    })).toEqual([])
  })

  it('refuses a branch target that does not wait on the decision', () => {
    const problems = check({
      name: 'w',
      steps: [
        { name: 'beside', after: [] },
        { name: 'route', kind: 'decide', after: [], branches: { yes: 'beside' } },
      ],
    })
    expect(problems.join('\n')).toContain("target 'beside' does not wait on step 'route'")
  })

  it('refuses a join whose fan-out is not one of its predecessors', () => {
    const problems = check({
      name: 'w',
      steps: [
        { name: 'plan', kind: 'fan-out', after: [], childStep: { name: 'child' } },
        { name: 'gather', kind: 'join', after: [], joins: 'plan' },
      ],
    })
    expect(problems.join('\n')).toContain("joins 'plan', which is not a preceding fan-out")
  })
})
