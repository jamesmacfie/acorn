# Workflows

Workflows are durable orchestration on the Node: a graph of steps, such as agent turns, commands,
data reads, and human gates, that runs on a task. Read this page for the version 1 definition values,
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

## Pages

<a id="execution-model"></a>

- [Workflow execution](./workflows/execution.md): the execution model, the graph, what an agent step
  sees, isolation, retry, and human gates.
- [Agent steps](./workflows/agent-steps.md): what an agent step sees, and a turn that ends early.
- [Running child workflows](./workflows/child-runs.md): what a run reports, where a file comes from,
  child workflow tasks, and live output.

<a id="authoring"></a>

- [Workflow authoring](./workflows/authoring.md): the editor, scheduling, child workflows, and AI
  generation.
- [AI authoring](./workflows/ai-authoring.md): generating and editing with a model.
- [Editor details](./workflows/editor-details.md): the draft rules, the graph view, the JSON tab,
  saving, and where positions live.

<a id="database-definitions"></a>
<a id="draft-recovery-and-publication"></a>

- [Workflow definitions](./workflows/definitions.md): the two stores, starting by ID, and drafts and
  publication.

<a id="file-drafts-and-portable-export"></a>

- [File drafts and portable export](./workflows/file-drafts.md).

<a id="contributed-step-kinds"></a>
<a id="a-kind-describes-its-own-form"></a>
<a id="the-kinds-other-plugins-contribute"></a>
<a id="progress-events"></a>

- [Contributed step kinds](./workflows/step-kinds.md): kinds, policies, triggers, and progress events.

<a id="routes-and-ui"></a>
<a id="the-run-pane"></a>
<a id="what-the-pane-listens-to"></a>
<a id="getting-there-from-somewhere-else"></a>

- [Routes and UI](./workflows/routes-and-ui.md): the run pane and its frames.

<a id="starting-a-run-from-an-item"></a>
<a id="from-the-command-palette"></a>

- [Starting runs](./workflows/starting-runs.md): **Start workflow…** on a row, and palette rows.

<a id="typed-data-and-conditions"></a>

- [Typed data and conditions](./workflows/typed-data.md): `find-records`, `get-record-details`, and
  `if`.

<a id="record-processing-history"></a>

- [Record processing history](./workflows/record-history.md): the processing ledger and checkpoints.

<a id="scheduled-roots"></a>

- [Scheduled roots](./workflows/scheduled-roots.md): workflows on a Node schedule.

<a id="what-workflows-refuses"></a>

- [What workflows refuses](./workflows/refusals.md): settled decisions and what would reopen them.

<a id="gaps"></a>

Known gaps are in [docs/future/workflows-gaps.md](./future/workflows-gaps.md).
