# Workflows

Workflows are durable Node orchestration. A definition is either a committed
`.acorn/workflows/*.toml` file or a `workflow_defs` row the owner typed in the app, and the two are
read as one list. SQLite stores expanded runs, steps, gates, trigger cursors, and recovery state.

## Execution model

The workflow loader parses and validates a definition, rejects cycles, expands static branches, and
checks the exact repository configuration trust snapshot before starting a run from a committed file. Steps can invoke
managed agent sessions, terminal/run targets, GitHub checks policies, or human gates. Structured step
output is the only value that controls branching and joins; transcript prose cannot satisfy a gate.

Runs and steps persist state transitions. A restart reconciles persisted operation IDs and never
blindly repeats an external side effect with unknown outcome. Ambiguous work parks in an explicit
recovery/gated state. Cancellation propagates to child sessions and process groups.

### The graph

A step declares `after`, the names of the steps it waits on. A step with no `after` key waits on the
step declared before it, and `after = []` makes it a root. Edges are derived from that and never
stored, so a file written as a plain list still runs as the chain it always was.

The runner keeps one rule: a step is ready when every step in its `after` is `done`. Every ready step
starts at once, up to the four-slot headless semaphore fan-out children already queue on. A step that
ended `skipped` counts as done for readiness, because a skip is how a branch is not taken and the
step after the decision still has to run. `idx` is the declaration order and nothing but the row
insert reads it.

A `decide` step's `branches` map a verdict to a step name, and each target must have the deciding
step among its predecessors. When the verdict picks one target, every other target is marked
`skipped`, and so is every step whose only path back to a root runs through a skipped step. A step
that a taken branch also reaches stays pending and runs when its live predecessors finish.

Validation follows the graph rather than the list. `${steps.<name>.output}` must name a transitive
predecessor, because two roots are not ordered and a step beside this one may well have run first and
still be the wrong thing to read. A cycle is refused and the error names it, as `a → b → a`.

### Inputs

A definition declares `[[inputs]]`, each with a `name`, an optional `description`, `required`, and
`default`. A run starts with a value per input. The start route refuses a run that misses a required
input with no default, and refuses a value for a name the definition does not declare.

`${inputs.<name>}` renders wherever `${steps.<name>.output}` renders: a prompt, a child prompt, and
every string value inside `[steps.with]`, one level deep. A contributed kind receives its `with`
already rendered, so a step handler sees the substituted command and never the template. A run
freezes the values it started with into its own copy of the definition, so the definition a finished
run shows says what it was given.

### What an agent step sees

An agent step takes `inputs = "append" | "template" | "none"`, default `append`. With `append`, the
runner renders the prompt and then adds one `## Output of <name>` block per incoming edge whose step
finished `done`, in `after` order. With `template`, nothing is added and the prompt places its own
`${steps.<name>.output}` references. With `none`, the step sees only its prompt. The handoff context
rides along in every mode, because that is a separate thing from the graph's edges.

An agent step also takes `config_options`, a table of provider option ids to values as the provider
advertises them, such as `model` and `reasoning`. The runner hands them to the agents plugin, which
applies them to the session after the provider reports its option list and before the turn is
enqueued. A value the provider does not offer is dropped and recorded in the transcript rather than
failing the step. Where a step sets both `model` and `config_options.model`, validation refuses the
file.

### Isolation

An agent step with `isolation = "worktree"` runs on a child task with a checkout of its own, created
through `CoreServices.tasks.createChild()` with a branch derived from the run name and the step name.
The child task id lands in the step's `inputs_json`, the same field fan-out children use, so
cancelling the run reaches it. The default, `shared`, runs the step on the run's own task beside its
siblings. Two investigators reading the same checkout do not need a worktree each, and paying for one
is what made fan-out feel heavy.

### Retry

`POST /v2/p/workflows/workflows/runs/:runId/retry` takes a `stepId` and an optional `prompt`. The run
must be `failed` or at a safety rail, and so must the step. The step goes back to `pending` with its
error cleared and its iteration count kept, every skipped step that only the retried step could reach
comes back with it, and the run returns to `running`. A step with a managed session reuses it, so a
retry with an edited prompt is another turn in the session the owner is already watching.

An edited prompt patches the run's frozen definition for that step alone. The original is kept in the
step's `inputs_json` as `originalPrompt`, so the record of what was first asked survives the re-run.

Retry is a device action. A task-confined caller, meaning an agent inside the run, gets a 403,
because it could otherwise loop a failed step past the rail that stopped it. The budget rule holds
either way: a retry's usage adds to the run's persisted sum and the same rail fires again.

