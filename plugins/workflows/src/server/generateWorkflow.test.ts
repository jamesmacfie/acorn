import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import type { StepKindDescription, WorkflowCatalog, WorkflowDef } from '../shared/workflowContracts'
import { BUILTIN_STEP_DESCRIPTIONS } from '../shared/stepFields'
import { BUILTIN_STEP_KINDS, BUILTIN_STEP_VALIDATORS } from './workflowBuiltins'
import { validateWorkflow, type WorkflowValidationCatalog } from './workflowValidation'
import {
  BUILTIN_EXAMPLES,
  buildGenerateSystemPrompt,
  buildGenerateUserPrompt,
  buildRepairUserPrompt,
  catalogValidation,
  GENERATE_MAX_CONCEPT_CHARS,
  GENERATE_MAX_EXAMPLE_SIZE,
  GENERATE_MAX_FIELD_OPTIONS,
  GENERATE_MAX_PROFILES,
  GENERATE_MAX_REPAIR_PROBLEMS,
  GENERATE_MAX_SYSTEM_CHARS,
  renderStepKinds,
  renderVocabulary,
  selectExamples,
  type WorkflowExample,
} from './generateWorkflow'

// The prompt is the product here, so these are assertions about what a model is told, not about how
// the strings are built. The catalog is a fixture rather than a runner, because the module is pure.

// Twenty is over the twelve-option cap, which is what makes the third degradation step observable.
const manyOptions = Array.from({ length: 20 }, (_, index) => ({ value: `region-${index}`, label: `Region ${index}` }))

const httpKind: StepKindDescription = {
  label: 'HTTP request',
  description: 'One HTTP request through the project variables.',
  fields: [
    { id: 'method', label: 'Method', type: 'select', required: true, options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }] },
    { id: 'url', label: 'URL', type: 'text', required: true, hint: 'Interpolated before the scheme check.' },
    { id: 'region', label: 'Region', type: 'select', options: manyOptions },
  ],
}

const builtinKinds = BUILTIN_STEP_KINDS.map((id) => ({ id, pluginId: null, describe: BUILTIN_STEP_DESCRIPTIONS[id] ?? null }))

const catalog = (over: Partial<WorkflowCatalog> = {}): WorkflowCatalog => ({
  kinds: [...builtinKinds, { id: 'http:request', pluginId: 'http', describe: httpKind }],
  policies: [{ id: 'checks-green', pluginId: null }],
  profiles: [{ id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: true }],
  ...over,
})

// The runner's own catalog carries each kind's validator; a pure one cannot. The built-in examples
// are checked against the full thing, because a shipped example must pass every rule.
const validation = (over: Partial<WorkflowCatalog> = {}): WorkflowValidationCatalog => ({
  ...catalogValidation(catalog(over)),
  validateStepKind: (kind, step, context) => BUILTIN_STEP_VALIDATORS[kind as (typeof BUILTIN_STEP_KINDS)[number]]?.(step, context) ?? [],
})

const prompt = (over: Partial<WorkflowCatalog> = {}) => buildGenerateSystemPrompt({ catalog: catalog(over) })

const chain = (name: string, steps = 3): WorkflowDef => ({
  name,
  steps: Array.from({ length: steps }, (_, index) => ({ name: `step-${index + 1}`, prompt: 'Do the thing.' })),
})

const fanIn = (name: string): WorkflowDef => ({
  name,
  steps: [
    { name: 'left', after: [], prompt: 'Look from the left.' },
    { name: 'right', after: [], prompt: 'Look from the right.' },
    { name: 'both', after: ['left', 'right'], prompt: 'Read both.' },
  ],
})

describe('the output contract', () => {
  it('asks for one JSON object and forbids a fence', () => {
    const text = prompt()
    expect(text).toContain('Answer with one JSON object and nothing else.')
    expect(text).toContain('No code fence')
    expect(text).toContain('JSON.parse')
  })

  it('teaches the graph rules a model cannot guess', () => {
    const text = prompt()
    expect(text).toContain('`after` is the whole graph.')
    expect(text).toContain('every ready step starts at once')
    expect(text).toContain('waits for the step written before it in the list')
    expect(text).toContain('needs no references at all')
  })

  it('forbids the five keys nothing can ground', () => {
    const text = prompt()
    for (const key of ['trigger', 'tools.allow', 'model', 'configOptions', 'requiresRun']) expect(text).toContain(key)
    expect(text).toContain('Write no key that this prompt does not name.')
  })

  it('stays under the runtime ceiling, and section 2 stays under its own', () => {
    expect(prompt().length).toBeLessThanOrEqual(GENERATE_MAX_SYSTEM_CHARS)
    const concepts = prompt().slice(prompt().indexOf('## 2.'), prompt().indexOf('## 3.'))
    expect(concepts.length).toBeLessThanOrEqual(GENERATE_MAX_CONCEPT_CHARS)
  })
})

