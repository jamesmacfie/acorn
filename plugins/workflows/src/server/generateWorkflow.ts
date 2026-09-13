// The prompt behind Generate in the workflow editor (docs/workflows.md § Authoring): what a model
// that has never heard of acorn has to be told before it can write a definition.
//
// Pure, like the database plugin's ./generateSql.ts and for the same reason: the contract with the
// model is the product here, so it has to be readable in a test rather than only visible in a live
// call. Nothing in this file does I/O. The orchestrator that spends a key is next door in
// ./generateWorkflowRequest.ts and the parser that reads the answer is in ./groundWorkflow.ts.
//
// Two rules shape everything below.
//
// The step-kind section is generated from the catalog at request time and never hand-maintained, so
// a plugin that contributes a kind gets it into the prompt for free. It also never drops a kind: the
// prompt's list IS the grounding list, and a kind in the catalog but missing from the prompt is one
// the model can never use and grounding will never strip. When it will not fit it degrades in place.
//
// The per-request half — the instruction and either replacement hints or the current definition —
// goes in the user prompt, so the system prompt is byte-identical across the first call, the repair
// call, and the next generate. A provider that caches prefixes then hits.

import { DEFAULT_PROFILE_ID } from '@acorn/plugin-api/node'
import type { WorkflowGenerateNote } from '../shared/api'
import { GENERATE_MAX_DESCRIPTION_CHARS } from '../shared/api'
import type { StepField, StepFieldOption, WorkflowCatalog, WorkflowDef, WorkflowInput } from '../shared/workflowContracts'
import { definitionForPrompt, type PromptWorkflowDef } from './editWorkflow'
import { renderWorkflowTargets } from './workflowTargetPrompt'
import { validateWorkflow, workflowEdges, type WorkflowValidationCatalog } from './workflowValidation'

export { renderWorkflowTargets } from './workflowTargetPrompt'

/** How much the model may write back. A definition with six well-written prompts is a big document,
 *  and an answer cut off mid-string is not JSON, so this is generous rather than tight. */
export const GENERATE_MAX_OUTPUT_TOKENS = 8_192

/** The ceiling on the whole system prompt.
 *
 *  Ten thousand under the model runtime's own `MAX_SYSTEM_CHARS`, because going over that is not a
 *  truncation: it throws `provider_bad_config` and answers 400. A node carrying a dozen
 *  kind-contributing plugins would otherwise turn every generate into an unexplained failure. */
export const GENERATE_MAX_SYSTEM_CHARS = 90_000

/** Section budgets, in assembly order. Only the last section can be dropped, so these are the sizes
 *  the sections in front of it are held to. The concepts budget is pinned by a test rather than
 *  applied: that section is fixed text and is never cut, so growing it past this is a decision
 *  somebody makes on purpose. */
export const GENERATE_MAX_CONCEPT_CHARS = 22_000
const GENERATE_MAX_KIND_CHARS = 24_000
const GENERATE_MAX_VOCABULARY_CHARS = 4_000
const GENERATE_MAX_EXAMPLE_CHARS = 24_000

/** Caps inside those budgets. A select with hundreds of options and a node with hundreds of profiles
 *  are both real, and neither teaches more at 300 entries than at 12. */
export const GENERATE_MAX_FIELD_OPTIONS = 12
export const GENERATE_MAX_PROFILES = 30
export const GENERATE_MAX_EXAMPLES = 4
export const GENERATE_MAX_EXAMPLE_SIZE = 6_000

/** How many validator messages the repair prompt carries. Forty is more than a definition worth
 *  repairing ever has, and it bounds a prompt built from a reply we did not write. */
export const GENERATE_MAX_REPAIR_PROBLEMS = 40

/** The keys nothing can check.
 *
 *  None of them appears in the catalog, so what the prompt cannot list, grounding cannot refute: a
 *  model name, a provider option or a run target the model invents would pass every validator and
 *  then fail at run time. They are forbidden here and stripped in ./groundWorkflow.ts.
 *
 *  `requiresRun` is also a described field of the built-in `agent` kind, so the generated section
 *  below filters it out. That filter is derived from this list rather than written out again: a key
 *  added here has to vanish from the field lists too, and a second list is a second place to forget.
 *  A field whose last dotted part is forbidden goes with it, which is what keeps `childStep.model`
 *  out of a prompt that has just said never to write `model`. */
export const FORBIDDEN_KEYS = ['trigger', 'tools.allow', 'model', 'configOptions', 'requiresRun'] as const

const FORBIDDEN_FIELD_IDS = new Set<string>(FORBIDDEN_KEYS.flatMap((key) => [key, key.split('.').pop() ?? key]))
const isForbiddenField = (id: string): boolean => FORBIDDEN_FIELD_IDS.has(id) || FORBIDDEN_FIELD_IDS.has(id.split('.').pop() ?? id)

// --- 1. the role and the output contract ---

const SECTION_ROLE = [
  '# Writing an acorn workflow',
  '',
  'You write acorn workflow definitions.',
  '',
  'A workflow is a graph of steps that acorn runs against one repository checkout. Most steps are an',
  'agent given a prompt, and the interesting ones run at the same time as each other. Somebody',
  'describes what they want in words. You answer with the definition.',
  '',
  // Numbered like the rest, because the sections below cross-reference each other by number and a
  // document that opens at 2 reads as one with a page missing.
  '## 1. Your answer',
  '',
  'Answer with one JSON object and nothing else. No code fence, no prose in front of it, no prose',
  'after it, no comments, no trailing commas. The whole reply has to pass JSON.parse.',
].join('\n')

// --- 2. what a workflow is ---
//
// The section that does the teaching. Everything in it is something the model cannot guess: the
// graph comes from `after` alone, an omitted `after` means the step before, ready steps all start at
// once, and `append` is why a synthesiser needs no references. Fixed text, never cut.