### Fan-out, and where a file comes from

A step that fans out into parallel branches creates each branch as a child task under the workflow's
own task, through `CoreServices.tasks.createChild()`. `resolveCwd()` creates the child's worktree
lazily, when its first step runs, the same path every other task-worktree consumer takes. Cancelling
one branch calls `CoreServices.tasks.cancel()`, a separate verb from the general task lifecycle so a
plugin cannot use this seam to archive or restore a task outside core's own routes. A child's
proposed branch name is checked against every task, not only its siblings, because a worktree is
keyed on the branch and a collision with an unrelated task would hand two tasks one checkout.

Workflow files load from the repo checkout or worktree and layer over `~/.acorn/workflows` the same
way `config.toml` layers repo before user, so a repo-defined id wins over a user one. Database rows
sit under both, as § Database definitions describes. A step can
reference another workflow by id. The reference expands inline, one level of nesting, and a chain
that revisits an id is rejected as a cycle rather than followed into a hang. A malformed file
surfaces as an error row instead of being skipped silently. A sub-workflow's steps are prefixed with
its id, and so are the `after` and `joins` names inside it, so an expanded block keeps its own shape
inside the outer graph.

## Database definitions

A definition does not have to be a file. `workflow_defs`, in this plugin's own SQLite file, holds one
the owner typed in the app: a workspace id, an optional project id, the definition as JSON, and a
`revision` that a save checks. A row bound to no project can run on any task in its workspace.

**Two stores, one read.** `GET /v2/p/workflows/defs?workspaceId=` folds three layers into one list:
this workspace's rows, every project's committed files, and `~/.acorn/workflows`. A repo id beats a
user id beats a row id, so a definition somebody can review in a pull request always wins. Each entry
says which layer it came from and which project it belongs to. The task-scoped
`GET /v2/p/workflows/tasks/:id/workflows` answers the same three layers for one task, which is what
the palette searches.

**Two trust stories.** A committed file is executable configuration somebody put in the repository,
so starting a run from one hashes the snapshot and asks for an acknowledgement. A row was typed by
the node's owner in this app, behind the device gate, so there are no committed bytes to hash and the
snapshot check does not apply. That is the whole reason every route under `/v2/p/workflows/defs` is
device-only, and the reason a start by id refuses a row to a task-confined caller: an agent inside a
run may start a file, because the snapshot covers it, and may not start a row.

**Starting by id.** `POST /v2/p/workflows/tasks/:id/workflows` takes either the whole definition or
`{ defId }`. A `defId` of `repo:<fileId>` or `user:<fileId>` names a file the task's project loads;
anything else names a row. The node resolves it and applies the layer's own rule, which is stronger
than trusting a `source` field in the request body.

**What a row may name.** A run target, a saved query, or an agent profile is checked when the step
runs, not when the row is saved. The node holding a definition may not have the repository at all, so
`POST /v2/p/workflows/defs/validate` answers the loader's own problem list and leaves the
project-specific names to the step handlers.

**Save to repo.** `POST /v2/p/workflows/defs/:id/save-to-repo` writes the row as
`.acorn/workflows/<slug>.toml` in the task's checkout, or in the project folder when no task is
given, and deletes the row unless `keepRow` is set. The file id is a slug of the definition name,
deduplicated against the folder, so nothing a person types can address a path. The write is confined
to the checkout by the same symlink-aware check every other checkout write takes, and it lands
through a temporary file and a rename. From then on the trust snapshot covers the file, and the next
start from it asks for the acknowledgement any committed configuration asks for.

`plugin:workflows:defs-changed { workspaceId }` goes out on every write.

A deleted project leaves its rows behind with a `projectId` that resolves to nothing. The merged list
marks those rows rather than hiding them, so they can be rebound or deleted instead of vanishing.

## Authoring

Workflows is a source in the left rail, present in every workspace because nothing has to be
connected for a workspace to have one. Its list holds every definition the workspace can run, read as
one list from the three layers above, with the workspace's recent runs under it. Each row says how
many steps the definition has, which project it belongs to, and which layer it came from. A parse or
cycle error is a row of its own rather than a definition that is quietly missing.

**New workflow** on the list toolbar creates a row named "Untitled workflow", bound to the project
the rail is showing, and opens it. The same verb is a palette command, `workflows.new`.

### The editor

Picking a definition goes to `/p/:projectId/x/workflows/:id`, where `:id` is `db:<rowId>` for a row,
`repo:<fileId>` for a committed file, or `user:<fileId>` for one under `~/.acorn/workflows`. The
The editor is drawn by the rail source's detail region, so the terminal client puts the definition
list in its Browse panel and the editor in the main one, and the editor's own node list and inspector
are a `list-detail` pair inside that. Every control is a kit node, so none of this is plugin code
either host had to be given.

