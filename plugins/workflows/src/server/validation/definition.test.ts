import { describe, expect, it } from 'vitest'
import { BUILTIN_POLICIES, BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from '../steps/builtins'
import { parseWorkflowJsonPointer, renderWith, resolveWorkflowInputs, validateWorkflow, workflowEdges, type WorkflowValidationCatalog } from './definition'
import type { WorkflowDef } from '../../shared/workflowContracts'

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

const check = (def: WorkflowDef) => validateWorkflow({
  ...def,
  baseline: 'acorn-1' as const,
  formatVersion: 1 as const,
  steps: def.steps.map((step, index) => ({
    id: step.id ?? (/^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(step.name) ? step.name : `step-${index + 1}`),
    profileId: 'claude-code',
    ...step,
  })),
}, catalog)

describe('a draft in progress', () => {
  it('names the plugin that must return before a saved kind can run', () => {
    expect(check({ baseline: 'acorn-1', formatVersion: 1, name: 'w', steps: [{ name: 'send', kind: 'mail:send' }] }))
      .toContain("step 'send' cannot run. Plugin 'mail' does not provide workflow step 'mail:send' on this node. Install, enable, or update the plugin to use this step.")
  })
  // The editor creates a definition with no steps and draws what this reports in its footer. Storing
  // it is fine; `WorkflowRunner.start` is what refuses to run it (plugins/workflows/src/node/index.ts).
  it('reports a definition with no steps rather than being a shape the store refuses', () => {
    expect(check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'Untitled workflow', steps: [] })).toEqual(['workflow has no steps'])
  })

  it('reports an obsolete definition format with an actionable diagnostic', () => {
    expect(validateWorkflow({ baseline: 'acorn-1', formatVersion: 2, name: 'Old workflow', steps: [{ name: 'work' }] } as unknown as WorkflowDef, catalog))
      .toContain('Incompatible workflow. Set formatVersion to 1 and baseline to acorn-1.')
  })
})

describe('the derived graph', () => {
  it('reads an absent after as the step before it, and an empty one as a root', () => {
    const edges = workflowEdges([{ name: 'a' }, { name: 'b' }, { name: 'c', after: [] }, { name: 'd', after: ['a', 'c'] }])
    expect([...edges]).toEqual([['a', []], ['b', ['a']], ['c', []], ['d', ['a', 'c']]])
  })

  it('names the cycle it found', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'loop', steps: [{ name: 'a', after: ['b'] }, { name: 'b', after: ['a'] }] })
    expect(problems.join('\n')).toContain('has a cycle: a → b → a')
  })

  it('refuses an after that names an unknown step or the step itself', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'a', after: ['ghost'] }, { name: 'b', after: ['b'] }] })
    expect(problems).toContain("step 'a' waits on unknown step 'ghost'")
    expect(problems).toContain("step 'b' waits on itself")
  })
})

describe('template references follow the graph, not the list', () => {
  it('refuses a reference to a step that is not a predecessor', () => {
    // `later` is declared after `first`, so it can never have run.
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'first', prompt: '${steps.later.output}' }, { name: 'later' }] })
    expect(problems.join('\n')).toContain("references 'later', which is not one of its predecessors")
  })

  it('refuses a reference to a parallel sibling', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [
        { name: 'left', after: [] },
        { name: 'right', after: [], prompt: 'Read ${steps.left.output}' },
      ],
    })
    expect(problems.join('\n')).toContain("references 'left', which is not one of its predecessors")
  })

  it('accepts a reference to a predecessor two edges back', () => {
    expect(check({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [
        { name: 'one', after: [] },
        { name: 'two', after: ['one'] },
        { name: 'three', after: ['two'], prompt: '${steps.one.output}' },
      ],
    })).toEqual([])
  })

  it('checks a with table one level deep', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [{ name: 'call', kind: 'agent', with: { url: '${steps.ghost.output}/x', retries: 3 } }],
    })
    expect(problems.join('\n')).toContain("invalid template reference 'ghost'")
  })
})