const SECTION_CONCEPTS = [
  '## 2. How a workflow works',
  '',
  '### The shape',
  '',
  '{',
  '  "name": "Investigate an issue",',
  '  "posture": "gated",',
  '  "tools": { "maxRisk": "write" },',
  '  "inputs": [',
  '    { "name": "issue", "description": "The issue to work on", "required": true }',
  '  ],',
  '  "steps": [',
  '    { "name": "reproduce", "after": [], "prompt": "Reproduce the issue and say which command shows it." }',
  '  ]',
  '}',
  '',
  'Only `name` and `steps` are required, and `posture` defaults to `gated`. `steps` always holds at',
  'least one step: a definition with none is refused.',
  '',
  'An input is a value the person supplies when they start the run. Its `name` starts with a letter',
  'and then takes letters, digits and underscores. No dashes, and no leading digit. `description`,',
  '`required` and `default` are optional. Declare an input when the description asks for something',
  'that changes each time the workflow runs, and give it a description, because that is the label on',
  'the box the person fills in.',
  '',
  '### A step',
  '',
  '{',
  '  "name": "reproduce",',
  '  "kind": "agent",',
  '  "after": ["plan"],',
  '  "prompt": "Reproduce the failure and say which command shows it.",',
  '  "isolation": "shared",',
  '  "inputs": "append"',
  '}',
  '',
  'A step name is a slug: letters, digits, hyphens and underscores, starting with a letter or a',
  'digit. Never a space. Names are unique within a definition, and every edge, branch and reference',
  'names a step by it, so keep them short and readable: `reproduce`, `write-the-fix`, `review`.',
  '',
  '`kind` says what the step does. Leave it out for an ordinary agent step, which is most of them.',
  'Section 3 lists every kind this node can run.',
  '',
  '### The graph',
  '',
  '`after` is the whole graph. It lists the steps this one waits for.',
  '',
  '  "after": []                        a root. It starts when the run starts.',
  '  "after": ["plan"]                  waits for plan.',
  '  "after": ["frontend", "backend"]   waits for both. This is a fan-in.',
  '  no after key at all                waits for the step written before it in the list.',
  '',
  'Nothing else makes an edge. The order of the `steps` array decides nothing except what a missing',
  '`after` means, and a step may be written before the steps it waits for. The graph must hold no',
  'cycle.',
  '',
  'A step is ready when every step in its `after` has finished, and every ready step starts at once.',
  'Two roots start together. Two steps that both wait for `plan`, and for nothing else, start',
  'together the moment `plan` finishes. That is what a workflow is for, and it is the part a',
  'description implies without saying.',
  '',
  'So when somebody says two things happen at the same time, or asks for two angles on one question,',
  'write two steps with the same `after`. Not one step told to do both. Not a chain. A definition',
  'where every step waits for the one before it is usually the wrong answer.',
  '',
  '### What a step is given',
  '',
  "An agent step's `inputs` key says what happens to the output of the steps it waits for:",
  '',
  '  "append"     the default. Each upstream output is added after the prompt, under an',
  '               "## Output of <step name>" heading.',
  '  "template"   nothing is added. The prompt places the outputs itself, with references.',
  '  "none"       the prompt alone.',
  '',
  'So a step that reads what two earlier steps produced needs no references at all. Give it an',
  '`after` naming both and a prompt saying what to do with them:',
  '',
  '{',
  '  "name": "synthesise",',
  '  "after": ["security-review", "performance-review"],',
  '  "prompt": "Two reviews of the same change follow, one for security and one for performance. Write one summary: what they agree on, where they disagree, and what to do first."',
  '}',
  '',
  'That is how parallel work comes back together.',
  '',
  '### References',
  '',
  'Two references reach a value from somewhere else:',
  '',
  '  ${steps.<name>.output}   what that step answered.',
  '  ${inputs.<name>}         a value the person supplied when starting the run.',
  '',
  "They work in three places and nowhere else: a step's `prompt`, a fan-out step's",
  "`childStep.prompt`, and any string inside a contributed kind's `with`. Anywhere else they are",
  'literal text.',
  '',
  'Three rules:',
  '',
  '- A `${steps.x.output}` reference is allowed only where `x` is certain to have finished, which',
  "  means `x` sits somewhere back along this step's `after` chain. When a prompt names a step, put",
  '  that step in `after` as well.',
  "- A `${inputs.x}` reference needs `x` declared in the definition's `inputs`.",
  '- The token is exact. `${steps.x}` and `${steps.x.result}` are errors rather than text, and either',
  '  one fails the whole definition.',
  '',
  'Never reference a step a branch might skip. A skipped step has no output, and the reference fails',
  'the run where it stands. Read a possibly-skipped branch with `append` instead, which quietly',
  'leaves out whatever did not run.',
  '',
  '### Writing a prompt',
  '',
  'You write the whole prompt for every agent step, and it is most of what a definition is worth.',
  'Write to a capable engineer who can read the repository and run commands, and who knows nothing',
  'about the rest of the workflow beyond what this step is handed.',
  '',
  '- Say what the step does, and what finished looks like.',
  '- Say what to answer with, because the answer is what the next step reads. "Answer with the file',
  '  paths and one line each" beats "investigate the problem".',
  '- One job per step. Two jobs is two steps, and two steps can often run at once.',
  '- Do not tell a step to wait for another step, to run in parallel, or to hand anything over. The',
  '  graph does that.',
  '- Do not name a model, a tool, a command line or a file path that the description did not name.',
  '',
  '### Gates and posture',
  '',
  '`posture` is `gated`, the default, or `autonomous`.',
  '',
  'A `gate-human` step parks the run until somebody approves it in the app. Put one in front of',
  'anything that leaves the machine: a push, a pull request, a deploy, a message to a person. When',
  'somebody says they want to approve something first, that is a `gate-human` step.',
  '',
  'Under `"posture": "autonomous"` a `gate-human` passes straight through without asking anybody, so',
  'an autonomous workflow takes its safety from `gate-policy` steps and from its tool ceiling',
  'instead. An autonomous workflow must set `tools.maxRisk`.',
  '',
  '### Tools',
  '',
  '`tools.maxRisk` is the riskiest thing any step may do: `read`, `write` or `execute`. Set it on the',
  'definition. A workflow that edits files needs at least `write`, and one that runs tests or git',
  'needs `execute`. A step may narrow the ceiling with a `tools.maxRisk` of its own. It may never',
  'widen it.',
  '',
  '### Where a step runs',
  '',
  '`isolation` is `shared`, the default, or `worktree`, and only an agent step takes it.',
  '',
  "`shared` runs the step on the run's own task, in the checkout its siblings are using. `worktree`",
  'gives the step a task and a checkout of its own.',
  '',
  'Use `worktree` for a step that writes files while another step is running, because two steps',
  'editing one checkout trip over each other. Steps that only read share happily, and a worktree each',
  'is slower for nothing.',
  '',
  '### Structured output',
  '',
  '`schema` on an agent step is a JSON Schema object. The step then ends by producing matching JSON,',
  'and that JSON, rather than the prose, is what `${steps.x.output}` carries and what the appended',
  'heading holds. Use one where a later step needs a field it can look at rather than a paragraph it',
  'has to read. Leave it out otherwise.',
  '',
  '### Keys never to write',
  '',
  'These look plausible and are not available here. Each one is stripped out of your answer:',
  '',
  '  trigger          what starts a workflow on its own.',
  '  tools.allow      a named tool allowlist. Use tools.maxRisk.',
  '  model            a model name on a step. The profile decides.',
  '  configOptions    provider options on a step.',
  '  requiresRun      a run target a step needs started.',
  '',
  'Write no key that this prompt does not name.',
].join('\n')