The list column holds three kinds of row. **Definition** carries the workflow's name, its posture,
its tool ceiling and its budget. **Inputs** carries the values a run is started with. Under them is
the graph in reading order: roots first in declaration order, then each node after the last of the
steps it waits on, indented one level per rank. A node that waits on more than one step carries a
`⇐ n` mark and names them on hover. **Add** is a menu over the catalog's kinds, built-in ones first
and then each plugin's, with the icon and the sentence each kind's `describe` gives.

The inspector draws whatever the list has selected. For a node that is its name, the steps it waits
on as removable chips with a picker beside them, the agent fields when the kind runs an agent, then
the kind's own fields in declared order. A prompt field carries a chip per declared input and per
step that is certain to have finished first, and pressing one appends the reference. A `decide` node
draws its branches as verdict-to-step rows. A `join` node draws a select over the fan-out steps that
run before it. A kind that ships no `describe` draws its `with` table as raw JSON and says so.

The agent fields are the editor's, not any kind's: the harness from the catalog's profiles, then one
select per option that harness advertises through `GET /v2/p/agents/providers`, then where the step
runs and what it does with its upstream outputs. A plugin contributing a kind that runs an agent
never restates the model list.

### The draft rules

These are why the editor is safe to type in:

- A new node takes one edge from the selected node, or none when nothing is selected. It is never
  inserted between two nodes, so adding a step changes nothing about what an existing step waits on.
- Deleting a node removes every edge that touched it and never bridges its predecessor to its
  successor. A chain that loses its middle becomes two roots, which is visible.
- Renaming rewrites `${steps.<old>.output}` in every prompt and every `with` string, plus every
  `after` entry, every branch target and every `joins`. In the draft only, until it is saved. The
  field refuses a duplicate name and anything that is not slug-shaped.
- The picker offers a step as a predecessor only when the edge would be accepted, so a self edge, a
  duplicate and anything that closes a cycle are never on the list.
- Undo and redo cover the whole draft, with typing folded into one step inside a 600 ms window, 60
  deep.
- Save is grey while the draft is unchanged, while a required field is empty, or while the node's
  validate route has a problem with it.

### The JSON tab

The escape hatch: the definition as the runner's own JSON, formatted. **Apply** is atomic. A document
that parses and is a definition replaces the draft; one that does not leaves the draft exactly as it
was, keeps the text for correction, and says what is wrong. **Format** reprints what is in the box
and **Revert** puts the draft's own projection back. Node positions are not in this document.

### Saving

**Save** writes the row at the revision it was read at. A stale revision answers 409 and the draft is
kept, because throwing away what somebody typed to show them what changed is the wrong half to lose.
**Save to repo** writes the definition into the task's checkout as
`.acorn/workflows/<slug>.toml` and keeps the row; § Database definitions holds what that does to
trust. **Run** opens the start dialog, one box per declared input with a task picker when no task is
in scope, and starts the run when the required ones are filled. A definition that declares no inputs
and already has a task starts without a dialog.

A committed file opens in the same editor, read-only, with **Copy to database** in place of Save. So
a workflow somebody reviewed in a pull request is read the same way as one you typed.

### Where positions live

Node positions for the graph view are device preferences under
`plugin:workflows:layout:<defId>`, never in the definition, so a definition stays portable and a
committed file has no x and y in its diff. A rename carries a node's position with it and deleting a
definition drops its layout. Nothing draws a position until the graph view lands
([docs/future/workflows/phase-6-canvas.md](./future/workflows/phase-6-canvas.md)).

## Limits and capabilities

The runtime enforces workspace/provider concurrency ceilings, per-step tool ceilings, time budgets,
and task ownership. Agent steps use the agents capability; run targets use terminal capabilities;
GitHub checks are optional. A disabled provider leaves the corresponding step unavailable and visible
as a problem rather than silently selecting another implementation.

## Contributed step kinds

The seven built-in kinds — `agent`, `gate-human`, `gate-policy`, `ci-loop`, `fan-out`, `join`,
`decide` — are not all there can be. Workflows opens three node extension points
([plugins.md](./plugins.md) § Node-side extension points) and any plugin may fill them:

| Point | What it adds | Named in a file as |
| --- | --- | --- |
| `workflows:step-kind` | a kind the runner dispatches to | a step's `kind` |
| `workflows:policy` | a verdict source for `gate-policy` | a step's `policy` |
| `workflows:trigger` | something that decides which workflows should start | nothing; the sweep asks it |

