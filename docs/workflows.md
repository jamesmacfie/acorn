# Workflows

Workflows are durable orchestration on the Node: a graph of steps, such as agent turns, commands,
data reads, human gates, and gates that wait for CI or a review, that runs on a task. Read this page for the version 1 definition values,
limits, trust, and triggers, and for the topic pages. The plugin is in `plugins/workflows/`.

A definition is a committed `.acorn/workflows/*.toml` file or a `workflow_defs` row you typed in the
app, and the Node reads both as one list. SQLite stores expanded runs, steps, gates, trigger cursors,
and recovery state. The headless [CLI](./cli.md) lists published definitions, starts a run by its ID
with typed JSON inputs, and inspects or waits on runs and steps. The Node owns definition resolution,
trust, gates, recovery, and execution.

## Version 1 values

Definitions require `baseline: "acorn-1"` and `formatVersion: 1`, written `baseline = "acorn-1"` and
`format_version = 1` in TOML. Each step has a stable `id` and a separate human-readable `name`. Edges,
branches, bindings, prompt references, and layout positions use the ID, so renaming changes only the
label. An omitted `after` means the preceding step, and explicit edges survive reordering. The editor
gives a step its ID once, when it's created.

Inputs declare the shared structural `schema`, optional `label` and `description`, `required`, and a
typed `default`. Numbers, booleans, nulls, arrays, and objects cross start routes, run snapshots, and
child dispatch without conversion. A missing optional value is omitted, and a missing required value
fails admission. An explicit null is validated as a value and isn't replaced by a default.

Bindings use the shared data address vocabulary:

- `{ address: { from: "literal", value } }`
- `{ address: { from: "input", name, pointer } }`
- `{ address: { from: "step", stepId, pointer } }`
- An `item` address with a pointer, inside a map.

An empty pointer selects the whole value. `fallback` applies only to missing values. The explicit
conversions are `scalar-to-text` and `json-to-text`. Only completed transitive predecessors reach a
handler's `predecessorValues`, so a completed sibling can't supply a binding.
Workflow query bindings can also use Node-resolved `context` addresses for the selected account's
`viewer`, the workspace's linked external IDs, and `now` or a local `calendar` boundary with ISO 8601
offsets. The Node resolves these at the frozen query evaluation time before calling the source.

Named definition `outputs` declare `{ name, schema, binding, required? }`, binding completed step
values. A child step exposes them as `outputs` beside its task, run, and status, so a consumer doesn't
read the last transcript message. The Node validates step outputs before completing a step, and
declared outputs before completing a run. Workflow values are bounded by the shared 16 MiB selection
limit. Prompt and title rendering serializes objects deterministically without truncation.

TOML stores structural schemas in `schema_json`, typed defaults in `default_json`, typed bindings in
`binding_json`, and named outputs in `outputs_json`, because JSON keeps nested nulls and mixed arrays
that TOML can't. The basic input editor handles typed defaults, and the JSON tab exposes the whole
contract.

An unversioned definition, a missing stable ID, an old binding table, or an unknown version is refused
with a diagnostic that names the file. There's no read-time normalization or execution adapter.

The built-in `write-dataset` step binds an array from a completed predecessor to
`dataset: { id, version, rows }`. The Node derives workspace and project from the running task,
requires a workflow-fed dataset there, validates the current schema version and every row, and
writes them transactionally. A scheduled workflow can use the same step; the step does not create or
change dataset definitions.

Dashboard board moves use source-declared field mutations through the Node's `act` route. They do not
add a generic provider write-back step or change workflow data-source reads.

## Limits and capabilities

The runtime enforces workspace and provider concurrency ceilings, per-step tool ceilings, time
budgets, and task ownership. Agent steps use the agents capability, run targets use terminal
capabilities, and GitHub checks are optional. A disabled provider leaves its step unavailable and
shown as a problem, rather than quietly picking another implementation.

## Configuration trust

Workflow files and executable URL and run-target scripts are repository-authored executable
configuration. The Node hashes the exact snapshot, requires an acknowledgement, and fails closed if
the snapshot changes. Docker's declarative matching data is outside this gate, but commands that start
or stop services are trust-checked. A `workflow_defs` row isn't repository-authored and isn't hashed
([database definitions](./workflows/definitions.md#database-definitions)).

## Triggers

A trigger contributed to `workflows:trigger` is asked on each sweep which workflows should start. The
sweep runs on the Node's scheduler at the plugin cadence floor of 300 seconds, so a trigger fires on a
machine nobody is looking at. There's no separate "check now" route: use the scheduler's own **Run
now** on Settings → Schedules ([schedules](./schedules.md)).

## Workflow runs source

The plugin serves the **Workflow runs** data source (`workflows:runs`), one record per run from
`workflow_runs`, child runs included. Use it in a dashboard to see which workflows fail most, how
long runs take, and what ran this week. The description and starters are in
`plugins/workflows/src/shared/runSource.ts`, and the read is in
`plugins/workflows/src/server/data/runSourceHandler.ts`.

A record carries the workflow's name, its status with a tone, what started it, its task and project,
its parent run and nesting depth, and its start and last update times. It also carries the first
line of its error or cancel reason, capped at 200 characters, and its duration once the run reaches
a final status. A run retried after it settled measures to its latest final status. Selecting a row
opens the run pane on that run.

The source scopes a workspace or project through its task ids. It pushes the start-time window and
equality filters on workflow, status, trigger, task, and parent run into SQL, on the
`(task_id, created_at)` index. It reads newest first, up to the host's 5,000-record budget, and
reports `incomplete` with `host-budget` when that budget cuts the window. Its four starters chart
runs by workflow and status, average run time by workflow, this week's runs, and a weekday-by-hour
heatmap of when runs start.

## Pages

- [Workflow execution](./workflows/execution.md): the execution model, the graph, what an agent step
  sees, isolation, retry, and human gates.
- [Polling gates](./workflows/polling-gates.md): gates that wait for CI or a review, the checkout while
  a run waits, and `ci-loop`.
- [Agent steps](./workflows/agent-steps.md): what an agent step sees, and a turn that ends early.
- [Running child workflows](./workflows/child-runs.md): what a run reports, where a file comes from,
  child workflow tasks, and live output.
- [Workflow tools](./agent-tools/workflow-tools.md): how an agent finds workflows, saves drafts, and
  starts one you approved for agents.

- [Workflow authoring](./workflows/authoring.md): the editor, scheduling, child workflows, and AI
  generation.
- [AI authoring](./workflows/ai-authoring.md): generating and editing with a model.
- [Editor details](./workflows/editor-details.md): the draft rules, the graph view, the JSON tab,
  saving, and where positions live.

- [Workflow definitions](./workflows/definitions.md): the two stores, starting by ID, and drafts and
  publication.

- [File drafts and portable export](./workflows/file-drafts.md).

- [Contributed step kinds](./workflows/step-kinds.md): kinds, gate policies, triggers, and progress
  events.

- [Routes and UI](./workflows/routes-and-ui.md): the run pane and its frames.

- [Starting runs](./workflows/starting-runs.md): **Start workflow…** on a row, and palette rows.

- [Typed data and conditions](./workflows/typed-data.md): `find-records`, `get-record-details`, and
  `if`.

- [Record processing history](./workflows/record-history.md): the processing ledger and checkpoints.

- [Scheduled roots](./workflows/scheduled-roots.md): workflows on a Node schedule.

- [What workflows refuses](./workflows/refusals.md): settled decisions and what would reopen them.

Known gaps are in [docs/future/workflows-gaps.md](./future/workflows-gaps.md).