describe('the two kind spellings', () => {
  it('renders a built-in as a bare word with named keys and no with', () => {
    const text = renderStepKinds(catalog())
    expect(text).toContain('### `agent`')
    expect(text).toContain('- `prompt` (prompt).')
    expect(text).toContain('- `joins` (select, required).')
    expect(text).not.toContain('- `with.prompt`')
  })

  it('renders a contributed kind namespaced with everything in with', () => {
    const text = renderStepKinds(catalog())
    expect(text).toContain('### `http:request`')
    expect(text).toContain('Contributed by the http plugin')
    expect(text).toContain('- `with.url` (text, required).')
    expect(text).toContain('- `with.method` (one of GET, POST, required).')
  })

  it('keeps the forbidden keys out of a built-in field list', () => {
    const text = renderStepKinds(catalog())
    expect(text).not.toContain('`requiresRun`')
    expect(text).not.toContain('`childStep.model`')
    expect(text).toContain('`childStep.profileId`')
  })

  it('says what to do with a kind that ships no description', () => {
    const text = renderStepKinds(catalog({ kinds: [{ id: 'odd:thing', pluginId: 'odd', describe: null }] }))
    expect(text).toContain('### `odd:thing`')
    expect(text).toContain('ships no description')
  })
})

describe('the kind list comes from the catalog', () => {
  // The point of generating this section: a plugin that adds a kind gets it into the prompt without
  // anybody editing generateWorkflow.ts.
  it('carries a kind nobody wrote into the prompt, with its with keys', () => {
    const extra = {
      id: 'deploy:ship',
      pluginId: 'deploy',
      describe: {
        label: 'Ship it',
        description: 'Deploy the branch.',
        fields: [{ id: 'environment', label: 'Environment', type: 'select' as const, required: true, options: [{ value: 'staging', label: 'Staging' }] }],
      },
    }
    const before = prompt()
    const after = prompt({ kinds: [...catalog().kinds, extra] })
    expect(before).not.toContain('deploy:ship')
    expect(after).toContain('### `deploy:ship`')
    expect(after).toContain('- `with.environment` (one of staging, required).')
  })
})

describe('the kind section degrades rather than dropping a kind', () => {
  const cat = catalog()
  const every = (text: string) => cat.kinds.every((kind) => text.includes(`\`${kind.id}\``))

  const full = renderStepKinds(cat, 1_000_000)
  const noHints = renderStepKinds(cat, full.length - 1)
  const noDescriptions = renderStepKinds(cat, noHints.length - 1)
  const cappedOptions = renderStepKinds(cat, noDescriptions.length - 1)
  const oneLine = renderStepKinds(cat, cappedOptions.length - 1)

  it('drops the field hints first', () => {
    expect(full).toContain('Interpolated before the scheme check.')
    expect(noHints).not.toContain('Interpolated before the scheme check.')
    expect(noHints).toContain('One HTTP request through the project variables.')
  })

  it('drops the kind descriptions second', () => {
    expect(noDescriptions).not.toContain('One HTTP request through the project variables.')
    expect(noDescriptions).toContain('- `with.url` (text, required).')
  })

  it('caps a long list of values third', () => {
    expect(noDescriptions).toContain('region-19')
    expect(cappedOptions).not.toContain('region-19')
    expect(cappedOptions).toContain(`region-${GENERATE_MAX_FIELD_OPTIONS - 1}`)
    expect(cappedOptions).toContain(`and ${manyOptions.length - GENERATE_MAX_FIELD_OPTIONS} more`)
  })

  it('falls back to one line a kind, and never fewer kinds', () => {
    expect(oneLine).toContain('- `agent`, Ask an agent: prompt, schema')
    expect(oneLine).toContain('- `http:request`, HTTP request: with.method, with.url, with.region')
    for (const text of [full, noHints, noDescriptions, cappedOptions, oneLine]) expect(every(text)).toBe(true)
    // The last step is the last step: an impossible budget still lists every kind.
    expect(every(renderStepKinds(cat, 1))).toBe(true)
  })
})