**A contributed kind is addressed by its qualified id, a built-in by a bare word.** `kind = "agent"`
is the built-in; `kind = "http:request"` is the http plugin's. That is deliberate: the file says which
package will run the step, and two plugins can both call their entry `request` without either
shadowing the other.

A contributed kind's inputs go in `[steps.with]`, an opaque table the runner passes through unread.
The contributing plugin validates it at load time, so a bad step is a red row in the workflow list
rather than a run that starts and fails on its third step, and reads it again in its handler.
Built-in kinds do not use `with`. Their inputs are named fields, which is what keeps them checkable
by the host.

A handler's `with` arrives rendered. `${inputs.x}` and `${steps.x.output}` are substituted one level
deep before the handler runs, so `terminal:command` is handed the command it will run and never a
template.

### A kind describes its own form

A kind can carry a `describe`: a label, an icon, and its inputs as a list of fields. The host draws
that form, on the desktop and in the terminal, so a plugin adds an editable step kind without
shipping a component. `describe` is optional. A kind without one is listed by name with a raw JSON
`with`.

A field is `text`, `textarea`, `number`, `boolean`, `select`, or `prompt`. A `prompt` field is a
textarea that accepts template references. A `select` either lists its `options` or names an
`optionsRoute` in the contributing plugin's own namespace, which answers
`{ options: [{ value, label, description? }] }`.

The host applies `required`, `min`, `max`, and a static select's membership before it calls the
kind's `validate`, and skips `validate` when any of those fail. So a validator can assume the shape
is right and check only the meaning. A field with an `optionsRoute` is not checked at load time,
because the node reading the file may have no way to reach the project the route needs.

The seven built-in kinds describe themselves through the same type, with the fields naming a step's
own keys rather than keys in `with`
(`plugins/workflows/src/shared/stepFields.ts`). The editor does not need to know which is which: it
asks `fieldHome(kind, fieldId)`. A kind whose description says `runsAgent` may also take `isolation`,
`inputs`, and `config_options`, and that is the only way a contributed kind gets them.

`GET /v2/p/workflows/catalog` answers the whole vocabulary: every kind with its description, every
policy, and every agent profile with whether it has a managed driver and a one-shot structured mode.
It is resolved per request rather than cached, because the plugin that fills the point may start
after workflows does.

### The kinds other plugins contribute

| Kind | Owner | What it does |
| --- | --- | --- |
| `http:request` | [http-client.md](./http-client.md) | One HTTP request through the project's variables. |
| `terminal:command` | [terminal.md](./terminal.md) | One shell command in the task's checkout, streamed and captured. |
| `terminal:run-target` | [terminal.md](./terminal.md) | Starts a declared run target and reports its URL. |
| `database:query` | [database.md](./database.md) | A saved query or inline SQL, capped and read-only. |
| `database:generate` | [database.md](./database.md) | A model writes the SQL, then the same read runs it. |

Each lives with the code that already knows how to do the thing safely, which is the rule for
admitting a kind at all. The command kind sits beside the process broker's environment allowlist, the
HTTP kind beside the scheme check that runs after interpolation, the database kinds beside the
connection resolution and the row cap.

### Progress events

A handler's `emit` takes anything, and the run pane shows what it does not recognise as JSON. Four
shapes it does recognise (`plugins/workflows/src/shared/stepEvents.ts`):

| Event | From | Drawn as |
| --- | --- | --- |
| `{ type: 'managed-agent', … }` | agent kinds | State, last assistant text, cost |
| `{ type: 'stdout' \| 'stderr', text }` | `terminal:command` | A tail of the output |
| `{ type: 'progress', text }` | any kind | One line under the node |
| `{ type: 'rows', count }` | database kinds | "n rows" while it runs |

The worked example is `http:request`, contributed by the http plugin, where the post-interpolation
scheme check, the 5 MB response cap and the project's variable layers already live
([http-client.md](./http-client.md)):

```toml
[[steps]]
name = "notify"
kind = "http:request"

[steps.with]
method = "POST"
url = "{{deploy_hook}}"
body = '{"ref": "{{branch}}"}'
```

4xx and 5xx are *answers*, not failures: the step succeeds so a later `decide` can branch on the
status. Only a transport failure, a bad URL, or a smuggled scheme fails the step. An unattended send
writes an audit row ([security.md](./security.md) § The vocabulary is closed) carrying the target's
origin and not the URL, because a query string is where a token ends up when someone puts one there.

## Triggers

