// How the nine built-in kinds describe themselves, and where each of their fields lands
// (docs/workflows.md § Contributed step kinds).
//
// Here rather than beside the handlers in ../server/steps/builtins.ts for two reasons. The editor
// runs on the client and needs the same table, and ../server/validation/definition.ts reads `runsAgent`
// off it, which it cannot do from a module that imports the validator back.
//
// A contributed kind's fields all land in `with`, which the runner passes through unread. A built-in
// kind's are named fields on the step itself, which is what keeps them checkable by the host. The
// editor does not know the difference: it asks FIELD_HOME.
import type { StepField, StepKindDescription } from './workflowContracts'

const PROMPT_FIELD: StepField = { id: 'prompt', label: 'Prompt', type: 'prompt', required: true }
// The plain agent step is the one kind whose prompt is optional, because `inputs = "append"` puts
// every incoming edge's output after it: a step with two upstreams and nothing of its own to say is a
// real definition, and the host must not refuse it.
const OPTIONAL_PROMPT_FIELD: StepField = { ...PROMPT_FIELD, required: false, hint: 'Optional when the step appends its upstream outputs.' }

export const BUILTIN_STEP_DESCRIPTIONS: Readonly<Record<string, StepKindDescription>> = {
  'find-records': {
    label: 'Find records', description: 'Run an inline or published query and store its complete selection.', icon: 'search',
    fields: [{ id: 'query', label: 'Query', type: 'textarea', required: true, hint: 'A typed inline or saved query reference.' }],
    output: { description: 'Complete records with exact references, evaluation/read times and resolved query provenance.', schema: {
      type: 'object',
      properties: {
        records: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'object', properties: { pluginId: { type: 'string' }, sourceId: { type: 'string' }, recordId: { type: 'string' } }, required: ['pluginId', 'sourceId', 'recordId'] },
              data: { type: 'object' },
              display: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } } },
            },
            required: ['ref', 'data'],
          },
        },
      },
      required: ['records'],
    } },
  },
  'get-record-details': {
    label: 'Get record details', description: 'Fetch typed details for an exact record reference.', icon: 'file-search',
    fields: [{ id: 'record', label: 'Record reference', type: 'textarea', required: true, hint: 'A typed binding to the record ref.' }],
    output: { description: 'Record reference, typed data, schema and fetched time.', schema: { type: 'object', properties: { fetchedTime: { type: 'number' } }, required: ['fetchedTime'] } },
  },
  if: {
    label: 'If / otherwise', description: 'Compare typed values and take a branch without calling a model.', icon: 'git-branch',
    fields: [{ id: 'condition', label: 'Condition', type: 'textarea', required: true, hint: 'A bounded all/any predicate or typed comparison.' }],
    output: { description: 'Whether the condition matched.', schema: { type: 'object', properties: { matched: { type: 'boolean' }, verdict: { type: 'string' } }, required: ['matched', 'verdict'] } },
  },
  agent: {
    label: 'Ask an agent',
    description: 'Run one agent turn and hand its answer to the steps that wait on it.',
    icon: 'bot',
    runsAgent: true,
    fields: [
      OPTIONAL_PROMPT_FIELD,
      { id: 'schema', label: 'Result schema', type: 'textarea', hint: 'JSON Schema. The agent ends its turn with a matching JSON block.' },
      { id: 'requiresRun', label: 'Needs a run target', type: 'select', hint: "The project's run targets. Started first, and its URL is added to the prompt." },
    ],
    output: { description: 'The structured result if the step declared a schema, the final text otherwise.' },
  },
  decide: {
    label: 'Ask AI to decide',
    description: 'Ask an agent for one verdict and take the branch it names.',
    icon: 'git-branch',
    runsAgent: true,
    fields: [
      PROMPT_FIELD,
      { id: 'schema', label: 'Result schema', type: 'textarea', hint: 'JSON Schema. Defaults to one string field called verdict.' },
    ],
    output: { description: 'The verdict, and whatever else the schema asked for.' },
  },
  'gate-human': {
    label: 'Wait for a person',
    description: 'Park the run until somebody approves it. An autonomous run passes straight through.',
    icon: 'hand',
    fields: [{
      id: 'form',
      label: 'Form',
      type: 'gate-form',
      required: false,
      hint: 'Optional fields the reviewer checks and corrects before approving. Each can be filled from an earlier step.',
    }],
    output: { description: 'The approval outcome. With a form, the approved values under /values and the names of the fields the reviewer changed under /edited.' },
  },
  'gate-policy': {
    label: 'Check a policy',
    description: 'Ask a policy for a verdict and fail the run when it says no.',
    icon: 'shield-check',
    fields: [{ id: 'policy', label: 'Policy', type: 'select', required: true, hint: "The policies this node offers, from the catalog." }],
    output: { description: 'Whether the policy passed, and its detail when it did not.' },
  },
  'ci-loop': {
    label: 'Fix the checks',
    description: 'Re-run an agent until the pull request’s checks go green, or the iteration ceiling stops it.',
    icon: 'refresh-cw',
    runsAgent: true,
    fields: [
      { ...PROMPT_FIELD, required: false },
      { id: 'maxIterations', label: 'Iteration ceiling', type: 'number', min: 1, max: 8, hint: 'Defaults to 3. Never more than 8.' },
    ],
    output: { description: 'Whether the checks went green, and how many iterations it took.' },
  },
  workflow: {
    label: 'Run a workflow',
    description: 'Start one saved workflow in a child task and wait for its result.',
    icon: 'workflow',
    fields: [{
      id: 'childWorkflow',
      label: 'Child workflow',
      type: 'child-workflow',
      required: true,
      hint: 'Pick a workflow available to this project, then bind its declared inputs.',
    }],
    output: { description: 'The child task, run status, and declared named outputs.', schema: { type: 'object', properties: { outputs: { type: 'object' } }, required: ['outputs'] } },
  },
  'workflow-map': {
    label: 'For each',
    description: 'Start one saved workflow in a child task for each selected item.',
    icon: 'git-fork',
    fields: [
      {
        id: 'items',
        label: 'Items',
        type: 'workflow-map-source',
        required: true,
        hint: 'Select an array from a structured predecessor result.',
      },
      {
        id: 'itemKey',
        label: 'Item key pointer',
        type: 'workflow-json-pointer',
        required: false,
        placeholder: '/id',
        hint: 'A safe JSON Pointer to a nonempty string or finite number that identifies each item.',
      },
      {
        id: 'childWorkflow',
        label: 'Child workflow',
        type: 'child-workflow',
        required: true,
        hint: 'Pick a workflow available to this project, then bind its declared inputs.',
      },
      {
        id: 'title',
        label: 'Child task title',
        type: 'workflow-title',
        required: false,
        hint: 'Write a title template and bind each placeholder to a string value.',
      },
    ],
    output: { description: 'One result per source item, in source order, with its task, run, status, and declared outputs.', schema: { type: 'object', properties: { children: { type: 'array', items: { type: 'object' } } }, required: ['children'] } },
  },
}