describe('inputs', () => {
  it('refuses a reference to an input the definition does not declare', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', inputs: [{ name: 'issue', schema: { type: 'string' } }], steps: [{ name: 'a', prompt: '${inputs.issue} ${inputs.focus}' }] })
    expect(problems).toEqual(["step 'a' references undeclared input 'focus'"])
  })

  it('refuses a malformed input name and a malformed reference', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', inputs: [{ name: '2bad' }], steps: [{ name: 'a', prompt: '${inputs.}' }] })
    expect(problems.join('\n')).toContain("input 1 has an invalid name '2bad'")
    expect(problems.join('\n')).toContain("invalid template expression '${inputs.}'")
  })

  it('fills a default, keeps a supplied value, and refuses what it cannot resolve', () => {
    const def: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
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

describe('runtime child workflow contracts', () => {
  it('accepts a single child and a mapped child whose bindings use declared sources', () => {
    const definition: WorkflowDef = { baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'parent',
      inputs: [{ name: 'ticket', schema: { type: 'string' } }],
      steps: [
        { name: 'select', after: [], schema: { type: 'object' } },
        {
          name: 'one',
          kind: 'workflow',
          after: ['select'],
          childWorkflow: {
            ref: { source: 'database', id: 'review' },
            inputs: {
              ticket: { address: { from: 'input', name: 'ticket', pointer: '' } },
              result: { address: { from: 'step', stepId: 'select', pointer: '/ticket' } },
            },
          },
        },
        {
          name: 'many',
          kind: 'workflow-map',
          after: ['select'],
          childWorkflow: {
            ref: { source: 'repo', path: '.acorn/workflows/review.toml' },
            inputs: { ticket: { address: { from: 'item', pointer: '/number' } } },
          },
          items: { step: 'select', pointer: '/tickets' },
          itemKey: '/id',
          title: { template: 'Review ${ticket}', bindings: { ticket: { address: { from: 'item', pointer: '/number' } } } },
        },
      ],
    }
    expect(check(definition)).toEqual([])
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition)
  })

  it('locates unsafe paths, undeclared inputs, and non-predecessor mappings', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'parent',
      steps: [
        { name: 'source', after: [] },
        {
          name: 'dispatch',
          kind: 'workflow-map',
          after: [],
          childWorkflow: {
            ref: { source: 'repo', path: '../review.toml' },
            inputs: {
              issue: { address: { from: 'input', name: 'missing', pointer: '' } },
              data: { address: { from: 'step', stepId: 'source', pointer: '/constructor/value' } },
            },
          },
          items: { step: 'source', pointer: '/tickets' },
          itemKey: 'id',
          title: { template: '${missing}' },
        },
      ],
    })
    expect(problems).toContain("step 'dispatch' child_workflow.ref.path must name a file under .acorn/workflows")
    expect(problems).toContain("step 'dispatch' child_workflow.inputs.issue references undeclared input 'missing'")
    expect(problems).toContain("step 'dispatch' child_workflow.inputs.data is not a valid typed binding")
    expect(problems).toContain("step 'dispatch' items references 'source', which is not one of its predecessors")
    expect(problems).toContain("step 'dispatch' item_key is not a safe JSON Pointer")
    expect(problems).toContain("step 'dispatch' title references undeclared binding 'missing'")
  })

  it('checks a child reference and its bindings against the scoped target catalog', () => {
    const scopedCatalog: WorkflowValidationCatalog = {
      ...catalog,
      workflowTargets: [{
        ref: { source: 'database', id: 'review' },
        name: 'Review ticket',
        inputs: [
          { name: 'ticket', required: true },
          { name: 'focus', required: true, hasDefault: true },
        ],
      }],
    }
    const validate = (def: WorkflowDef) => validateWorkflow(def, scopedCatalog)

    expect(validate({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'parent',
      steps: [{
        name: 'review',
        kind: 'workflow',
        childWorkflow: {
          ref: { source: 'database', id: 'review' },
          inputs: { extra: { from: 'literal', value: 'x' } },
        },
      }],
    })).toEqual(expect.arrayContaining([
      "step 'review' binds undeclared child input 'extra'",
      "step 'review' needs a binding for child input 'ticket'",
    ]))

    expect(validate({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'parent',
      steps: [{
        name: 'review',
        kind: 'workflow',
        childWorkflow: { ref: { source: 'database', id: 'invented' } },
      }],
    })).toContain("step 'review' child workflow is not available to this project")
  })

  it('parses pointers without evaluating or permitting prototype traversal', () => {
    expect(parseWorkflowJsonPointer('/tickets/0/a~1b/~0value')).toEqual(['tickets', '0', 'a/b', '~value'])
    expect(parseWorkflowJsonPointer('tickets')).toBeNull()
    expect(parseWorkflowJsonPointer('/tickets/~2')).toBeNull()
    expect(parseWorkflowJsonPointer('/__proto__/value')).toBeNull()
  })
})

