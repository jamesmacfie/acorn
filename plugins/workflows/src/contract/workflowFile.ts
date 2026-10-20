// Every key a `.acorn/workflows/*.toml` file can hold, with what it does, for people writing one by hand
// (docs/workflows/definitions.md). The public site renders it as the file's field reference.
//
// The loader (`parseWorkflowToml`) and the writer (`writeWorkflowToml`) define the format. This table
// describes it, and the `workflowFile.test.ts` beside the writer holds the two together: every key the
// writer produces must be here, and every key here must be one the writer produces or the loader alone
// reads.

/** One key in a table of the file. */
type WorkflowFileField = { key: string; type: string; description: string }

/** A table in the file. `path` is where it sits, such as `steps[].agent` for the `agent` table inside
 *  each `[[steps]]`. `alsoAt` lists other places the same table appears. */
export type WorkflowFileTable = { path: string; title: string; fields: WorkflowFileField[]; alsoAt?: string[] }

const BINDINGS =
  'A table with one entry per name, each holding `binding_json`: a typed binding as JSON, which reads a literal, a run input, a pointer into an earlier step’s output, or, inside a For each, the current item.'

export const WORKFLOW_FILE_TABLES: WorkflowFileTable[] = [
  {
    path: '',
    title: 'The workflow',
    fields: [
      { key: 'baseline', type: 'string', description: 'Required. Always `"acorn-1"`. A file without it is refused.' },
      { key: 'format_version', type: 'integer', description: 'Required. Always `1`. A file without it is refused.' },
      {
        key: 'name',
        type: 'string',
        description: 'The name lists and the run pane show. Defaults to the file name without `.toml`.',
      },
      {
        key: 'posture',
        type: 'string',
        description:
          '`"gated"`, the default, or `"autonomous"`. An autonomous run passes every Wait for a person step without asking, refuses an agent’s permission requests, and cancels its questions. It must set `[tools]`.',
      },
      {
        key: 'trigger',
        type: 'string',
        description: 'Ignored. A workflow starts on its own through a trigger in the Workflows list.',
      },
      {
        key: 'max_descendants',
        type: 'integer',
        description:
          'How many child workflow runs the whole run may start, at every level. From 1 to 500, and 100 by default.',
      },
      {
        key: 'max_concurrency',
        type: 'integer',
        description:
          'How many of this run’s agent turns may run at once. From 1 to 4, the Node’s own limit, which is the default.',
      },
      {
        key: 'outputs_json',
        type: 'JSON string',
        description:
          'The run’s named results, as a JSON array of `{ name, label?, schema, required?, binding }`. Each binds a value from a finished step. A workflow run as a child step hands these to its parent.',
      },
      { key: 'tools', type: 'table', description: 'The riskiest tool any step may use. See `[tools]`.' },
      { key: 'budget', type: 'table', description: 'Limits on the whole run. See `[budget]`.' },
      { key: 'inputs', type: 'array of tables', description: 'The values a run starts with. See `[[inputs]]`.' },
      { key: 'steps', type: 'array of tables', description: 'Required. The steps, in order. See `[[steps]]`.' },
    ],
  },
  {
    path: 'tools',
    alsoAt: ['steps[].tools'],
    title: 'Tool limit',
    fields: [
      {
        key: 'max_risk',
        type: 'string',
        description:
          'The riskiest tool an agent may use: `"read"`, `"write"`, or `"execute"`. A step’s own `[steps.tools]` can narrow the workflow’s limit, and never widen it.',
      },
      { key: 'allow', type: 'array of strings', description: 'The only tools an agent may use, by name.' },
    ],
  },
  {
    path: 'budget',
    alsoAt: ['steps[].budget'],
    title: 'Budget',
    fields: [
      {
        key: 'max_wall_time_ms',
        type: 'integer',
        description:
          'The longest the run, or a step, may take, in milliseconds. A step’s must fit inside the run’s. Without either, each agent turn has 10 minutes.',
      },
      { key: 'max_cost_usd', type: 'number', description: 'The most the agents may spend, in US dollars.' },
      { key: 'max_input_tokens', type: 'integer', description: 'The most input tokens the agents may use.' },
      { key: 'max_output_tokens', type: 'integer', description: 'The most output tokens the agents may use.' },
      {
        key: 'max_turns',
        type: 'integer',
        description: 'The most agent turns, counting the ones acorn sends to finish a step.',
      },
    ],
  },
  {
    path: 'inputs[]',
    alsoAt: ['steps[].form.fields[]'],
    title: 'Inputs and form fields',
    fields: [
      { key: 'name', type: 'string', description: 'Required. What `${inputs.<name>}` and bindings call it.' },
      { key: 'label', type: 'string', description: 'What the start dialog, or the gate’s form, calls it.' },
      { key: 'description', type: 'string', description: 'A sentence under the field.' },
      {
        key: 'required',
        type: 'boolean',
        description:
          'Whether a run, or an approval, needs a value. A required input with no default stops the run from starting.',
      },
      {
        key: 'default',
        type: 'any',
        description: 'Read only from an input with no `schema_json`, which acorn refuses. Use `default_json`.',
      },
      {
        key: 'schema_json',
        type: 'JSON string',
        description:
          'Required. The value’s type, as a JSON Schema in a string, such as `\'{ "type": "string" }\'`. Values cross into steps as that type, not as text.',
      },
      {
        key: 'default_json',
        type: 'JSON string',
        description: 'The default as JSON, for an input with `schema_json`.',
      },
      {
        key: 'connection_json',
        type: 'JSON string',
        description: 'Makes the input a choice of connection for a data source, as JSON naming the source.',
      },
    ],
  },
  {
    path: 'steps[]',
    title: 'Steps',
    fields: [
      {
        key: 'id',
        type: 'string',
        description:
          'Required. A stable ID that `after`, branches, bindings, and `${steps.<id>.output}` use. Renaming a step doesn’t change it.',
      },
      { key: 'name', type: 'string', description: 'The label the editor and the run pane show.' },
      {
        key: 'kind',
        type: 'string',
        description: 'What the step does, such as `"gate-human"` or `"terminal:command"`. Defaults to `"agent"`.',
      },
      {
        key: 'after',
        type: 'array of strings',
        description:
          'The IDs of the steps this one waits for. Leave it out to wait for the step above, and write `[]` to start at once.',
      },
      {
        key: 'workflow',
        type: 'string',
        description:
          'Copies another workflow file’s steps in here, by its file name without `.toml`, with their IDs prefixed by that name.',
      },
      {
        key: 'prompt',
        type: 'string',
        description: 'What the agent is asked. Takes `${inputs.<name>}` and `${steps.<id>.output}`.',
      },
      {
        key: 'goal',
        type: 'string',
        description:
          'Agent steps. What must be true before the step is done. acorn checks it after each turn and keeps the agent working while it isn’t met.',
      },
      {
        key: 'schema_json',
        type: 'JSON string',
        description:
          'Agent steps. A JSON Schema the step’s answer must match. Later steps then read fields from it, not prose.',
      },
      {
        key: 'profile',
        type: 'string',
        description: 'Agent steps. The harness to run, such as `"codex"`. Defaults to `"claude-code"`.',
      },
      {
        key: 'model',
        type: 'string',
        description: 'Agent steps. The model to ask for. Leave it out to use the harness’s own.',
      },
      {
        key: 'config_options',
        type: 'table of strings',
        description:
          'Agent steps. Harness options and their values, such as `reasoning = "high"`. An option the harness doesn’t offer is skipped and noted in the transcript.',
      },
      {
        key: 'isolation',
        type: 'string',
        description:
          'Agent steps. `"shared"`, the default, runs in the run’s own task. `"worktree"` gives the step a child task with its own worktree.',
      },
      {
        key: 'inputs',
        type: 'string',
        description:
          'Agent steps. `"append"`, the default, hands the agent the output of each step it waits for. `"template"` hands over only what the prompt names, and `"none"` hands over nothing.',
      },
      {
        key: 'requires_run',
        type: 'string',
        description: 'Agent steps. A run target to start first. Its address is added to the prompt.',
      },
      {
        key: 'branches',
        type: 'table of strings',
        description:
          'Which step each answer leads to. `decide` names its verdicts, `if` uses `true` and `otherwise`, and `gate-policy` uses `pass`, `fail`, and `timed-out`. Every target must wait for this step.',
      },
      {
        key: 'policy',
        type: 'string',
        description: '`gate-policy` steps. The policy to ask, such as `"github:ci-settled"`.',
      },
      {
        key: 'timeout_ms',
        type: 'integer',
        description:
          '`gate-policy` steps. How long to keep asking. Without it, the gate asks once and reads "not yet" as a failure.',
      },
      {
        key: 'interval_ms',
        type: 'integer',
        description:
          '`gate-policy` steps. How long to wait between asks. At least 30,000 or the policy’s own minimum, and 60,000 by default.',
      },
      {
        key: 'max_iterations',
        type: 'integer',
        description: '`ci-loop` steps. The most rounds of fixing before the step stops.',
      },
      {
        key: 'checks_timeout_ms',
        type: 'integer',
        description: '`ci-loop` steps. How long each round waits for the checks to finish. 1,800,000 by default.',
      },
      {
        key: 'query_json',
        type: 'JSON string',
        description: '`find-records` steps. The query to run, written out or naming a saved query.',
      },
      {
        key: 'incremental',
        type: 'boolean',
        description:
          '`find-records` steps. Reads only the records past where this step’s last run stopped. The step must feed one For each.',
      },
      {
        key: 'record_json',
        type: 'JSON string',
        description: '`get-record-details` steps. A binding to the record to read.',
      },
      {
        key: 'projection',
        type: 'array of strings',
        description: '`get-record-details` steps. JSON Pointers to the fields to read, to read fewer than all of them.',
      },
      { key: 'condition_json', type: 'JSON string', description: '`if` steps. The typed comparison to make.' },
      {
        key: 'dataset_json',
        type: 'JSON string',
        description:
          '`write-dataset` steps. The dataset to write, its schema version, and a binding to the rows: `{ id, version, rows }`.',
      },
      {
        key: 'child_workflow',
        type: 'table',
        description: '`workflow` and `workflow-map` steps. The workflow to start. See `[steps.child_workflow]`.',
      },
      {
        key: 'agent',
        type: 'table',
        description: '`workflow-map` steps. The agent each item gets. See `[steps.agent]`.',
      },
      {
        key: 'items',
        type: 'table',
        description: '`workflow-map` steps. Where the list comes from. See `[steps.items]`.',
      },
      {
        key: 'item_key',
        type: 'string',
        description: '`workflow-map` steps. A JSON Pointer to the field that tells two items apart.',
      },
      {
        key: 'title',
        type: 'table',
        description: '`workflow-map` steps. The title of each item’s task. See `[steps.title]`.',
      },
      {
        key: 'repeat',
        type: 'table',
        description:
          '`workflow-map` steps. Which items to run again on a later run: `mode` is `"every-match"`, `"unseen"`, or `"changed"`, and `"changed"` also takes `fields`, the JSON Pointers to compare.',
      },
      {
        key: 'form',
        type: 'table',
        description: '`gate-human` steps. Values a person checks before approving. See `[steps.form]`.',
      },
      {
        key: 'with',
        type: 'table',
        description:
          'A plugin step’s settings, and a `gate-policy` step’s policy settings. Strings take `${inputs.<name>}` and `${steps.<id>.output}`.',
      },
      { key: 'tools', type: 'table', description: 'Narrows the workflow’s tool limit for this step. See `[tools]`.' },
      { key: 'budget', type: 'table', description: 'Limits on this step alone. See `[budget]`.' },
    ],
  },
  {
    path: 'steps[].agent',
    title: 'For each agent',
    fields: [
      {
        key: 'prompt',
        type: 'string',
        description: 'Required. What each item’s agent is asked. It gets its item without being told.',
      },
      { key: 'goal', type: 'string', description: 'What must be true before each item is done.' },
      { key: 'profile', type: 'string', description: 'The harness to run.' },
      { key: 'model', type: 'string', description: 'The model to ask for.' },
      { key: 'config_options', type: 'table of strings', description: 'Harness options and their values.' },
      { key: 'schema_json', type: 'JSON string', description: 'A JSON Schema each item’s answer must match.' },
      {
        key: 'on_failure',
        type: 'string',
        description: '`"continue"` carries on with the other items when one fails, and `"stop"` starts no more.',
      },
    ],
  },
  {
    path: 'steps[].child_workflow',
    title: 'Child workflow',
    fields: [
      { key: 'ref', type: 'table', description: 'Required. Which workflow. See `[steps.child_workflow.ref]`.' },
      { key: 'inputs', type: 'table', description: `The child’s inputs. ${BINDINGS}` },
    ],
  },
  {
    path: 'steps[].child_workflow.ref',
    title: 'Child workflow reference',
    fields: [
      {
        key: 'source',
        type: 'string',
        description:
          '`"repo"` for a file in the project, `"user"` for a file in `~/.acorn/workflows`, or `"database"` for one written in the app.',
      },
      {
        key: 'path',
        type: 'string',
        description: 'For `"repo"`: the file’s path in the project, such as `".acorn/workflows/review.toml"`.',
      },
      { key: 'id', type: 'string', description: 'For `"user"` and `"database"`: the workflow’s ID.' },
    ],
  },
  {
    path: 'steps[].items',
    title: 'For each items',
    fields: [
      { key: 'step', type: 'string', description: 'The ID of the earlier step whose answer holds the list.' },
      {
        key: 'pointer',
        type: 'string',
        description: 'A JSON Pointer to the list in that answer, such as `"/tickets"`.',
      },
    ],
  },
  {
    path: 'steps[].title',
    title: 'For each task title',
    fields: [
      { key: 'template', type: 'string', description: 'The title, with `${<name>}` for each binding.' },
      { key: 'bindings', type: 'table', description: `The values the title uses. ${BINDINGS}` },
    ],
  },
  {
    path: 'steps[].form',
    title: 'Gate form',
    fields: [
      {
        key: 'fields',
        type: 'array of tables',
        description: 'Up to 20 fields, each declared like an input. See `[[inputs]]`.',
      },
      { key: 'values', type: 'table', description: `Where each field’s proposed value comes from. ${BINDINGS}` },
    ],
  },
]

/** Keys the loader accepts that the writer never writes: one a loaded file has already used, or one
 *  the loader ignores so an older file still loads. */
export const WORKFLOW_FILE_LOADER_ONLY = ['steps[].workflow', 'trigger']