/** Which built-in fields are named fields on the step rather than keys in `with`. Every built-in
 *  field is, and everything a plugin contributes is not, so the default answer is `'with'`. */
export const FIELD_HOME: Readonly<Record<string, Readonly<Record<string, 'step' | 'with'>>>> =
  Object.fromEntries(
    Object.entries(BUILTIN_STEP_DESCRIPTIONS).map(([kind, describe]) => [
      kind,
      Object.fromEntries(describe.fields.map((field) => [field.id, 'step' as const])),
    ]),
  )

export const fieldHome = (kind: string, fieldId: string): 'step' | 'with' => FIELD_HOME[kind]?.[fieldId] ?? 'with'

/** The kinds that run an agent, and so may carry `isolation`, `inputs` and `configOptions`. Read off
 *  the descriptions rather than written out again, so a kind cannot claim one and not the other. */
export const BUILTIN_AGENT_STEP_KINDS: ReadonlySet<string> = new Set(
  Object.entries(BUILTIN_STEP_DESCRIPTIONS).filter(([, describe]) => describe.runsAgent).map(([kind]) => kind),
)

/** A field's value, wherever it lives. A dotted id addresses a nested named field. */
export function readStepField(step: { with?: Record<string, unknown> } & Record<string, unknown>, kind: string, fieldId: string): unknown {
  if (fieldHome(kind, fieldId) === 'with') return step.with?.[fieldId]
  return fieldId.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], step)
}
