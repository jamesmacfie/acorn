// How the nine built-in kinds describe themselves, and where each of their fields lands
// (docs/workflows.md § Contributed step kinds).
//
// Here rather than beside the handlers in ../server/workflowBuiltins.ts for two reasons. The editor
// runs on the client and needs the same table, and ../server/workflowValidation.ts reads `runsAgent`
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
    label: 'Decide a branch',
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
    fields: [],
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
  'fan-out': {
    label: 'Fan out',
    description: 'Ask an agent for a list of tasks, then run one child agent per item, each in its own worktree.',
    icon: 'split',
    runsAgent: true,
    fields: [
      PROMPT_FIELD,
      { id: 'childStep.prompt', label: 'Child prompt', type: 'prompt' },
      { id: 'childStep.profileId', label: 'Child profile', type: 'select' },
      { id: 'childStep.model', label: 'Child model', type: 'select' },
    ],
    output: { description: 'The list the planning agent produced, and how many children failed.' },
  },
  join: {
    label: 'Collect the children',
    description: 'Wait for a fan-out’s children and gather what each one returned.',
    icon: 'merge',
    fields: [{ id: 'joins', label: 'Fan-out step', type: 'select', required: true, hint: 'A fan-out step this one waits on.' }],
    output: { description: 'One row per child: its name, its status, and its structured result.' },
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
    output: { description: 'The child task, run status, and bounded result summary.' },
  },
  'workflow-map': {
    label: 'Map to workflows',
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
        required: true,
        placeholder: '/id',
        hint: 'A safe JSON Pointer to a nonempty string that identifies each item.',
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
        required: true,
        hint: 'Write a title template and bind each placeholder to a string value.',
      },
    ],
    output: { description: 'One result per source item, in source order, with its task, run, status, and summary.' },
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

/** A field's value, wherever it lives. A dotted id addresses a nested named field, as `fan-out`'s
 *  child prompt does. */
export function readStepField(step: { with?: Record<string, unknown> } & Record<string, unknown>, kind: string, fieldId: string): unknown {
  if (fieldHome(kind, fieldId) === 'with') return step.with?.[fieldId]
  return fieldId.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown> | undefined)?.[part], step)
}