describe('policies and profiles come from the catalog too', () => {
  it('names the policies, and refuses gate-policy when there are none', () => {
    expect(renderVocabulary(catalog())).toContain('`checks-green`')
    expect(renderVocabulary(catalog({ policies: [] }))).toContain('do not write a `gate-policy` step')
  })

  it('says a decide needs no profileId when the default is structured', () => {
    expect(renderVocabulary(catalog())).toContain('The default has one, so a `decide` step')
  })

  it('names the structured profiles when the default is not one', () => {
    const text = renderVocabulary(catalog({
      profiles: [
        { id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: false },
        { id: 'codex', label: 'Codex', managed: true, structured: true },
      ],
    }))
    expect(text).toContain('the default has none')
    expect(text).toContain('`codex`')
  })

  it('refuses decide outright when no profile has a structured mode', () => {
    const text = renderVocabulary(catalog({ profiles: [{ id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: false }] }))
    expect(text).toContain('do not write a')
    expect(text).toContain('`decide` step.')
  })

  it('caps a long profile list, keeping the default and the structured ones', () => {
    const profiles = [
      ...Array.from({ length: 60 }, (_, index) => ({ id: `p-${index}`, label: `Profile ${index}`, managed: false, structured: false })),
      { id: DEFAULT_PROFILE_ID, label: 'Claude Code', managed: true, structured: true },
    ]
    const text = renderVocabulary(catalog({ profiles }))
    expect(text).toContain(DEFAULT_PROFILE_ID)
    expect(text).toContain(`${profiles.length - GENERATE_MAX_PROFILES} more`)
    expect(text.length).toBeLessThanOrEqual(4_000)
  })
})

describe('the built-in worked examples', () => {
  it('ships two, and both pass the checker they teach', () => {
    expect(BUILTIN_EXAMPLES).toHaveLength(2)
    for (const example of BUILTIN_EXAMPLES) expect(validateWorkflow(example.def, validation())).toEqual([])
  })

  it('shows the motivating case: two roots, a fan-in, and a gate', () => {
    const first = BUILTIN_EXAMPLES[0]!.def
    expect(first.steps.filter((step) => step.after?.length === 0)).toHaveLength(2)
    expect(first.steps.some((step) => (step.after?.length ?? 0) > 1)).toBe(true)
    expect(first.steps.some((step) => step.kind === 'gate-human')).toBe(true)
  })

  it('shows a fan-out, its join, and a decision with a default branch', () => {
    const second = BUILTIN_EXAMPLES[1]!.def
    const kinds = second.steps.map((step) => step.kind)
    expect(kinds).toContain('fan-out')
    expect(kinds).toContain('join')
    const decide = second.steps.find((step) => step.kind === 'decide')
    expect(Object.keys(decide?.branches ?? {})).toContain('default')
  })
})