describe('the agent-only fields', () => {
  it('refuses isolation on a gate', () => {
    expect(check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'ok?', kind: 'gate-human', isolation: 'worktree' }] }))
      .toEqual(["step 'ok?' is a 'gate-human' step, which cannot take isolation"])
  })

  it('refuses a step that sets both model and config_options.model', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'a', model: 'opus', configOptions: { model: 'sonnet' } }] })
    expect(problems.join('\n')).toContain('sets both model and config_options.model')
  })

  it('accepts isolation, the inputs mode and config options on an agent step', () => {
    expect(check({ baseline: 'acorn-1' as const, formatVersion: 1 as const, name: 'w', steps: [{ name: 'a', isolation: 'worktree', inputs: 'none', configOptions: { reasoning: 'high' } }] })).toEqual([])
  })
})

describe('decide and join under the graph rule', () => {
  it('accepts the plain list a file written before the graph used', () => {
    expect(check({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [
        { name: 'route', kind: 'decide', branches: { yes: 'yes', no: 'no' } },
        { name: 'yes' },
        { name: 'no' },
      ],
    })).toEqual([])
  })

  it('refuses a branch target that does not wait on the decision', () => {
    const problems = check({ baseline: 'acorn-1' as const, formatVersion: 1 as const,
      name: 'w',
      steps: [
        { name: 'beside', after: [] },
        { name: 'route', kind: 'decide', after: [], branches: { yes: 'beside' } },
      ],
    })
    expect(problems.join('\n')).toContain("target 'beside' does not wait on step 'route'")
  })

})

describe('the approval form on a human gate', () => {
  const draft = { id: 'draft', name: 'draft', prompt: 'Draft a note.', schema: { type: 'object', properties: { title: { type: 'string' } } } }
  const gate = (form: unknown, extra: Record<string, unknown> = {}) => ({ id: 'approve', name: 'approve', kind: 'gate-human', after: ['draft'], form, ...extra }) as never
  const title = { name: 'title', schema: { type: 'string' }, required: true }
  const fromDraft = { address: { from: 'step', stepId: 'draft', pointer: '/title' } }

  it('accepts typed fields bound to a predecessor, and lets a later step bind to the approved values', () => {
    expect(check({ name: 'W', steps: [
      draft,
      gate({ fields: [title, { name: 'notify', schema: { type: 'boolean' }, default: false }], values: { title: fromDraft } }),
      { id: 'ship', name: 'ship', kind: 'workflow', after: ['approve'], childWorkflow: { ref: { source: 'database', id: 'x' }, inputs: {
        title: { address: { from: 'step', stepId: 'approve', pointer: '/values/title' } },
      } } },
    ] } as never)).toEqual([])
  })

  it('refuses bad names, repeats, unknown bindings, bad defaults, and a form on another kind', () => {
    const problems = check({ name: 'W', steps: [
      draft,
      gate({ fields: [title, title, { name: '1bad', schema: { type: 'string' } }, { name: 'count', schema: { type: 'number' }, default: 'many' }], values: { missing: fromDraft } }),
      { id: 'other', name: 'other', kind: 'gate-policy', policy: 'checks-green', form: { fields: [title] } },
    ] } as never)
    expect(problems).toEqual(expect.arrayContaining([
      "step 'approve' form field 'title' is declared more than once",
      "step 'approve' form field 3 has an invalid name",
      expect.stringContaining("step 'approve' form field 'count':"),
      "step 'approve' form.values.missing does not name a declared field",
      "step 'other' is a 'gate-policy' step, which cannot take form",
    ]))
  })

  it('refuses a binding to a step that does not run first', () => {
    const problems = check({ name: 'W', steps: [
      { ...draft, after: [] },
      gate({ fields: [title], values: { title: fromDraft } }, { after: [] }),
    ] } as never)
    expect(problems).toContain("step 'approve' form.values.title references 'draft', which is not one of its predecessors")
  })

  it('refuses more fields than the cap, and a required field nobody fills under an autonomous posture', () => {
    const fields = Array.from({ length: 21 }, (_, index) => ({ name: `f${index}`, schema: { type: 'string' } }))
    expect(check({ name: 'W', steps: [draft, gate({ fields })] } as never)).toContain("step 'approve' form has 21 fields; the limit is 20")
    expect(check({ name: 'W', posture: 'autonomous', tools: { maxRisk: 'read' }, steps: [draft, gate({ fields: [title] })] } as never))
      .toContain("step 'approve' form field 'title' is required, and this workflow is autonomous, so nobody would be asked to fill it")
  })
})