// --- 3. the step kinds, from the catalog ---

/** How much of a kind survives. Four steps of degradation, each applied to the whole section until
 *  it fits, because a section half in one style is harder to read than either. */
type KindDetail = 0 | 1 | 2 | 3 | 4

const SECTION_KINDS_PREAMBLE = [
  '## 3. Step kinds',
  '',
  'Every kind this node can run is below. Using one that is not here is an error.',
  '',
  'A built-in kind is a bare word, `"kind": "agent"`. Its inputs are named keys on the step itself,',
  'and a built-in step never carries a `with` object.',
  '',
  'A contributed kind is namespaced, `"kind": "http:request"`, and every input it takes goes inside',
  '`with`. Nothing else on the step belongs to it.',
  '',
  'A dotted key is a nested one: `childStep.prompt` means `prompt` inside a `childStep` object.',
  '',
  "A field's JSON type follows the word in brackets. `text`, `textarea`, `prompt` and `string` are",
  'all strings, `number` is a number, `boolean` is true or false, and a field written as "one of" takes',
  'one of the values listed. The single exception is `schema`, which is a JSON Schema object, as above.',
  '',
  'A kind marked "runs an agent" may also take `profileId`, `isolation` and `inputs`. On any other',
  'kind `isolation` and `inputs` are errors and `profileId` does nothing, so leave all three off.',
].join('\n')

const optionValues = (options: readonly StepFieldOption[], detail: KindDetail): string => {
  const shown = detail >= 3 ? options.slice(0, GENERATE_MAX_FIELD_OPTIONS) : options
  const rest = options.length - shown.length
  return [shown.map((option) => option.value).join(', '), ...(rest > 0 ? [`and ${rest} more`] : [])].join(', ')
}

const fieldType = (field: StepField, detail: KindDetail): string => {
  // A select with no fixed options — a policy, a fan-out step name, a child profile — has nothing to
  // list, and the bare word `select` is not a JSON type and means nothing to a model with no form in
  // front of it. Each one holds an identifier, so say what the model actually writes: a string.
  if (field.type === 'select') return field.options?.length ? `one of ${optionValues(field.options, detail)}` : 'string'
  if (field.type === 'number' && (field.min != null || field.max != null)) {
    return `number from ${field.min ?? 'any'} to ${field.max ?? 'any'}`
  }
  if (field.type === 'child-workflow') return 'child workflow object'
  if (field.type === 'workflow-map-source') return 'structured map source object'
  if (field.type === 'workflow-json-pointer') return 'JSON Pointer string'
  if (field.type === 'workflow-title') return 'bound title object'
  return field.type
}

/** One line of a kind's key list, from either a described field or the table below. */
type PromptField = { id: string; shape: string; hint?: string }

const fieldLine = (field: PromptField, prefix: string, detail: KindDetail): string =>
  `- \`${prefix}${field.id}\` (${field.shape}).${detail === 0 && field.hint ? ` ${field.hint}` : ''}`

/** Keys a built-in kind really takes that its `describe` does not list.
 *
 *  `describe` is the editor's form, and these three have no control on it: a decide's branches are
 *  drawn as edges on the graph, a fan-out's schema is written for it, and a child step's name is a
 *  slug the runner defaults. A model has no graph to draw on and no form to fill in, so it has to be
 *  handed the keys. They live here rather than in `describe` because adding them there would put
 *  three empty boxes in the inspector to fix a problem the inspector does not have.
 *
 *  Only built-ins appear here. A contributed kind's `describe` is the whole contract it has. */
const UNDESCRIBED_FIELDS: Readonly<Record<string, readonly PromptField[]>> = {
  decide: [{ id: 'branches', shape: 'object of verdict to step name, required', hint: 'Section 4 shows one.' }],
  'fan-out': [
    { id: 'schema', shape: 'textarea, required', hint: 'JSON Schema for the task list. Section 4 has it.' },
    { id: 'childStep.name', shape: 'text', hint: 'A slug naming each child. Defaults to `child`.' },
  ],
}

type CatalogKind = WorkflowCatalog['kinds'][number]