A trigger contributed to `workflows:trigger` is asked, on each sweep, which workflows should start.
The sweep runs on **the node's** scheduler at the plugin cadence floor (300s), not on a client clock,
so a trigger fires on a machine nobody is looking at — which was the whole point, and was not true
until 2026-08-28: the sweep used to be a client schedule that skipped ticks while the window was
hidden and never ran at all on a node with no client attached.

There is no separate "check now" route. It is the scheduler's own run-now on Settings → Schedules,
which every schedule already has.

## Routes and UI

Node routes are under `/v2/p/workflows/` and core task run-target routes under
`/v2/core/tasks/:id/run/*`. Both clients draw the Workflows rail source and the editor behind it
(§ Authoring), a Settings page that lists what a task's checkout would load, two command-palette
rows, task activity, gate controls, and attention items. Workflow notices use `/v2/events`. Durable
run history is paged from the plugin database.

## From the command palette

Two rows at the palette root, both registered by this plugin's client half
(`plugins/workflows/src/client/commands.ts`). **New workflow** is project-scoped: it creates a row
bound to the routed project and opens the editor on it, which is the rail toolbar's verb reached
from ⌘K.

**Run a workflow**, registered by this plugin's client half
(`plugins/workflows/src/client/commands.ts`). It is a `search` over every definition the task can
run, which is its repository's committed files, `~/.acorn/workflows`, and this workspace's rows: a
row carries the workflow's name, its step count and its layer, a parse or cycle error is a badged row
at the top of the list rather than a row that is quietly missing, and picking a definition starts it.
There is no group, because one row does not need one.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

The command is task-scoped and gated on the terminal plugin, because the runner is a node engine and
these routes answer 503 on a node that does not run terminals. Definitions load once when the frame
opens and are filtered on the device after that, through the same load-once adapter the terminal's
searches use (`client-core/host/registries/commands/localSearch.ts`): no debounce and no minimum
query, because a read of the repository is not something a keystroke moves. Starting sends the id
rather than the definition, so the node resolves it and, for a committed file, hashes the bytes on
disk instead of trusting what the request carried. A refusal keeps the frame open with the node's own
message on it.

A definition that declares a required input with no default opens the start dialog instead of
starting, so nothing runs with an empty input (§ Authoring). The rail goes to Workflows first,
because the dialog is mounted once, in that source's list region, and one mount is what keeps the
editor's **Run** and this row from putting two of them on screen.

Approving a gate, cancelling a run and killing one stay in the run surface. Each needs the run's
status and its consequences in front of the person doing it, and a row in a list carries neither.

**Finding an active or recent run is deferred, because there is nowhere to open one.** This plugin
ships no run pane on either host. The only client that reads its `runs` route for a task is the
agents plugin's task sidebar (`plugins/agents/src/client/sessions/AgentTaskSidebar.tsx`), which draws a
run's *steps* into its roster and keys selection on a managed-session id that a workflow step does not
have; opening a step there spawns a terminal that resumes the step's provider session. A row that
cannot name where it goes is worse than no row, so the search reopens when there is a run surface to
point it at, and not before. The rail's recent-run rows already address one
(`?pane=workflows&item=<runId>`), and a deep link naming a pane nothing has registered is dropped
rather than dispatched.

## Configuration trust

Workflow files and executable URL/run-target scripts are repo-authored executable configuration. The
Node hashes the exact snapshot, requires an acknowledgement, and fails closed if the snapshot changes.
Declarative Docker matching data is separate from this gate, but commands that start/stop services
remain executable actions and are trust-checked. A `workflow_defs` row is not repo-authored and is not
hashed; § Database definitions holds that half.

## Gaps

There is no picture of the graph. The editor draws it as an indented list and the graph view is
[docs/future/workflows/phase-6-canvas.md](./future/workflows/phase-6-canvas.md). There is no run
surface either: a run is watched through the agents sidebar's step rows until the pane in
[docs/future/workflows/phase-4-run-pane.md](./future/workflows/phase-4-run-pane.md) lands, so a bell
row for a gate still has nowhere to go. The desktop must be open for UI interaction, although the
node continues work while the renderer is closed, including the trigger sweep, which moved onto the
node's own scheduler. A failed node is retried by hand through the retry route; an operation whose
external outcome is unknown is never retried on its own, because acorn cannot tell a side effect that
landed from one that did not.

An agent cannot start or drive a run: no workflow or session tool is registered, so orchestration is
declarative only. [`docs/future/orchestration.md`](./future/orchestration.md) analyses what an
agent-driven path would cost. Database rows have no trigger and no schedule; committed files keep
theirs.