describe('the workspace examples', () => {
  const example = (id: string, def: WorkflowDef): WorkflowExample => ({ id, def })
  const select = (examples: readonly WorkflowExample[], over: Partial<Parameters<typeof selectExamples>[0]> = {}) =>
    selectExamples({ examples, validation: validation(), ...over })

  it('puts a fan-in in front of a chain', () => {
    const { include } = select([example('a', chain('a chain')), example('b', fanIn('a fan-in'))])
    expect(include.map((entry) => entry.id)).toEqual(['b', 'a'])
  })

  it('leaves out the definition being edited, a one-step definition, and anything that fails the checker', () => {
    const broken: WorkflowDef = { name: 'broken', steps: [{ name: 'a', after: ['ghost'] }, { name: 'b' }] }
    const { include, omit } = select(
      [example('self', fanIn('being edited')), example('tiny', { name: 'tiny', steps: [{ name: 'only' }] }), example('broken', broken), example('keep', chain('keeper'))],
      { excludeId: 'self' },
    )
    expect(include.map((entry) => entry.id)).toEqual(['keep'])
    expect(omit).toEqual([])
  })

  it('takes at most four, and names what did not fit', () => {
    const many = Array.from({ length: 7 }, (_, index) => example(`e-${index}`, chain(`chain ${index}`)))
    const { include, omit } = select(many)
    expect(include).toHaveLength(4)
    expect(omit).toHaveLength(3)
    const text = buildGenerateSystemPrompt({ catalog: catalog(), examples: many, validation: validation() })
    expect(text).toContain('3 more definitions here did not fit:')
    for (const entry of omit) expect(text).toContain(entry.def.name)
  })

  it('drops a whole example rather than cutting one in half', () => {
    const huge: WorkflowDef = { name: 'enormous', steps: [{ name: 'a', prompt: 'x'.repeat(GENERATE_MAX_EXAMPLE_SIZE) }, { name: 'b', prompt: 'go' }] }
    const examples = [example('huge', huge), example('small', fanIn('small'))]
    const text = buildGenerateSystemPrompt({ catalog: catalog(), examples, validation: validation() })
    expect(text).not.toContain('x'.repeat(200))
    expect(text).toContain(JSON.stringify(select(examples).include[0]!.def, null, 2))
  })

  it('strips credentials and the loader bookkeeping from an example', () => {
    const def = {
      id: 'repo:thing',
      source: 'repo',
      name: 'calls out',
      steps: [
        { name: 'call', kind: 'http:request', with: { method: 'GET', url: 'https://example.com', headers: { Authorization: 'Bearer sk-secret' }, auth: 'sk-secret' } },
        { name: 'read', after: ['call'], prompt: 'Read it.' },
      ],
    } as unknown as WorkflowDef
    const { include } = select([example('x', def)])
    const rendered = JSON.stringify(include[0]!.def)
    expect(rendered).not.toContain('sk-secret')
    expect(rendered).not.toContain('repo:thing')
    expect(rendered).toContain('https://example.com')
  })

  it('leaves every fixed section and both built-in examples standing when nothing fits', () => {
    const text = buildGenerateSystemPrompt({ catalog: catalog(), examples: [example('a', fanIn('a'))], validation: validation(), exampleBudget: 0 })
    expect(text).not.toContain('## 8.')
    for (const heading of ['## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.']) expect(text).toContain(heading)
    for (const builtin of BUILTIN_EXAMPLES) expect(text).toContain(JSON.stringify(builtin.def, null, 2))
  })
})

describe('the user prompt', () => {
  it('carries the description and the draft it replaces', () => {
    const text = buildGenerateUserPrompt({
      description: 'Two agents look at one issue at once, a third writes it up.',
      name: 'Investigate',
      inputs: [{ name: 'issue', description: 'The issue', required: true }],
    })
    expect(text).toContain('Two agents look at one issue at once')
    expect(text).toContain('Its name is "Investigate".')
    expect(text).toContain('- `issue`, required. The issue')
    expect(text).toContain('Answer with the JSON object and nothing else.')
  })

  it('says nothing about a draft with no name and no inputs', () => {
    const text = buildGenerateUserPrompt({ description: 'Anything.' })
    expect(text).not.toContain('It replaces a draft')
  })

  it('holds the description to the shared cap', () => {
    const text = buildGenerateUserPrompt({ description: 'z'.repeat(20_000) })
    expect(text).not.toContain('z'.repeat(8_001))
  })
})

describe('the repair prompt', () => {
  const args = {
    userPrompt: 'Write the workflow definition for this description.\n\nFix the build.',
    def: fanIn('half right'),
    notes: [{ code: 'unknown-kind' as const, message: "step 'review' had unknown kind 'code-review', so it is an agent step now" }],
    problems: ['step \'both\' references \'left\', which is not one of its predecessors'],
  }

  it('restates the goal, the definition, what was removed, and every checker message', () => {
    const text = buildRepairUserPrompt(args)
    expect(text.startsWith(args.userPrompt)).toBe(true)
    expect(text).toContain(JSON.stringify(args.def, null, 2))
    expect(text).toContain('Do not put them back')
    expect(text).toContain(args.notes[0]!.message)
    expect(text).toContain(args.problems[0]!)
    expect(text).toContain('Keep every step,')
  })

  it('says nothing about removals when nothing was removed', () => {
    expect(buildRepairUserPrompt({ ...args, notes: [] })).not.toContain('Do not put them back')
  })

  it('caps the problem list and says how many it left out', () => {
    const problems = Array.from({ length: 55 }, (_, index) => `problem number ${index}`)
    const text = buildRepairUserPrompt({ ...args, problems })
    expect(text).toContain(`problem number ${GENERATE_MAX_REPAIR_PROBLEMS - 1}`)
    expect(text).not.toContain(`problem number ${GENERATE_MAX_REPAIR_PROBLEMS}`)
    expect(text).toContain(`and ${problems.length - GENERATE_MAX_REPAIR_PROBLEMS} more of the same kind.`)
  })
})