/** Built-ins first and then each plugin's, which is the order the editor's Add menu uses. */
const orderedKinds = (catalog: WorkflowCatalog): CatalogKind[] =>
  [...catalog.kinds].sort((a, b) => Number(a.pluginId !== null) - Number(b.pluginId !== null))

const kindFields = (kind: CatalogKind, detail: KindDetail): PromptField[] => [
  ...(kind.describe?.fields ?? [])
    .filter((field) => kind.pluginId !== null || !isForbiddenField(field.id))
    .map((field) => ({
      id: field.id,
      shape: [fieldType(field, detail), ...(field.required ? ['required'] : [])].join(', '),
      hint: field.hint,
    })),
  ...(kind.pluginId === null ? UNDESCRIBED_FIELDS[kind.id] ?? [] : []),
  // Top-level keys, then the nested ones, so a `childStep` is not split in half by a key added
  // above. The sort is stable, so each group keeps the order it was described in.
].sort((a, b) => Number(a.id.includes('.')) - Number(b.id.includes('.')))

const kindBlock = (kind: CatalogKind, detail: KindDetail): string => {
  const builtin = kind.pluginId === null
  const fields = kindFields(kind, detail)
  const prefix = builtin ? '' : 'with.'
  const lines = [`### \`${kind.id}\``]
  const summary = [
    kind.describe?.label ?? kind.id,
    ...(builtin ? [] : [`Contributed by the ${kind.pluginId} plugin`]),
    ...(kind.describe?.runsAgent ? ['Runs an agent'] : []),
  ].join('. ')
  lines.push(`${summary}.`)
  if (detail <= 1 && kind.describe?.description) lines.push(kind.describe.description)
  if (!kind.describe) {
    lines.push('This kind ships no description, so its inputs are not listed here. Use it only when the')
    lines.push('description names it, and put whatever it needs in `with`.')
  } else if (!fields.length) lines.push(builtin ? 'It takes no fields of its own.' : 'It takes no `with` keys.')
  else {
    lines.push(builtin ? 'Keys on the step:' : 'Keys inside `with`:')
    lines.push(...fields.map((field) => fieldLine(field, prefix, detail)))
  }
  if (detail <= 1 && kind.describe?.output) lines.push(`Its output: ${kind.describe.output.description}`)
  return lines.join('\n')
}

const kindOneLine = (kind: CatalogKind): string => {
  const prefix = kind.pluginId === null ? '' : 'with.'
  const fields = kindFields(kind, 4)
  const keys = fields.length ? fields.map((field) => `${prefix}${field.id}`).join(', ') : 'no keys'
  return `- \`${kind.id}\`, ${kind.describe?.label ?? kind.id}: ${keys}`
}

const kindsAt = (catalog: WorkflowCatalog, detail: KindDetail): string => {
  const kinds = orderedKinds(catalog)
  if (!kinds.length) return [SECTION_KINDS_PREAMBLE, '', 'This node has no step kinds at all, so no definition it runs can have a step.'].join('\n')
  if (detail === 4) {
    return [SECTION_KINDS_PREAMBLE, '', 'Only the ids and their keys fit here.', '', ...kinds.map(kindOneLine)].join('\n')
  }
  return [SECTION_KINDS_PREAMBLE, ...kinds.map((kind) => kindBlock(kind, detail))].join('\n\n')
}

/** The kinds, as large as they fit. Never fewer kinds, only less about each one: drop the hints,
 *  then the descriptions and output notes, then cap each list of values, then one line per kind. */
export function renderStepKinds(catalog: WorkflowCatalog, budget = GENERATE_MAX_KIND_CHARS): string {
  for (const detail of [0, 1, 2, 3] as const) {
    const text = kindsAt(catalog, detail)
    if (text.length <= budget) return text
  }
  return kindsAt(catalog, 4)
}

// --- 4. the two shapes no description states ---

const SECTION_CONTRACTS = [
  '## 4. Two shapes nothing else tells you',
  '',
  '### The task list a fan-out needs',
  '',
  '`fan-out` asks an agent for a list of jobs, then runs one child agent per item, each in a worktree',
  'of its own. The planning agent has to answer with exactly this, or the step fails with "Plan',
  'emitted no task list":',
  '',
  '{ "tasks": [ { "title": "Update the parser", "branch": "fix/parser", "prompt": "anything extra for this one child" } ] }',
  '',
  '`title` and `branch` are required and `prompt` is optional. `branch` is a git branch name and has',
  'to be unique across every task on the machine, so build it out of something from the run. At most',
  '12 entries.',
  '',
  'An empty `tasks` array is not an answer. It fails the step with that same message, exactly as a',
  'missing array does. So write the planning prompt to ask for at least one entry, and only reach for',
  'a fan-out where the work is certainly there to split up. When the description says there may be',
  'nothing to do, an ordinary agent step handles it, or a `decide` in front that branches on whether',
  'there is anything.',
  '',
  'So a fan-out step needs three things: a prompt asking for that list and saying what one entry is,',
  'a `schema` matching it, and a `childStep.prompt` telling each child what to do with its own entry.',
  'Each child is handed its title and its extra prompt automatically.',
  '',
  '{',
  '  "name": "plan",',
  '  "kind": "fan-out",',
  '  "after": [],',
  '  "prompt": "List the packages in this repository that carry their own dependency manifest. Answer with a tasks array holding one entry per package, with title set to the package name and branch set to deps/ followed by the package name. At least one entry and at most 12.",',
  '  "schema": {',
  '    "type": "object",',
  '    "required": ["tasks"],',
  '    "properties": {',
  '      "tasks": {',
  '        "type": "array",',
  '        "items": {',
  '          "type": "object",',
  '          "required": ["title", "branch"],',
  '          "properties": { "title": { "type": "string" }, "branch": { "type": "string" }, "prompt": { "type": "string" } }',
  '        }',
  '      }',
  '    }',
  '  },',
  '  "childStep": {',
  '    "name": "update",',
  '    "prompt": "Bring the dependencies of the package this task names up to date. Run that package\'s tests until they pass and change nothing outside it. Answer with what you moved."',
  '  }',
  '}',
  '',
  'A `join` step collects those children. It names the fan-out in `joins`, and waits for it in',
  '`after`.',
  '',
  '### The branches a decide takes',
  '',
  '`decide` asks an agent for one verdict and takes the branch matching it.',
  '',
  '{',
  '  "name": "triage",',
  '  "kind": "decide",',
  '  "after": ["reproduce"],',
  '  "prompt": "Read the reproduction above. Answer with a verdict of either code, for a defect in this repository, or data, for bad data in the environment.",',
  '  "branches": { "code": "write-the-fix", "data": "fix-the-data", "default": "ask-a-person" }',
  '}',
  '',
  '- The default schema asks for one string field called `verdict`. The keys of `branches` are the',
  '  verdicts, so the prompt has to name the same words.',
  '- Every branch target must wait for the decision. Give each target an `after` naming the decide',
  '  step, or naming a step that already waits for it.',
  '- A verdict matching no key fails the run, unless `branches` holds a key literally called',
  '  `default`. Add one whenever the prompt could produce a word you did not list.',
  '- When the verdict picks a target, every other target is marked skipped, and so is every step that',
  '  can only be reached through one of them. A step a live branch also reaches still runs.',
  '- Give each verdict its own step. Two verdicts pointing at one step means one of them was never a',
  '  real branch. `default` is the exception: pointing it at a step a listed verdict already uses is',
  '  how you say "treat anything else like that one".',
  '- Never put the step that follows the branches in `branches`. Put that work after them, with an',
  '  `after` naming every branch, and it runs whichever way the verdict went.',
].join('\n')

// --- 5. the policies and profiles this node has ---

const vocabularyAt = (catalog: WorkflowCatalog, compact: boolean): string => {
  const lines = ['## 5. Policies and profiles', '', '### Policies']
  const policies = catalog.policies
  if (!policies.length) {
    lines.push('', 'This node offers no policies, so do not write a `gate-policy` step.')
  } else {
    lines.push('', 'A `gate-policy` step asks a policy for a verdict and fails the run when it says no. Its `policy`')
    lines.push(`is one of: ${policies.map((policy) => `\`${policy.id}\``).join(', ')}.`)
    if (!compact) {
      lines.push('', `{ "name": "checks", "kind": "gate-policy", "after": ["open-a-pull-request"], "policy": "${policies[0]!.id}" }`)
    }
  }

  lines.push('', '### Profiles', '')
  const profiles = catalog.profiles
  if (!profiles.length) {
    lines.push('This node has no agent profiles, so leave `profileId` off every step.')
    return lines.join('\n')
  }
  lines.push('`profileId` on an agent step picks which agent runs it. Leave it out and the step runs on the')
  lines.push('default, which is what you want unless the description asks for something else.')
  lines.push('')
  // The default first and the structured ones next, so a node with more profiles than fit keeps the
  // ones a definition might actually have to name.
  const ranked = [...profiles].sort((a, b) =>
    Number(b.id === DEFAULT_PROFILE_ID) - Number(a.id === DEFAULT_PROFILE_ID) || Number(b.structured) - Number(a.structured) || a.id.localeCompare(b.id))
  const shown = ranked.slice(0, GENERATE_MAX_PROFILES)
  const rest = ranked.length - shown.length
  if (compact) {
    lines.push(`${shown.map((profile) => `\`${profile.id}\``).join(', ')}${rest > 0 ? `, and ${rest} more` : ''}.`)
  } else {
    lines.push(...shown.map((profile) => {
      const notes = [
        ...(profile.id === DEFAULT_PROFILE_ID ? ['The default'] : []),
        ...(profile.structured ? ['Has a structured mode'] : []),
      ]
      return `- \`${profile.id}\`, ${profile.label}.${notes.map((note) => ` ${note}.`).join('')}`
    }))
    if (rest > 0) lines.push(`- and ${rest} more.`)
  }

  // `decide` is the one kind that needs a profile with a one-shot structured mode, and whether it
  // needs to say so depends on the node it runs on.
  const structured = ranked.filter((profile) => profile.structured)
  const defaultStructured = structured.some((profile) => profile.id === DEFAULT_PROFILE_ID)
  lines.push('')
  if (!structured.length) {
    lines.push('No profile here has a structured mode, and a `decide` step needs one, so do not write a')
    lines.push('`decide` step.')
  } else if (defaultStructured) {
    lines.push('A `decide` step needs a profile with a structured mode. The default has one, so a `decide` step')
    lines.push('needs no `profileId`.')
  } else {
    lines.push('A `decide` step needs a profile with a structured mode and the default has none, so give every')
    lines.push(`\`decide\` step a \`profileId\` of one of: ${structured.map((profile) => `\`${profile.id}\``).join(', ')}.`)
  }
  return lines.join('\n')
}

/** The vocabulary a definition may name, as large as it fits. Degraded in place, never dropped: an
 *  unlisted policy or profile is one the model would invent instead. */
export function renderVocabulary(catalog: WorkflowCatalog, budget = GENERATE_MAX_VOCABULARY_CHARS): string {
  const full = vocabularyAt(catalog, false)
  return full.length <= budget ? full : vocabularyAt(catalog, true)
}

// --- 6. saved workflows this project can dispatch ---

// --- 7. the checker, and the mistake this feature exists to avoid ---

const SECTION_RULES = [
  '## 7. Rules and mistakes',
  '',
  '### What the checker refuses',
  '',
  'Every definition is checked before it runs. These are errors:',
  '',
  '- A step with no name, or a name used twice.',
  '- An `after` naming a step that does not exist, or naming the step itself.',
  '- A cycle.',
  '- A `kind` that section 3 does not list.',
  '- A `${steps.x.output}` reference to a step that is not behind this one, or a malformed token.',
  '- A `${inputs.x}` reference to an input that is not declared.',
  '- A step `tools.maxRisk` looser than the workflow ceiling.',
  '- An autonomous workflow with no `tools.maxRisk`.',
  '- A `decide` step with no `branches`, or a branch target that does not wait for the decision.',
  '- A `join` step whose `joins` does not name a fan-out behind it.',
  '- A required field of a kind left empty.',
  '- `isolation` or `inputs` on a kind that does not run an agent.',
  '- A child workflow reference that section 6 does not list.',
  '- A child input binding the target does not declare, or a required child input with no binding.',
  '- A map source or step binding that does not name a structured predecessor.',
  '',
  '### Mistakes to avoid',
  '',
  '- Writing a chain when the description says two things happen at once. Give both steps the same',
  '  `after`.',
  '- Writing a `with` object on a built-in kind. Built-ins take named keys.',
  '- Writing named keys on a contributed kind. Everything it takes goes in `with`.',
  '- Naming a step in a prompt without putting it in `after`.',
  '- Giving a decide branch target no `after` of its own, so it starts beside the decision rather',
  '  than after it.',
  '- Leaving out a `default` branch when the verdict could be a word you did not list.',
  '- A `join` with no `fan-out` behind it in `joins`.',
  '- A `fan-out` whose prompt does not ask for the task list, that has no `schema`, or that offers an',
  '  empty list as an answer. An empty list fails the step.',
  '- A dash in an input name, or a digit at the front of one. An input name starts with a letter and',
  '  then takes letters, digits and underscores. Step names take dashes.',
  '- A space in a step name.',
  '- An autonomous workflow with no `tools.maxRisk`.',
  '- Inventing a kind, a policy or a profile. Sections 3 and 5 list what exists.',
  '',
  '### One wrong answer, and the fix',
  '',
  'Asked for two agents investigating one issue at the same time and a third reading both:',
  '',
  'Wrong. Nothing runs at the same time. A step with no `after` waits for the step written before it,',
  'so this is a three-step chain:',
  '',
  '{',
  '  "name": "Investigate",',
  '  "steps": [',
  '    { "name": "check-the-logs", "prompt": "Read the logs for this failure and say what they show." },',
  '    { "name": "read-the-code", "prompt": "Find the code behind this failure and say what looks wrong." },',
  '    { "name": "write-it-up", "prompt": "Write the diagnosis." }',
  '  ]',
  '}',
  '',
  'Right. Two roots, then a fan-in that reads both. `write-it-up` needs no references, because',
  '`inputs` defaults to `append`:',
  '',
  '{',
  '  "name": "Investigate",',
  '  "steps": [',
  '    { "name": "check-the-logs", "after": [], "prompt": "Read the logs for this failure and say what they show." },',
  '    { "name": "read-the-code", "after": [], "prompt": "Find the code behind this failure and say what looks wrong." },',
  '    { "name": "write-it-up", "after": ["check-the-logs", "read-the-code"], "prompt": "A log reading and a code reading of one failure follow. Write the diagnosis: what is broken, why, and the smallest change that fixes it." }',
  '  ]',
  '}',
].join('\n')

// --- 8. two worked examples that always ship ---
//
// Data rather than text, so a test can put them through `validateWorkflow` and a built-in example
// can never teach something the checker refuses. The first is the motivating case: parallel work,
// a fan-in, and a person approving before anything leaves the machine.

const TASK_LIST_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'branch'],
        properties: { title: { type: 'string' }, branch: { type: 'string' }, prompt: { type: 'string' } },
      },
    },
  },
}

export const BUILTIN_EXAMPLES: readonly { def: WorkflowDef; note: string }[] = [
  {
    note: [
      '`reproduce` and `read-the-code` are both roots, so they run at the same time. `diagnose` waits',
      'for both and reads their answers with no references at all, because `inputs` defaults to',
      '`append`. Nothing leaves the machine until a person presses approve.',
    ].join(' '),
    def: {
      name: 'Investigate an issue from two angles',
      posture: 'gated',
      tools: { maxRisk: 'execute' },
      inputs: [{ name: 'issue', description: 'The issue to investigate', required: true }],
      steps: [
        {
          name: 'reproduce',
          after: [],
          prompt: 'Reproduce this issue. Answer with the exact command that shows it and what it prints, or say you could not reproduce it and what you tried.\n\nIssue: ${inputs.issue}',
        },
        {
          name: 'read-the-code',
          after: [],
          prompt: 'Find the code behind this issue without running anything. Answer with the files and functions involved, one line each, and what you think is going wrong.\n\nIssue: ${inputs.issue}',
        },
        {
          name: 'diagnose',
          after: ['reproduce', 'read-the-code'],
          prompt: 'A reproduction attempt and a code reading of the same issue follow. Write the diagnosis: what is broken, why, and the smallest change that would fix it.',
        },
        {
          name: 'write-the-fix',
          after: ['diagnose'],
          prompt: 'Make the change the diagnosis describes and run the tests that cover it. Commit nothing and push nothing.',
        },
        { name: 'approve', kind: 'gate-human', after: ['write-the-fix'] },
        {
          name: 'open-a-pull-request',
          after: ['approve'],
          prompt: 'Commit the change, push the branch, and open a pull request. The title says what changed and the body says why.',
        },
      ],
    },
  },
  {
    note: [
      'One fan-out planning the work, a join collecting it, and a decision with a branch each way. The',
      'planning prompt asks for at least one entry, because a fan-out that plans nothing fails.',
      '`default` shares a step with `dirty`, which is how an unexpected verdict is treated as the',
      'careful one. `write-it-up` waits for both branches, and the skipped one contributes nothing,',
      'which is why it reads them with `append` rather than a reference.',
    ].join(' '),
    def: {
      name: 'Update the dependencies in every package',
      posture: 'gated',
      tools: { maxRisk: 'execute' },
      steps: [
        {
          name: 'plan',
          kind: 'fan-out',
          after: [],
          prompt: 'List the packages in this repository that carry their own dependency manifest. Answer with a tasks array holding one entry per package, with title set to the package name and branch set to deps/ followed by the package name. At least one entry and at most 12.',
          schema: TASK_LIST_SCHEMA,
          childStep: {
            name: 'update',
            prompt: "Bring the dependencies of the package this task names up to date. Run that package's tests until they pass and change nothing outside it. Answer with what you moved and the command you ran.",
          },
        },
        { name: 'collect', kind: 'join', after: ['plan'], joins: 'plan' },
        {
          name: 'verdict',
          kind: 'decide',
          after: ['collect'],
          prompt: 'The result of every package update follows. Answer with a verdict of either clean, when every package passes, or dirty, when any of them still fails.',
          branches: { clean: 'note-what-changed', dirty: 'second-pass', default: 'second-pass' },
        },
        {
          name: 'second-pass',
          after: ['verdict'],
          prompt: 'One or more packages still fail. Fix what is left in this checkout, run the whole suite, and answer with what you changed.',
        },
        {
          name: 'note-what-changed',
          after: ['verdict'],
          prompt: 'Every package passes. Answer with one line per package saying which dependencies moved.',
        },
        {
          name: 'write-it-up',
          after: ['second-pass', 'note-what-changed'],
          prompt: 'Write the summary for the person who started this run: which packages moved, what broke, and anything still outstanding.',
        },
      ],
    },
  },
]

const SECTION_EXAMPLES = [
  '## 8. Worked examples',
  '',
  ...BUILTIN_EXAMPLES.flatMap(({ def, note }) => [JSON.stringify(def, null, 2), '', note, '']),
].join('\n').trimEnd()

// --- 9. worked examples from this workspace ---

/** A definition somebody here wrote, with the id it is addressed by so the one being edited can be
 *  kept out of its own examples. */
export type WorkflowExample = { id: string; def: WorkflowDef }
type PromptWorkflowExample = { id: string; def: PromptWorkflowDef }

/** How much one definition teaches, highest first.
 *
 *  A fan-in outranks everything, because a step reading two parallel branches is the thing this
 *  feature exists to produce and the thing a model gets wrong on its own. Parallel roots come next,
 *  then anything past a plain agent chain. */
function teachingScore(def: WorkflowDef): number {
  const after = [...workflowEdges(def.steps).values()]
  return (after.some((names) => names.length > 1) ? 4 : 0)
    + (after.filter((names) => !names.length).length > 1 ? 2 : 0)
    + (def.steps.some((step) => step.kind && step.kind !== 'agent') ? 1 : 0)
    + (def.inputs?.length ? 1 : 0)
}

/** Which of the workspace's definitions ride along, and which are only named.
 *
 *  This deviates from the changes plugin's `splitByBudget` twice, on purpose. It ranks by teaching
 *  value rather than smallest first, and it drops a whole example rather than truncating one: half a
 *  JSON definition is invalid syntax, and a broken worked example teaches worse than no example.
 *
 *  Four definitions never make it in: the one being edited, anything under two steps, anything that
 *  does not pass the checker, and a parent workflow. `definitionForPrompt` removes protected child
 *  targets, so rendering a parent afterward would teach an incomplete dispatch shape. Section 6
 *  provides complete catalog-backed dispatch examples instead. */
export function selectExamples(args: {
  examples: readonly WorkflowExample[]
  validation: WorkflowValidationCatalog
  excludeId?: string
  budget?: number
}): { include: PromptWorkflowExample[]; omit: WorkflowExample[] } {
  const budget = args.budget ?? GENERATE_MAX_EXAMPLE_CHARS
  const candidates = args.examples
    .filter((example) => example.id !== args.excludeId && (example.def.steps?.length ?? 0) >= 2)
    .filter((example) => !example.def.steps.some((step) => step.kind === 'workflow' || step.kind === 'workflow-map'))
    .filter((example) => !validateWorkflow(example.def, args.validation).length)
    .map((original) => {
      const example = { id: original.id, def: definitionForPrompt(original.def) }
      return { original, example, text: JSON.stringify(example.def, null, 2), score: teachingScore(original.def) }
    })
    .sort((a, b) => b.score - a.score || a.text.length - b.text.length || a.example.id.localeCompare(b.example.id))

  const include: PromptWorkflowExample[] = []
  const omit: WorkflowExample[] = []
  let spent = 0
  for (const candidate of candidates) {
    const fits = candidate.text.length <= GENERATE_MAX_EXAMPLE_SIZE
      && spent + candidate.text.length <= budget
      && include.length < GENERATE_MAX_EXAMPLES
    if (fits) {
      include.push(candidate.example)
      spent += candidate.text.length
    } else omit.push(candidate.original)
  }
  return { include, omit }
}

/** The workspace's own definitions, or nothing at all. The only section that can disappear. */
function renderWorkspaceExamples(selected: { include: readonly PromptWorkflowExample[]; omit: readonly WorkflowExample[] }): string {
  if (!selected.include.length) return ''
  const lines = [
    '## 9. Worked examples from this workspace',
    '',
    'Definitions somebody here wrote and this node runs. Follow how they name steps and how much they',
    'say in a prompt. They are house style, not templates: write what the description asks for.',
    '',
    ...selected.include.flatMap((example) => [JSON.stringify(example.def, null, 2), '']),
  ]
  if (selected.omit.length) {
    lines.push(`${selected.omit.length} more definition${selected.omit.length === 1 ? '' : 's'} here did not fit: ${selected.omit.map((example) => example.def.name).join(', ')}.`)
  }
  return lines.join('\n').trimEnd()
}

// --- the whole thing ---

/** What the catalog can say about a definition on its own.
 *
 *  Enough for the graph rules, the references, the fields a kind describes and every identifier:
 *  everything except a contributed kind's own `validate`, which lives on the node and cannot be
 *  reached from a pure module. The orchestrator passes the runner's real catalog instead. */
export function catalogValidation(catalog: WorkflowCatalog): WorkflowValidationCatalog {
  const described = new Map(catalog.kinds.map((kind) => [kind.id, kind.describe]))
  return {
    stepKinds: new Set(catalog.kinds.map((kind) => kind.id)),
    policies: new Set(catalog.policies.map((policy) => policy.id)),
    profiles: new Set(catalog.profiles.map((profile) => profile.id)),
    structuredProfiles: new Set(catalog.profiles.filter((profile) => profile.structured).map((profile) => profile.id)),
    agentStepKinds: new Set(catalog.kinds.filter((kind) => kind.describe?.runsAgent).map((kind) => kind.id)),
    describeStepKind: (kind) => described.get(kind) ?? undefined,
    workflowTargets: catalog.workflows,
  }
}

/** The system prompt: everything that does not change between one call and the next.
 *
 *  Sections are assembled in truncation order, so the final slice can only reach the last one. It is
 *  a backstop rather than the plan: each section is already held to its own budget above. */
export function buildGenerateSystemPrompt(args: {
  catalog: WorkflowCatalog
  examples?: readonly WorkflowExample[]
  excludeId?: string
  validation?: WorkflowValidationCatalog
  exampleBudget?: number
}): string {
  const selected = selectExamples({
    examples: args.examples ?? [],
    validation: args.validation ?? catalogValidation(args.catalog),
    excludeId: args.excludeId,
    budget: args.exampleBudget,
  })
  return [
    SECTION_ROLE,
    SECTION_CONCEPTS,
    renderStepKinds(args.catalog),
    SECTION_CONTRACTS,
    renderVocabulary(args.catalog),
    renderWorkflowTargets(args.catalog),
    SECTION_RULES,
    SECTION_EXAMPLES,
    renderWorkspaceExamples(selected),
  ].filter(Boolean).join('\n\n').slice(0, GENERATE_MAX_SYSTEM_CHARS)
}

const inputLine = (input: WorkflowInput): string =>
  `- \`${input.name}\`${input.required ? ', required' : ''}${input.description ? `. ${input.description}` : ''}`

/** The user prompt: either a brief for a replacement, or a request applied to the current graph.
 *
 *  Overwrite keeps the old name-and-input hint contract. Edit carries the model-visible projection
 *  of the current definition and makes preservation explicit; protected values are restored after
 *  the reply is grounded. */
export function buildGenerateUserPrompt(args:
  | { mode: 'overwrite'; description: string; name?: string; inputs?: readonly WorkflowInput[] }
  | { mode: 'edit'; description: string; currentDef: WorkflowDef },
): string {
  if (args.mode === 'edit') {
    return [
      'Edit the current workflow according to this request:',
      '',
      args.description.trim().slice(0, GENERATE_MAX_DESCRIPTION_CHARS),
      '',
      'Here is the current workflow:',
      '',
      JSON.stringify(definitionForPrompt(args.currentDef), null, 2),
      '',
      'Return the whole edited definition, not a patch. Keep every name, step, prompt, edge, input,',
      'policy, budget and setting that the request does not need to change. Some protected settings',
      'have been omitted; keep the step names and kinds for unaffected steps so acorn can restore them.',
      '',
      'Answer with the JSON object and nothing else.',
    ].join('\n')
  }

  const lines = ['Write the workflow definition for this description.', '', args.description.trim().slice(0, GENERATE_MAX_DESCRIPTION_CHARS)]
  const name = args.name?.trim()
  const inputs = (args.inputs ?? []).filter((input) => input.name?.trim())
  if (name || inputs.length) {
    lines.push('', 'It replaces a draft that is already open.')
    if (name) lines.push(`Its name is "${name}". Keep it when it still describes what you wrote.`)
    if (inputs.length) {
      lines.push('It declares these inputs. Keep the ones your definition uses and drop the rest:')
      lines.push(...inputs.map(inputLine))
    }
  }
  lines.push('', 'Answer with the JSON object and nothing else.')
  return lines.join('\n')
}

/** The one repair pass, as a user prompt against the same system prompt byte for byte.
 *
 *  Four parts, and each earns its place. The original prompt, because this is a stateless call and
 *  the goal has to be restated. The grounded definition rather than the raw reply, so what was
 *  stripped is already gone and the model is not invited to keep it. The notes, without which the
 *  model puts back exactly what was just taken out. And the checker's own messages, verbatim: a
 *  message like "sets both model and config_options.model; config_options wins, so drop one" carries
 *  the fix, and paraphrasing it loses the fix. */
export function buildRepairUserPrompt(args: {
  userPrompt: string
  def: WorkflowDef | PromptWorkflowDef
  notes: readonly WorkflowGenerateNote[]
  problems: readonly string[]
}): string {
  const lines = [
    args.userPrompt,
    '',
    '---',
    '',
    'Your answer did not pass the checker. Here it is as it stands:',
    '',
    JSON.stringify(args.def, null, 2),
  ]
  if (args.notes.length) {
    lines.push('', 'These were removed because this node does not have them. Do not put them back:', '')
    lines.push(...args.notes.map((note) => `- ${note.message}`))
  }
  const problems = args.problems.slice(0, GENERATE_MAX_REPAIR_PROBLEMS)
  lines.push('', 'The checker reports these problems. Fix every one:', '')
  lines.push(...problems.map((problem) => `- ${problem}`))
  if (args.problems.length > problems.length) {
    lines.push(`- and ${args.problems.length - problems.length} more of the same kind.`)
  }
  lines.push('', 'Answer with the whole corrected definition as one JSON object and nothing else. Keep every step,')
  lines.push('prompt and edge that no problem above mentions.')
  return lines.join('\n')
}
