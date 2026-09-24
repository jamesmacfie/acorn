# Workflows

Workflows are durable Node orchestration. A definition is either a committed
`.acorn/workflows/*.toml` file or a `workflow_defs` row the owner typed in the app, and the two are
read as one list. SQLite stores expanded runs, steps, gates, trigger cursors, and recovery state.

## Version 2 values

Definitions use `formatVersion: 2` (`format_version = 2` in TOML). Each step has a stable `id`
and a separate human-readable `name`. Edges, branches, bindings, prompt references, and device layout
positions use the ID. Renaming changes the label; the frozen run maps persisted row indices to its
own frozen definition IDs. An omitted `after` still means the preceding step, and explicit edges
survive declaration reordering. New editor steps receive an ID once when created.

Inputs declare the shared structural `schema`, optional `label` and `description`, `required`, and a
typed `default`. Numbers, booleans, nulls, arrays, and objects cross start routes, run snapshots, and
child dispatch without conversion. Missing optional values are omitted; missing required values
fail admission. An explicit null is validated as a value and never replaced by a default.

Bindings use the shared data address vocabulary: `{ address: { from: "literal", value } }`,
`{ address: { from: "input", name, pointer } }`,
`{ address: { from: "step", stepId, pointer } }`, or an `item` address with a pointer inside a map.
An empty pointer selects the whole value. Optional `fallback` applies only to missing values.
Explicit conversions are `scalar-to-text` and `json-to-text`. Only completed transitive predecessors
enter a handler's `predecessorValues`; a completed sibling cannot supply a binding.

Named definition `outputs` declare `{ name, schema, binding, required? }`. Output bindings select
completed step values. A child step exposes these as `outputs`, alongside its task/run/status summary;
consumers do not need to inspect the last transcript message. The Node validates structural step
outputs before completing a v2 step and validates declared workflow outputs before completing a run.
Workflow values are bounded by the shared 16 MiB selection limit; provider record/detail limits remain
separate. Prompt/title rendering serializes objects deterministically without truncation.

TOML stores structural schemas in `schema_json`, typed defaults in `default_json`, typed bindings in
`binding_json`, and named outputs in `outputs_json`. These JSON strings preserve nested nulls and
mixed arrays that TOML cannot represent directly. The basic input editor supports typed defaults;
the JSON tab exposes the complete schema and binding contract.

Unversioned definitions, missing stable IDs, old binding tables, and unknown versions are refused
with a file-located upgrade diagnostic. There is no read-normalization or execution adapter. The
development-state transition exports then removes old database definitions before v2 is admitted.

## Execution model

The workflow loader parses and validates a definition, rejects cycles, expands static branches, and
checks the exact repository configuration trust snapshot before starting a run from a committed file. Steps can invoke
managed agent sessions, terminal/run targets, GitHub checks policies, or human gates. Structured step
output is the only value that controls branching and joins; transcript prose cannot satisfy a gate.

Runs and steps persist state transitions. A restart reconciles persisted operation IDs and never
blindly repeats an external side effect with unknown outcome. Ambiguous work parks in an explicit
recovery/gated state. Cancellation propagates to child sessions and process groups.

### The graph

A step declares `after`, the IDs of the steps it waits on. A step with no `after` key waits on the
step declared before it, and `after = []` makes it a root. Edges are derived from that and never
stored, so a file written as a plain list still runs as the chain it always was.

The runner starts a step when every predecessor is `done`, `completed-with-failures`, or `skipped`.
Agent execution uses the Node's four-slot semaphore and the root's optional lower concurrency limit. A step that
ended `skipped` counts as done for readiness, because a skip is how a branch is not taken and the
step after the decision still has to run. `idx` maps a persisted row to the same position in its frozen
definition; it does not identify a step across definition edits.

A `decide` step's `branches` map a verdict to a step ID, and each target must have the deciding
step among its predecessors. When the verdict picks one target, every other target is marked
`skipped`, and so is every step whose only path back to a root runs through a skipped step. A step
that a taken branch also reaches stays pending and runs when its live predecessors finish.

Validation follows the graph rather than the list. `${steps.<id>.output}` must name a transitive
predecessor, because two roots are not ordered and a step beside this one may well have run first and
still be the wrong thing to read. A cycle is refused and the error names it, as `a → b → a`.

### Inputs

A definition declares `[[inputs]]`, each with a `name`, an optional `description`, `required`, and
`default`. A run starts with a value per input. The start route refuses a run that misses a required
input with no default, and refuses a value for a name the definition does not declare.

`${inputs.<name>}` renders wherever `${steps.<id>.output}` renders: a prompt, a child prompt, and
every string value inside `[steps.with]`, one level deep. A contributed kind receives its `with`
already rendered, so a step handler sees the substituted command and never the template. A run
freezes the values it started with into its own copy of the definition, so the definition a finished
run shows says what it was given.

### What an agent step sees

A step that runs an agent, such as `agent`, `decide`, or `ci-loop`, takes
`inputs = "append" | "template" | "none"`, default `append`. With `append`, the runner renders the
prompt and then adds one `## Output of <name>` block per incoming edge whose step finished `done`, in
`after` order. With `template`, nothing is added and the prompt places its own
`${steps.<id>.output}` references. With `none`, the step sees only its prompt. The handoff context
rides along in every mode, because that is a separate thing from the graph's edges.

All four kinds assemble that prompt through one function, which they did not until 2026-09-09. Only
`agent` read the incoming edges, so a `decide` step was sent its prompt and nothing else: the editor
offered it the Upstream output control, defaulted it to Append, and the runner dropped the output it
was meant to judge. `ci-loop` pays for the upstream output and the context block on the turn that
opens its session and not on the resumed turns, which already hold both.

**Which harness, and what that decides.** A step names one with `profile`, and a step that names none
runs on the node's default, `claude-code`. The editor's Harness select says as much: its blank option
is "The workflow default". The runner resolves that word once, in `runHeadless`, and hands the answer
to the step in `opts.profileId`, because four readers have to agree on it — the step row the run pane
draws, validation, the managed session, and the headless fallback. They did not agree until
2026-09-09: the managed call read the definition instead of the resolved value, so a step whose
harness was left blank asked for a session under no profile at all, got told there was no managed
driver for it, and ran as a bare CLI process with no session and no transcript. Every workflow
authored in the app was in that state, because the select only writes `profile` when somebody picks
one.

So a profile is now what decides which of the two paths a step takes, and nothing else does. A profile
with a managed driver, meaning `claude-code` or `codex`, runs the step as a managed session with a
durable transcript ([managed-agents.md](./managed-agents.md)). A profile without one runs it headless:
a one-shot process, its stream captured into the step's events, and no session for the run pane to
draw. Each child workflow resolves its own step profile from the frozen definition.

One narrowing on top of that: a `decide` step needs a profile with a one-shot structured mode, which
validation tests for on the profile itself rather than against a list of names, so both `claude-code`
and `codex` qualify and a profile with no such mode is refused when the file is saved. A harness a
plugin contributed as manifest data passes that check too, because it declares the same one-shot mode
to appear in the Generate lists ([plugin-authoring.md](./plugin-authoring.md) § Harnesses). One whose
stdout is read as plain text has no way to answer with a verdict object, so the step fails while it
runs rather than when the file is saved. A `decide` step that has to work names a code-tier profile.

An agent step also takes `config_options`, a table of provider option ids to values as the provider
advertises them, such as `model` and `reasoning`. The runner hands them to the agents plugin, which
applies them to the session after the provider reports its option list and before the turn is
enqueued. A value the provider does not offer is dropped and recorded in the transcript rather than
failing the step. Where a step sets both `model` and `config_options.model`, validation refuses the
file.

### Isolation

An agent step with `isolation = "worktree"` runs on a child task with a checkout of its own, created
through `CoreServices.tasks.createChild()` with a branch derived from the run name and the step ID.
The child task ID lands in the step's `inputs_json`, so
cancelling the run reaches it. The default, `shared`, runs the step on the run's own task beside its
siblings. Two investigators reading the same checkout can share a task; child workflows use separate tasks.

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

### What a run reports

A run raises a `workflow.run` span and each of its steps a `workflow.step` span, both through
`ctx.telemetry`, both owned by this plugin, and all of them in one trace, so a slow step is found
from the run rather than from a list of unrelated spans
([telemetry.md](./telemetry.md) § Ambient attribution). The run span carries the run id, the trigger
and the step count; a step span carries the run id and the step id. Nothing carries a prompt, a
result or a handoff note.

The run span opens where the row is written in `start` and closes in `finishRun`, so it measures
what the owner would call the run's duration. A step's span brackets its own status changes rather
than the `execute` call, because a step settles at a dozen places in `execute` and two of them never
run it at all. A step waiting at a gate keeps its span open, which is right: waiting for a person is
part of how long the step took.

A run still going when the process exits reports no span. Nothing measured how long it took, and a
span invented on the next boot would say otherwise.

### Where a file comes from

Workflow files load from the repo checkout or worktree and layer over `~/.acorn/workflows` the same
way `config.toml` layers repo before user, so a repo-defined id wins over a user one. Database rows
sit under both, as § Database definitions describes. A step can
reference another workflow by id. The reference expands inline, one level of nesting, and a chain
that revisits an id is rejected as a cycle rather than followed into a hang. A malformed file
surfaces as an error row instead of being skipped silently. A sub-workflow's steps are prefixed with
its id, and so are the `after` IDs inside it, so an expanded block keeps its own shape
inside the outer graph.

### Child workflow tasks

`workflow` starts one saved workflow in a child task. `workflow-map` reads an array from a structured
predecessor and starts one child task for each item. Before a root run starts, the Node resolves every
database, repository, and user reference in the task's project scope. It validates the supplied or
defaulted child inputs, applies repository trust, and freezes the resolved graph with the run. An edit
to a referenced definition therefore affects a later root run, not one already in progress.

Each dispatch is recorded before it creates a task or starts a run. The record holds a stable caller
key and payload fingerprint, reserved task and run IDs, explicit root and parent lineage, and its
progress from reservation to terminal state. A retry or restart resumes that record. Repeating the
same request returns the same task and run; reusing its key with different content fails. The graph
permits four child-workflow levels below the root and rejects recursive references before admission.
`maxDescendants` defaults to 100 and accepts values from 1 through 500. Every nested child counts
toward that root limit. An oversized roster reserves and dispatches nothing. A later nested admission
can reach the same limit; that step stops at a visible safety rail while admitted siblings settle.

A child-workflow step waits without taking an agent execution slot. A mapped step keeps source order,
uses the configured JSON Pointer as the stable item key, and records each child's task ID, run ID,
status, bounded result, failure, and provider usage. An empty array succeeds. When results are mixed,
the parent waits for every admitted child and persists `completed-with-failures`. That step's typed
output remains available to downstream summaries and conditions. A successful summary does not hide
unresolved child failures in the root outcome. A child gate puts the parent in `gated`; approval
still happens in the child run, and independent siblings continue.

Four agent turns can execute concurrently on the Node. A root can lower its limit with
`maxConcurrency`, from 1 through 4. Waiting parents, gates, and data reads consume no agent slot.
The semaphore skips saturated roots without holding Node slots for their queued work.

Cancellation stops new admissions, cancels descendant runs and managed sessions, and settles the
root only after admitted children settle. A failure in another branch applies the same cleanup
before the root becomes failed. Child tasks stay active, and their worktrees remain as ordinary task
history. Retrying a dispatch step reuses the saved child roster and does not create replacement
tasks. Tool ceilings, provider-turn limits, cost, token limits, and the absolute deadline are
intersected down the tree. Usage is admitted once against the root and every ancestor's subtree
budget, and remains charged across retries. An explicit failed-child retry reopens its ancestor
dispatch path and reuses the task, run, roster, and frozen graph. Successful siblings are not rerun.
The original absolute deadline still applies. A restart keeps unknown-usage turn reservations counted.

The editor's **Plan with AI, then For each** shortcut inserts a structured agent plan and a For each
step as one undoable draft edit. Select the child workflow and bind its inputs in the inspector. The
plan declares stable item IDs and accepts an empty array. Removed execution kinds receive an upgrade
diagnostic; they do not execute. Ordinary graph convergence uses `after` edges.

This replay protection is limited to one root run. Starting a fresh root can process the same
business item again; cross-run business deduplication is deliberately not part of workflow dispatch.

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

**Starting by id.** `POST /v2/p/workflows/tasks/:id/workflows` takes `{ defId }` and optional typed
inputs. Inline definition bodies are refused. A `defId` of `repo:<fileId>` or `user:<fileId>` names a file the task's project loads;
anything else names a row. The node resolves it and applies the layer's own rule, which is stronger
than trusting a `source` field in the request body.

**A row is a draft.** Neither write validates, because a workflow being built is invalid for most of
the time somebody is building it: it has no steps the moment it is created, and a step has no prompt
until one is typed. `POST /v2/p/workflows/defs/validate` reports, the editor draws what it says in
its footer. Run resolves an immutable published revision, never the editable row. A file layer is different: a definition that does not
validate is listed with its problems rather than hidden.

**What a row may name.** A run target, a saved query, or an agent profile is checked when the step
runs, not when the row is saved. The node holding a definition may not have the repository at all, so
`POST /v2/p/workflows/defs/validate` answers the loader's own problem list and leaves the
project-specific names to the step handlers.

### Draft recovery and publication

`workflow_defs` owns editable content, a draft revision, and published/base revision pointers.
`workflow_revisions` retains immutable content and digests. Saves use compare-and-swap and verify
the affected-row count. Editing a draft does not change what Run executes.

The editor coalesces autosaves after 750 ms. Device recovery copies retain the Node ID, entity ID,
base revision, base content, and local content. Only a matching acknowledgment clears a copy.
Unavailable storage displays **Not saved**; an unacknowledged durable copy displays **Saved on this
device**. Reopening compares the local copy with the Node version. Stable IDs align step lists;
conflicting fields, concurrent structural edits, and delete-versus-edit require an explicit choice.

`POST /defs/publications/prepare` freezes a reviewed dependency-first write set. The request selects
the root draft revision and optional changed child/query draft revisions. Required unpublished
dependencies are included; unrelated edits to published dependencies are not adopted. Metadata-dependent
queries accept explicit validation inputs and step values through the `validation` field. Preparation
uses source descriptions and options, not record queries. A missing validation value blocks publication.

`POST /defs/publications/:operationId/publish` writes that set idempotently. The workflow-owned journal
records `prepared`, `publishing`, `complete`, or `needs-reconciliation`, intended revisions, landed
revisions, and the remaining writes. Core query holds prevent partially published query revisions
from resolving. Workflow admission refuses affected definitions until the operation completes;
unaffected definitions remain usable. Core and plugin writes are not one transaction.

`GET /defs/publications?workspaceId=` exposes recovery state. Resume retries the exact frozen writes;
it does not create replacement revisions after a lost response. A review with no landed writes can
be discarded through `POST /defs/publications/:operationId/discard`. A partial publication must resume.
Ordinary references resolve published revisions; run admission pins saved-query revisions and freezes
the child graph. Dependency records support consumer review and refuse referenced workflow deletion.

Draft saved-query references use a separate `draft:<workflowId>` consumer identity. The workflow
store tracks reference claims before writing core consumers, then acknowledges the draft save.
Stale claims are removed after successful saves or deletion. Startup reconciles interrupted claims,
including deletion that reached the workflow store before core cleanup. Draft changes cannot remove
the consumer protection of the published revision. Query deletion also refuses active publication
holds, even when the query has no consumers.

### File drafts and portable export

`POST /v2/p/workflows/defs/files` accepts `open`, `save`, `review`, `export`, `publish`, `discard`,
and `list` operations. Device authentication protects this authoring route. File targets identify a
project, a repository or user layer, and a confined `.acorn/workflows/<id>.toml` path.
`workflow_file_drafts` retains the original text/hash, edited definition, and compare-and-swap
revision. Parse failures name the file to repair in a text editor. Static file composition must be
converted before visual editing, so saving an expanded graph cannot erase its original references.

Review merges independent external edits by stable step ID. Conflicting values require an explicit
choice against the reviewed external hash. A deleted file requires restoration. Publication rechecks
the expected hash, writes a unique adjacent temporary file, and renames it. Known external changes
are refused. External editors do not share Acorn's journal, so this is not a filesystem transaction.

The outline editor opens repository and user files through this draft route. It autosaves the visual
draft, shows external changes during review, and requires a conflict choice before publication. It
does not write the source file during ordinary draft editing.

**Export to repository** captures the published workflow graph into sibling files in the selected
project. Workspace originals remain intact. Published saved queries and typed parameter declarations
are embedded inline, database child references become repository references, and repository references
are reused only within the export scope. Cycles, unresolved references, user-file dependencies, and
occupied destination paths are refused. The obsolete `save-to-repo` route refuses destructive export.

Connection selections become required string inputs with a `connection.source` constraint. Export
removes Acorn workspace/project scope IDs, while retaining provider project/state IDs in the review.
Run admission binds the destination workspace/project and validates connection and provider choices
through the source runtime before starting. Destination scope parameters must resolve before admission.
Filter values bound to runtime records are validated by the data step when those records exist.
Credentials are not read by export.

`workflow_file_operations` retains each intended file, original hash, dependency hash, and landed
status. Resume verifies completed writes and continues the same plan after interruption, including a
rename that landed before its journal acknowledgment. A review with no written files can be discarded.
Affected file definitions cannot run until their publication completes. Publication leaves ordinary
uncommitted changes; repository run admission still applies configuration trust.

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
editor is drawn by the rail source's detail region, so the terminal client puts the definition
list in its Browse panel and the editor in the main one, and the editor's own node list and inspector
are a `list-detail` pair inside that. Every control is a kit node, so none of this is plugin code
either host had to be given.

The primary view is an outline with three kinds of row. **Definition** carries the workflow's name,
posture, tool ceiling, and budget. **Inputs** carries the values supplied when a run starts. Step
rows show a behavior summary, an **After** line with readable dependencies, and visible branch
labels. Roots appear in declaration order, followed by each step after the last dependency. Move
controls reorder declarations without changing stable IDs or explicit edges. A referenced-step
deletion names the affected dependencies and bindings before applying the edit. **Add** lists the
catalog's kinds, with built-in actions first and each contributed kind's icon and description.

The selected row opens its configuration and a contextual preview. The preview describes the step,
dependencies, branch, and declared output fields. It does not run an agent or invent sample output.
**Graph** and **Code** are secondary views over the same definition and stable step IDs. They do not
maintain a separate graph model. Outline edits, binding changes, code edits, and generated proposals
share one undo and redo history.

The inspector draws whatever the list has selected. For a node that is its name, the steps it waits
on as removable chips with a picker beside them, the agent fields when the kind runs an agent, then
the kind's own fields in declared order. A prompt field carries a chip per declared input and per
step that is certain to have finished first, and pressing one appends the reference. A `decide` node
draws its branches as verdict-to-step rows. For each selects a child workflow and typed item bindings.
A kind that ships no `describe` draws its `with` table as raw JSON and says so.

**Find records** uses the shared query editor. Adding **For each** from a Find records step creates
the dependency and preselects that step's records output as one undoable edit. For each bindings and
direct conditions use the shared typed field picker. Conditions expose field, comparison, and typed
value controls. Agent output uses a field list with nested object and list fields, types, and
requiredness. Raw pointers and JSON Schema remain available in **Code**, but the normal setup does
not require them. Task title templates, ordinary-array identity keys, and execution limits remain
under **Advanced** until validation requires them.

### Scheduling a published workflow

**Schedule…** appears only for a published database workflow. It opens one shared-kit editor on both
hosts; cadence, timezone, project, and typed input values are schedule setup, not fields on a normal
workflow draft. The first review shows three concrete future checks with their timezone offsets,
effective execution limits, and whether the first check processes current matches or establishes a
baseline from now.

Record repeat handling appears only for `workflow-map` loops. **Run again when these fields change**
uses the same typed field picker as authoring. **Since the last completed check** appears only when
the source declares incremental continuation and the query feeds one unambiguous loop. Saving stores
a disabled Node draft; activation is a separate device-only action and is never queued while offline.

The workflows list gives schedules their own section and labels Active, Paused, Needs review, or
Unavailable. A changed published dependency retains the prior approved snapshot and processing
history, pauses admission, and links back to both activation review and the published workflow.
**Start fresh** is folded under advanced review and names the consequence that matching records may
run again. Pause stops future checks, **Run now** still works while paused, an active run opens its run
surface for cancellation, and deletion retains run and processing history.

The agent fields are the editor's, not any kind's: the harness from the catalog's profiles, then one
select per option that harness advertises through `GET /v2/p/agents/providers`, then where the step
runs and what it does with its upstream outputs. A plugin contributing a kind that runs an agent
never restates the model list.

### Child workflow authoring

Add **Run a workflow** to start one saved workflow, or **Map to workflows** to start one copy for
each item in a structured result. The child workflow picker lists database, repository, and user
definitions that the selected project can resolve. The catalog includes each target's declared
inputs and terminal output schemas. It omits definition bodies, input defaults, credentials, and
values from a run.

From a mapped step, **Create a workflow for this record** creates a child draft with one required,
typed `record` input. It binds the current record, saves the parent reference, and opens the child.
The parent link returns to the same selected step. Unpublished leaf drafts remain selectable in the
editor and carry a **draft** label; generation only receives published targets. Parent publication
reviews a required child draft with the parent rather than making either draft runnable early.

The inspector draws one binding for each declared child input. A binding can use fixed text, a
declared parent input, or a JSON Pointer into a structured predecessor. A mapped step can also use a
JSON Pointer into the item. Required child inputs without a saved default must have a binding.

This definition runs one saved child and passes through the parent's `ticket` input:

```json
{
  "name": "Review one ticket",
  "inputs": [{ "name": "ticket", "required": true }],
  "steps": [{
    "name": "review",
    "kind": "workflow",
    "childWorkflow": {
      "ref": { "source": "database", "id": "WORKFLOW_ID" },
      "inputs": { "ticket": { "from": "input", "name": "ticket" } }
    }
  }]
}
```

A mapped step names a structured predecessor, the pointer to its array, a stable item key, and a
title for each child task:

```json
{
  "name": "Review selected tickets",
  "steps": [
    {
      "name": "select",
      "after": [],
      "prompt": "Select the tickets to review.",
      "schema": {
        "type": "object",
        "properties": {
          "tickets": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "number": { "type": "string" }
              }
            }
          }
        }
      }
    },
    {
      "name": "review",
      "kind": "workflow-map",
      "after": ["select"],
      "items": { "step": "select", "pointer": "/tickets" },
      "itemKey": "/id",
      "childWorkflow": {
        "ref": { "source": "repo", "path": ".acorn/workflows/review-ticket.toml" },
        "inputs": { "ticket": { "from": "item", "pointer": "/number" } }
      },
      "title": {
        "template": "Review ${ticket}",
        "bindings": { "ticket": { "from": "item", "pointer": "/number" } }
      }
    }
  ]
}
```

The editor preserves unavailable targets, unsupported bindings, and malformed pointers in the
draft, then reports each problem beside the field and in validation. Saving the draft does not make
it runnable. The start path validates and resolves every child before it creates a task.

Renaming a v2 step preserves map sources, structured bindings, graph edges, and prompt references.
The JSON tab, TOML import and export, save-to-repository flow, undo, and redo use the same
child workflow contract.

### Generating and editing with AI

**AI authoring** opens a bounded conversation beside the workflow draft. Each turn can request
allowlisted source metadata, dynamic source discovery, option IDs, or compatible child workflows;
ask an inline clarification; or return a proposal. API-backed model connections and text-only agent
harnesses use the same JSON response protocol over the existing `generateText` service.

The conversation stores pending context, clarifications, and proposals in device-local recovery
state keyed by Node and workflow. Source records stay out of the prompt unless the user enables
**Use preview records to help AI**. An enabled sample contains at most three selected records and
16 KiB. Cancellation keeps the draft unchanged, and each result reports model request and token use.

A proposal shows a semantic diff before it can change the draft. Applying it reconciles a stale
base against the current definition by stable step ID, refuses conflicts, and runs the workflow
validator again. One accepted proposal creates one undo entry. Rejecting it changes nothing. The
conversation cannot save, publish, run, activate, change a provider, or read credentials.

#### Legacy one-shot endpoint

The device-only `/defs/generate` route remains for compatibility with callers of the earlier
one-shot generation contract. The workflow editor uses `/defs/authoring/turn` for interactive AI
editing.

The edit projection removes provider choices, configured execution targets, tool allowlists,
triggers, and the `headers` and `auth` fields of contributed step configuration from each step. The
scoped catalog separately lists the child targets that the model may use on a new step. After the
answer is grounded, the server restores protected values onto each surviving step with the same name
and kind. Deleting, renaming, or changing the kind of a step deliberately breaks that identity and
does not carry its protected configuration onto the replacement.

What the model is told about acorn is assembled at request time, not written down. The step kinds
with the fields each one describes, the policies and the agent profiles all come out of the same
catalog `GET /v2/p/workflows/catalog` answers, so a plugin that contributes a step kind makes it
available to the model with no prompt to edit here. That list is also the list the answer is checked
against: a kind in the catalog but missing from the prompt would be one the model can never use and
nothing would ever strip. The workspace's own definitions ride along as worked examples, ranked so
that one with a step waiting on two others comes first, because a fan-in is the thing a model gets
wrong on its own. The definition being edited is left out of its own examples, and so is any
definition that does not itself pass the checker: a workspace's broken workflow is the wrong thing to
learn house style from.

Generation also receives the selected project's bounded child workflow catalog. It contains the
same references, input signatures, and output schemas that the child workflow picker uses. Grounding
removes a reference outside that catalog, an input binding the target does not declare, and a source
that is not a structured predecessor. If the catalog is empty, the prompt forbids both child
workflow kinds.

The server does not silently restore a changed child target. Both the conversation and compatibility
route keep only references in the scoped child catalog, and the conversation exposes a target change
in the semantic diff for review.

The reply is read back rather than trusted. Anything named in it that this node does not have is
taken out before the draft is touched. An invented step kind becomes a plain agent step keeping its
prompt, rather than a deleted step, because deleting one cascades through every `after` and `branches`
target that names it. An invented policy loses its value and stays a policy gate, because
retargeting it to a human gate would silently turn a hard check into a no-op under an autonomous
posture. An unknown `with` key goes, while the step's stable ID keeps every reference intact when its
display name changes. Each grounding change is reported in a dismissible alert above the node list,
because a list of things that were changed is not something to read in a toast. What the definition
still gets wrong is not repeated there: the footer already draws it.

There is one repair pass and never two. When the first answer passes the checker, which is the common
case, that is the only model call. When it does not, the checker's own messages go back once,
verbatim, along with the definition as it stands after the stripping, and the second answer is taken
if it parses and has at least one step. It is never chosen on having fewer problems, because the
cheapest way for a model to shorten a problem list is to delete the steps carrying the problems. The
answer is applied either way. A definition with problems in the footer is every workflow partway
through being built, and **Run** is what refuses to start one. The alert above the node list
describes the answer that was applied and only that one. When the repair is the one kept, a note
about the first draft would be about a definition nobody ever sees.

The AI authoring button is not drawn when the owner has nothing to generate with, meaning no
model provider connected and no agent CLI installed either
([integrations.md](./integrations.md) § Model providers), on the rule the commit-message wand
follows: a control whose only message is "connect one first" is a control in the way of the ones
beside it, and Settings, under Integrations, is where a connection is made. Repository file drafts
use the same conversation and keep their separate review-before-publication flow.

One submitted instruction can make at most eight metadata requests and two candidate attempts. The
client uses an 11-minute broker timeout for the bounded sequence and exposes **Cancel** while it runs
([api-reference.md](./api-reference.md) § Transport).

### The draft rules

These are why the editor is safe to type in:

- A new node takes one edge from the selected node, or none when nothing is selected. It is never
  inserted between two nodes, so adding a step changes nothing about what an existing step waits on.
- Deleting a node removes every edge that touched it and never bridges its predecessor to its
  successor. A chain that loses its middle becomes two roots, which is visible.
- Renaming changes only the display name. `${steps.<id>.output}`, every `after` entry, branch target,
  binding, and graph position continue to use the stable ID. The field accepts 1–200 characters.
- The picker offers a step as a predecessor only when the edge would be accepted, so a self edge, a
  duplicate and anything that closes a cycle are never on the list.
- Undo and redo cover the whole draft, with typing folded into one step inside a 600 ms window, 60
  deep.
- Save is grey only while the draft is unchanged or a write is in flight. A draft that does not
  validate still saves, because that is every workflow partway through being built: the footer says
  what is wrong, and **Run** is what refuses. A new definition has no steps, so the node list says so
  under its rows and the footer reports it.

### The graph view

**Graph** in the tab strip draws the same nodes as a picture: cards on a grid, the edges as curves,
the selected card the one the list has selected. The list column stays beside it on a wide layout and
collapses under it on a narrow one, which is the `list-detail` layout's own rule.

Drag from a card's bottom port onto another card to make it wait on the first. The `×` on a wire
removes that edge. Delete or Backspace removes the card the keys are on. Drag a card to put it where
you want it; it lands on a 22 px grid and stays there. Every one of those is the same draft operation
the inspector's own controls call, so the rules are the same: no self edge, no duplicate, nothing that
closes a cycle, and a delete never bridges what it stood between.

A card with no position of its own is placed from the edges: one rank below the deepest step it waits
on, sharing that rank with its siblings. So a new node appears at its rank without anybody placing it,
and moving a card is an override rather than a commitment to place the rest.

The canvas is the kit's `Graph` node, not this plugin's drawing
([ui-design.md](./ui-design.md) § The closed kit). That is what gives the terminal client this view
too: there it is the indented list, with a picker under it to draw an edge out of the selected card.

### The JSON tab

The escape hatch: the definition as the runner's own JSON, formatted. **Apply** is atomic. A document
that parses and is a definition replaces the draft; one that does not leaves the draft exactly as it
was, keeps the text for correction, and says what is wrong. **Format** reprints what is in the box
and **Revert** puts the draft's own projection back. Node positions are not in this document.

The box is a real editor — highlighting, line numbers, bracket matching — through
`mountEmbeddedEditor` on `@acorn/plugin-api/ui/editor`
([editor.md](./editor.md) § A code box that is not a document), so this plugin holds no CodeMirror of
its own. The terminal client draws the same rectangle as a plain textarea, since it has no library to
draw one with.

### Saving

**Save** flushes the draft at the revision it was read at. Autosave uses the same operation.
A stale revision answers 409 and opens conflict choices without discarding the local draft.
**Review publication** names the dependency set. **Publish reviewed set** makes the set executable
only after all writes complete. **Resume publication** continues an interrupted operation.
For a repository or user file, Save persists the visual draft on the Node; **Review publication**
checks external edits and file dependencies, and **Publish reviewed files** atomically replaces that
file while leaving the working tree uncommitted. A database definition uses **Export to repository**
to review and write its portable published dependency graph. The old direct Save to repo operation is
refused because it cannot provide that review or preserve every workspace original.

**Run published** opens the start dialog, one box per declared input with a task picker when no task is
in scope, and starts the run when the required ones are filled. A definition that declares no inputs
and already has a task starts without a dialog.

A committed or user file opens in the same visual editor with a recoverable Node draft and its file
destination visible in publication review. Parse failures preserve the file and direct the user to
repair its raw TOML; they never open an empty visual definition. An address that names no layer at
all says that instead, because unreadable and an empty draft are different states.

### Where positions live

Node positions for the graph view are device preferences under
`plugin:workflows:layout:<defId>`, never in the definition, so a definition stays portable and a
committed file has no x and y in its diff. A rename carries a node's position with it and deleting a
definition drops its layout. A drag writes 400 ms after it stops, and a draft with no row yet keeps
its positions in memory for the session.

## Limits and capabilities

The runtime enforces workspace/provider concurrency ceilings, per-step tool ceilings, time budgets,
and task ownership. Agent steps use the agents capability; run targets use terminal capabilities;
GitHub checks are optional. A disabled provider leaves the corresponding step unavailable and visible
as a problem rather than silently selecting another implementation.

## Contributed step kinds

The built-in kinds are `agent`, `gate-human`, `gate-policy`, `ci-loop`, `decide`, `if`,
`find-records`, `get-record-details`, `workflow`, and `workflow-map`. Workflows opens three node extension points
([plugins.md](./plugins.md) § Node-side extension points) and any plugin may fill them:

| Point | What it adds | Named in a file as |
| --- | --- | --- |
| `workflows:step-kind` | a kind the runner dispatches to | a step's `kind` |
| `workflows:policy` | a verdict source for `gate-policy` | a step's `policy` |
| `workflows:trigger` | something that decides which workflows should start | nothing; the sweep asks it |

Findings currently contributes no policy. Its observations and memory candidates are advisory, and
their severity, acknowledgement, withdrawal, dismissal, or snooze cannot change a run. This is a
deliberate deferral: there is no shipped workflow definition or product configuration that binds a
findings decision to a gate. Existing workflows therefore keep their current posture and policy
behavior whether findings is installed or not.

If a concrete gating workflow is introduced later, it must name the findings policy explicitly on a
`gate-policy` step and bind only the decision requests selected by that workflow definition. It must
not sweep every high-severity observation on the task. The policy is evaluated when the step runs,
against the reviewed evidence revision and any outstanding follow-up obligations. A missing policy,
stale evidence, or incomplete obligation fails explicitly; disabling the contributing plugin cannot
turn absence into approval. Addressed evidence, a device-authenticated risk waiver, or a verified
not-applicable result are the only clearing outcomes. Acknowledgement and deferral are not. Gate UX
continues to use this plugin's existing run pane and attention source rather than creating a global
approval queue. [Findings](./findings.md) owns the future decision record contract.

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

The nine built-in kinds describe themselves through the same type, with the fields naming a step's
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
(§ Authoring), the run pane below, a Settings page that lists what a task's checkout would load,
three command-palette rows, gate controls, and attention items. Workflow notices use `/v2/events`.
Durable run history is paged from the plugin database.

### The run pane

A task with at least one run has a **Workflows** pane
(`plugins/workflows/src/client/runs/paneContribution.ts`). It is `list-detail`: the task's runs
newest first, then the selected run's nodes, and one node's detail beside them. The pane is hidden on
a task that has never run a workflow, so the pane strip does not grow a button for every task; which
tasks those are is one node-wide read the plugin keeps in memory (`runs/runStore.ts`).

**Rows | Graph** in the Nodes header picks how the nodes are drawn: as the list, or as the same
picture the editor authors on, coloured by status. The choice is remembered per device. The run's
graph has no ports and nothing to drag — a run froze its definition when it started, so an edge here
is a record.

The node list is the editor's list. Both call `graphOrder` in
`plugins/workflows/src/client/editor/draft.ts`, over the definition the run froze when it started, so
the indentation in the run cannot disagree with the indentation in the editor. A node that waits on
more than one step carries the same `⇐ n` mark. A dispatched child is a row under the step that
spawned it.

The detail depends on the kind and the status:

| Kind | While running | When done | Controls |
| --- | --- | --- | --- |
| agent kinds | the conversation: transcript, queue and composer | the same conversation, and the structured value under a disclosure | Show in Agent pane; Kill step |
| `terminal:command` | the streamed tail | exit code, duration, the whole output under a disclosure | Kill step |
| `terminal:run-target` | "Starting…" | the URL | Open terminal |
| `database:*` | "Reading…" | a table of the rows and the SQL behind it | none |
| `http:request` | "Sending…" | the status, the headers under a disclosure, the body | none |
| `gate-human` | "Waiting for you" | approved, or the state it reached | Approve; Reject |
| any, `failed` or `safety-rail` | | the error | Retry; Retry with edited prompt, for an agent kind |

A step whose harness session was captured but that never became a managed session offers **Open in
terminal**, which resumes it: the agents sidebar used to be where that lived. A step given its own
task links to it. Every control is drawn only when its transition is legal and disabled while one is
in flight, so a stale button is a race rather than a bug.

A single child-workflow node shows its child summary. A workflow-map node instead shows compact
progress and a virtual record table, fetched in pages of at most 100 rather than one card per child.
Filtering and selection survive event refreshes. Selecting a row loads its frozen input, provenance,
bounded outputs, and paged attempts on demand. Its task and run links retain the root run and record
return route; a missing or archived task leaves the record history readable. Selecting a child run
shows explicit parent and root links. Root-run footers report aggregate tree usage; child-run footers
report only that run, so the same provider turn is not counted twice. The cancel confirmation says it
cancels the run tree, and retry explains that it reuses the exact existing attempt.

**The conversation is here.** An agent node draws the transcript, the queue and the composer that the
Agent pane draws, because reading what a step is saying should not mean leaving the run. It is the
same three components over the same session: plugins/agents publishes them as a client capability
(`plugins/agents/src/contract/conversation.ts`) and this pane renders it, so the two surfaces cannot
drift. A node with the agents plugin switched off answers nothing and the pane keeps the summary it
drew before: the harness, the model, and what the step last said.

A step that ran headless has no session and never will, so the pane says which of the two reasons it
is: that the step has not started, or that it runs outside a managed session and its output is under
**Step details**. Those words are the run pane's, passed to the conversation, because the conversation
knows a session is missing and not why.

The agent shape is a different arrangement, not a different pane. The controls move into the toolbar
and the harness, the structured value and any events a handler emitted fold away, because the
conversation's timeline owns the scroll and takes the height that is left
([panes.md](./panes.md) § Layout model). Every other kind keeps the column it had.

Naming the step is what makes it work while the step runs. The row records its `agentSessionId` in the
completion write, so the pane passes the step id as well and the agents client resolves the session
from `config.workflowStepId`, which the node writes when it creates the session. The step row also
takes the id from the first event that names it, which is what the Agent pane's chip reads.

Typing here is allowed and says so. A step waits on its own turn and nothing else, so a turn sent
while the step is working queues behind it and runs once the run has already recorded the step as
done. The composer carries that sentence above it rather than being disabled, because answering an
agent mid-step is a reasonable thing to want and being told what happens is better than being
stopped.

### What the pane listens to

Four frames of its own, and each one costs what it should:

- `workflow:step-changed` moves one node's glyph and reads nothing.
- `workflow:step:event` appends to the selected run's per-node tail, capped at 200 events and the
  last 4,000 characters of output.
- `plugin:workflows:run-changed` re-reads the run and its steps, because a run beginning or ending
  changes rows this client never saw.
- `plugin:workflows:child-changed` re-reads the parent and child summaries after a durable dispatch
  transition.

`plugin:workflows:run-changed` is the public run lifecycle, not merely a start/finish hint. It carries
`{ taskId, runId, status }` after the run's full step roster is readable and after every real durable
transition through `running`, `gated`, `cancelling`, `done`, `failed`, `safety-rail`, or `cancelled`.
One `setRun` mutation funnel compares old and new state, so retries and terminal completion cannot
drift into separate event semantics.

Events remain invalidation hints. The run pane and its task-run index re-read after reconnect, so a
missed child, run, or gate frame cannot leave durable state stale. These resources are mounted inside
the active Node's client partition; identical task and run IDs on another Node do not share state.

Human approvals have the narrower `plugin:workflows:gate-changed` frame. It names task, run, step,
and the current `waiting-gate`, `done`, `failed`, or `cancelled` state only when entering or leaving
the gate. Node-side consumers re-list pending gates through `workflows.gates`; ordinary workflow
steps remain on the owned stream and never become cross-plugin events.

An agent node adds the agents plugin's own subscription, which is a session's event stream at about
25 frames a second ([managed-agents.md](./managed-agents.md) § The transcript store). That is the
conversation's cost and it is paid by whichever pane is drawing one; the socket is refcounted, so two
panes open on one session share it.

### Getting there from somewhere else

The pane intent `{ kind: 'workflows:show-run', runId, stepId? }` is how everything else points at a
run: a bell row, an inbox row, the rail's recent runs, the agent pane's chip, and the **Run** chip on
a workflow session's row in Agent Center. The deep link
`/t/:taskId?pane=workflows&item=<runId>` is the same thing with an address.

## Starting a run from an item

A Rollbar error, a Linear issue and a GitHub pull request each have **Start workflow…** in their row
menu, under **Create task**. It picks a workflow, fills its inputs from the item, makes a task or
attaches to one, starts the run, and lands on the run pane.

All three menus are the context-menu registry's `item.row` location
([plugins.md](./plugins.md) § Context menus), so this is one contribution rather than three. The
target the row is handed carries the item's `title`, its `body`, a `link` to it, and the provider's
own row untouched.

**What the item fills in.** By input name, in `plugins/workflows/src/client/startFromItem.ts`: an
input named `issue`, `item` or `context` gets the title and the body one blank line apart, and one
named `link` or `url` gets the external link. Every other name is left for the person, because
guessing at `focus` or `depth` from an error title puts words in a prompt nobody chose. The rule is
in the workflows plugin rather than in each integration, so a new tracker gets it for free.

Where the body comes from is each tracker's own answer, and none of them makes a second call to fill
a menu nobody opened. Linear asks for the issue description on the list query and caps it at 2,000
characters. Rollbar's list carries no prose at all — an item's body is its stack trace — so its rows
send the facts they already have: level, environment, occurrence count, and the permalink. GitHub
sends the pull's body when the row's detail is already warmed, and the title alone when it is not.

**The box** is the promote-to-task modal with a workflow step over its tabs
(`packages/client-core/src/features/integrations/PromoteToTaskModal.tsx`): a picker, one field per
declared input with the prefilled values editable, then the existing **New task** and **Attach to
task** tabs. The primary button reads **Create & run** or **Attach & run** and is refused while a
required input is empty. Making or attaching the task is the source's registered `promotion`, which
is why one component serves all three trackers; starting the run is this plugin's, through the same
route the editor's **Run** and the palette use, so a refusal reads the same everywhere. On success
the modal closes and the task opens at `?pane=workflows&item=<runId>`.

The modal is drawn in the shell's `overlay` slot, because the list the row sits on belongs to
somebody else. The terminal client mounts no overlay slot and its descriptor source panel draws no row
menu, so this flow is desktop-only for now ([tui.md](./tui.md) § What a plugin loses here).

## From the command palette

Three rows at the palette root, all registered by this plugin's client half
(`plugins/workflows/src/client/commands.ts`). **New workflow** is project-scoped: it creates a row
bound to the routed project and opens the editor on it, which is the rail toolbar's verb reached
from ⌘K.

**Find a run** is a task-scoped `search` over this task's runs, newest first, each row naming its
status and how long ago it started. Picking one opens the run pane at it. The row waited for the pane
to exist: a search whose result cannot say where it goes is worse than no search.

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

## Configuration trust

Workflow files and executable URL/run-target scripts are repo-authored executable configuration. The
Node hashes the exact snapshot, requires an acknowledgement, and fails closed if the snapshot changes.
Declarative Docker matching data is separate from this gate, but commands that start/stop services
remain executable actions and are trust-checked. A `workflow_defs` row is not repo-authored and is not
hashed; § Database definitions holds that half.

## Gaps

The graph has no groups, no minimap and no labels on its edges, so a definition much larger than a
screen is read by panning. A run pane node shows what a step last said, not a rendered view of the
prompt it was given, though the run holds one. The desktop must be open for UI interaction, although the
node continues work while the renderer is closed, including the trigger sweep, which moved onto the
node's own scheduler. A failed node is retried by hand through the retry route; an operation whose
external outcome is unknown is never retried on its own, because acorn cannot tell a side effect that
landed from one that did not.

An agent cannot start or drive a workflow run: no workflow control tool is registered. The Agents
plugin's `agent_*` tools drive managed sessions and keep their dynamic delegation tree in the Agents
plugin. They do not create `workflow_runs`, append workflow steps, or mutate a run's frozen
definition. Published database workflows can have an owner-approved Node schedule; repository and
user files do not gain an implicit trigger from their file contents.

## What workflows refuses

Fifty decisions from the programmes that built workflow authoring, execution, child dispatch,
navigation, shared data sources, and scheduling, each with what would reopen it. They are here rather than in a design folder because
every one of them is a thing workflows will keep being asked for.

**A separate `edges` list.** Refused. proliferate's wire shape is `nodes[]` beside
`edges[{from, to}]`. `after` on each step keeps every committed TOML file meaning what it meant, puts
a step's dependencies beside the step that has them, and avoids a second top-level section to
validate against the first. The editor derives the edges and draws them either way, so the picture
cost nothing here.

**A `parallel` group step.** Refused. Keeping the list linear and adding a kind whose children run
together boxes the model in the moment a node needs two upstreams from different groups, which is the
first thing a synthesising step asks for. `after` says that with no group at all.

**Always a child task per parallel step.** Refused as the default. Investigate, review and summarise
do not write, and a worktree per reader is unnecessarily heavy. A step asks for one with
`isolation = "worktree"` when it will write (§ Isolation).

**One implicit context string.** Refused. A single free-text context per run, with `${context}` in
the prompts, cannot ask for two different things, cannot say that one of them is required, and leaves
the item menu no way to tell which field a link belongs in. `[[inputs]]` is the same idea with names
on it.

**Relying on task-context injection for inputs.** Refused as the only path. Attaching the item to the
task as a link and letting the context assembler tell the agent works for an agent step and for
nothing else, because `terminal:command` reads no context. A task may also track several items, and
the run needs the one it was started from.

**Moving the TOML into the database.** Refused, again. A repo file is hashed by the trust snapshot
and reviewed in a pull request. A row is typed by the owner behind the device gate. Two trust
stories, two stores, one merged read, and **Save to repo** turns one into the other on purpose
(§ Database definitions).

**Project-only or node-wide definitions.** Refused. Project-only makes a general "investigate an
issue" workflow a copy per project. Node-wide leaves nothing about a repo checkable while somebody is
writing the definition. A workspace row with an optional project is the shape the rail already has.

**JSON Schema forms.** Refused. A kind could ship a JSON Schema for its `with` and let the host
render it, but the host would then need a schema-to-form renderer that works in cells, and model
lists and run targets are dynamic where JSON Schema has no way to say "fetch these". A closed field
vocabulary with an options route is what credential and data-source parameters already use.

**A plugin-rendered inspector.** Refused. A kind naming a remote tree that the plugin draws into the
inspector gives every kind a client bundle, leaves the host unable to validate or index the form, and
makes the built-ins the only kinds drawn one way. A descriptor is data, and a form is a descriptor
(§ A kind describes its own form).

**A PTY per command, or a per-node tee.** Refused. A clean stdout out of a PTY stream is lossy, and a
headless node with nobody attached would still have to hold the PTY. A tee on demand was refused as a
second code path to keep honest. `terminal:run-target` is the node for a process somebody wants to
watch.

**`database:write`.** Deferred, not refused. It needs an execute-tier ceiling check and an audit row,
and nothing built so far writes. The read-only rule in `database:query` is the seam it would open.

**A canvas as a rectangle.** Refused. An iframe owning its own pixels draws as one muted line in the
terminal. The kit's admission rule is how a canvas earns a cell projection instead, which is why the
graph view is the kit's `Graph` node ([ui-design.md](./ui-design.md) § The closed kit). The list came
first for the same reason: every rule the picture needed was proven on rows both hosts already draw.

**A task pane, or the Settings page, as the editor.** Refused. A definition is not task state and it
outlives the task. Settings has no project in scope for run targets and saved queries, and no
terminal counterpart. The rail source has both.

**A separate start dialog from the item menu.** Refused. The promote-to-task modal already knows how
to create a task or attach to one, and two modals that create tasks drift apart.

**Grouping workflow sessions in the agent sidebar.** Refused. The run pane owns steps, and a group in
the sidebar would draw them a second way. A glyph on the row and a chip in the header are enough to
get from a session to its run.

**Rerun from an arbitrary node.** Refused for this programme. Rerunning from a node that is done
means unwinding its successors' handoffs and outputs, and deciding what a downstream node that
already read them should see. Retry of a failed node covers the case people hit (§ Retry).

**A minted `id` beside `name`.** Refused, and it is proliferate's rule.
`${steps.s3.output}` is worse to read in a TOML file than `${steps.reproduce.output}`, and every
committed file would need an `id` defaulted on load. The editor rewrites references on rename
instead, in the draft, until it is saved.

**Positions in the definition.** Refused. A definition travels between a file, a row and a run's
frozen copy, and none of the three cares where a card was. Device preferences keyed by definition id
hold them (§ Where positions live).

**Implicit triggers from a database draft.** Refused. A database workflow becomes schedulable only
after publication, and only through an explicit device-approved schedule that freezes the graph,
typed inputs, limits, timezone, and first-check behavior. Saving or publishing a workflow never arms
unattended work by itself.

**Agent tools that start or drive a run.** Refused for the managed-session orchestration tools.
`agent_spawn`, `agent_prompt`, `agent_wait`, `agent_read`, and `agent_cancel` operate on managed
sessions and their Agents-owned spawn ledger. They do not make the workflow graph mutable. A future
workflow control tool would need to preserve frozen definitions, run authorization, and every run
budget rather than reusing these session tools.

**Editing a live run's definition.** Refused. A run freezes its definition when it starts and stays
that way, so the editor never offers to retarget one. Retry with an edited prompt patches one step of
the frozen copy and keeps the original in the step's `inputs_json`.

**A second run list.** Refused. The merged list at Settings → Runs stays as it is, the run pane is
addressed by task, and `packages/protocol/src/runs.ts` already says when a core runs table would be
earned.

**A separate agent-only batch runtime.** Refused. Structured agent output followed by
`workflow-map` uses the same reservation, recovery, and safety contracts as source records.

**A second child execution engine.** Refused. Child dispatch starts the ordinary workflow runner
against a frozen resolved graph. A parallel engine would split recovery, gates, and safety rails.

**A query language inside workflow-map.** Refused. The map consumes a structured predecessor through
JSON Pointer. Provider queries and filtering belong to the step that produces that value.

**Unbounded or remote workflow recursion.** Refused. Child workflows stay in the same project and
Node, with four child-workflow levels and at most 500 descendants per root. References are acyclic
and frozen before admission; runtime data cannot choose another definition or extend authority.

**Detached child runs.** Refused. A dispatch step waits for every admitted child, carries child gates
to the parent's attention state, and settles only after the children settle.

**Authority from an AI-authored definition.** Refused. Generation can name only catalogued targets,
and start still applies source trust and the root's approved limits. Saving a definition grants
nothing.

**Exactly-once business processing.** Refused. Invocation identity prevents duplicate task and run
creation within one root. Repeat policies control record admission within an explicit processing
scope; they do not guarantee exactly-once external effects. A fresh manual root has independent history.

**Automatic child cleanup.** Refused. A child task and worktree are user work and remain after the
workflow completes, fails, or is cancelled. The owner can archive them through the normal task flow.
The same holds for the root task a schedule creates, and there is no batch archive.

**A universal ticket or work-item schema.** Refused. Normalising records loses provider meaning, such
as an exact Linear state or a pull request's separate draft and merge-readiness facts. A source keeps
its own record shape and offers optional display hints. Reopen for a real operation that needs
normalised records.

**A provider-specific workflow or dashboard editor.** Refused. It defeats the shared source contract.
A provider that needs more extends the declarative metadata, with a consumer that proves it.

**Cross-source unions and joins in a query.** Refused. Dashboard composition already shows several
sources side by side. Reopen for a workflow that needs combined query semantics.

**Several connections in one query.** Refused. It complicates scope, options, and partial success.
Use one explicit query per connection.

**A generic host query fallback.** Refused. Filtering in the host for a source that cannot filter can
quietly return incomplete or expensive results. A source declares the filters, groups, and sorts it
supports.

**The full raw provider payload as a required record.** Refused. Large or sensitive fields belong in
scoped detail reads. A record keeps typed nested fields without promising every upstream field.

**A schema inferred only from samples.** Refused. An empty or varying result proves nothing about
fields or query support. A source declares its schema, statically or dynamically, and observed
optional fields are marked as observed.

**A general expression language.** Refused. Typed bindings and bounded predicates cover the known
workflows. There is no embedded JavaScript, arbitrary transform, or evaluation engine.

**A simulated run or a single-record test run.** Refused. Preview checks data and bindings only. A
published workflow runs through the ordinary start flow.

**Running an unpublished draft.** Refused. Explicit publication keeps the runnable version clear.

**Previewing a query on every keystroke.** Refused. **Refresh preview** is explicit. Display edits
redraw from the rows already fetched.

**AI that applies or publishes changes itself.** Refused. A proposal needs review, and applying it is
one undoable draft edit. Publication and schedule activation stay separate steps.

**Sending record samples to AI automatically.** Refused. Source metadata goes automatically. Sample
contents need the user's opt-in.

**Automatic retries of failed items.** Refused. A failed attempt stays on record, and a retry is an
explicit action. Infrastructure reconciliation after a crash is separate from re-running work.

**Queuing every observed record version.** Refused. A scheduled check processes the latest relevant
change of each record. This is not an event log.

**Timestamp checkpoints for every source.** Refused. An incremental read needs a declared continuation
contract from the source. Rolling time windows stay available, with their limits.

**Overlapping runs of one schedule.** Refused. The next occurrence is skipped and links to the active
run. Reopen if throughput needs per-record concurrency beyond that.

**Draining a backlog, or moving a checkpoint past the first N records.** Refused. A checkpoint never
moves past work that was not durably selected. A persistent backlog would be its own programme.

**A general publication framework, CRDT, data warehouse, or second job engine.** Refused.
Feature-owned state, optimistic conflict review, and the Node's scheduler and runner cover drafts,
publication, and scheduled work.

**Saved queries as standalone repository files.** Refused. A workflow file exports its queries
inline, and the workspace query library covers reuse.

**A generic provider write-back contract.** Refused. Reads are shared through data sources. Writes go
through contributed workflow actions. Dashboard write-back is a separate proposal in
[docs/future/dashboards/write-back.md](./future/dashboards/write-back.md).

## Typed data and conditions

`find-records` takes a `query` inline or saved-query reference. It resolves input and predecessor
bindings, persists the resolved query and evaluation time before the source call, and reuses them
on retry. The source runtime validates and exhausts the selection. Only complete or deliberately
bounded selections produce a successful step. Structured output holds `records`, completeness,
schema revision, evaluation/read times, and resolved-query `provenance`. Its serialized size is
bounded to 16 MiB. Incomplete or oversized results cannot start dependent steps.

`get-record-details` takes a typed `record` binding to an exact `ref`, plus optional `projection`
pointers. Host-produced references retain source scope for dynamic discovery. Output contains the
reference, typed `data`, validated `schema`, and `fetchedTime`; not-found fails the step. References
identify records by plugin, source, connection, and record ID. Their carried scope is retrieval
context, not an additional identity component.

`if` takes a shared typed `condition` predicate and `branches` with `true` and `otherwise` targets.
Both targets must wait on the condition's stable step ID. The shared comparison rules preserve
missing versus null and allow explicit presence tests or fallbacks. The runner skips the untaken
branch and propagates skips through the graph. No model runs. `decide`, labelled **Ask AI to decide**,
remains a separate agent step.

Data calls use the workflow task's workspace and project, with a Node-created owner invocation.
Workspace queries retain their authored scope; explicit project restrictions must match the task.
Every invocation rechecks source and connection authority. Task credentials gain no provider route
access. Incremental checkpoint advancement uses the processing ledger described below.

The inspector uses client-core's shared source/query editor for `find-records` and its typed binding
picker for record inputs. Source metadata drives connections, parameters, filters, options, preview,
and nested inspection; the workflow plugin stores only the resulting protocol values. Conditions
remain a typed JSON repair surface until the outline-led workflow editor phase. Generation uses the
same descriptions and validation. Repository TOML uses `query_json`, `record_json`, and
`condition_json` for these structures.

## Record processing history

The workflow database owns selections, selected rows, record states, attempts, processing scopes,
and committed source boundaries. `WorkflowProcessingStore` reserves selected snapshots, repeat
decisions, eligible child dispatches, and a checkpoint in one transaction. Core tasks are created
only after that transaction commits. Recovery reuses the reserved task and run IDs.

A root can receive `processingScope: { scopeId, epoch }` through the internal start seam. The scope
is frozen in the same transaction as the root and its steps. Schedule integration uses its schedule
ID and explicit epoch. A manual root without this option receives independent history. Loop paths
use stable step IDs and ancestor item identities, so label edits do not reset history and nested
parents do not share a child-loop state.

Source rows use plugin, source, connection, and record ID as their identity. Retrieval scope and
display titles are excluded. Ordinary arrays require a stable typed key. `repeat` on `workflow-map`
supports `every-match`, `unseen`, and `changed`; the latter requires tracked JSON Pointer `fields`
against the retained item. Source item fields therefore address its envelope, such as `/data/state`.
Canonical projections distinguish missing from null, sort object keys, and preserve array order.
Changed-field decisions compare the last admitted or baselined snapshot, so A to B to A admits both
changes. An unchanged failed attempt is not automatically retried. Active attempts prevent competing
admission within the same record scope.

Changing tracked fields reprojects the retained snapshot. A field that cannot be reconstructed
requires an explicit baseline or fresh epoch. A baseline records identity and projection without
creating children. An explicitly reviewed baseline may replace a changed query's checkpoint
fingerprint, with a compare-and-swap check against the prior boundary. It retains attempt history.
A fresh epoch retains prior history under its original scope.

Retry resumes a failed attempt with its retained snapshot and task/run identities. It does not rerun
the source query. Reprocess prepares an immutable selected row and digest, then sends that digest with
a request identity to `reserveReprocess`. The method derives the original scope, snapshot, child
inputs, and definition from server rows; clients cannot substitute them. It reserves a related
attempt, creates an ordinary workflow child task, and starts the child workflow as an independent root
run. Nested records retain their original business history even though the new run has independent
runtime lineage. Replaying the same command reuses the reservation. Reprocess does not reopen a
settled parent or restart successful siblings.

An incremental `find-records` step feeds exactly one tracked loop through `/records`. Its path to
that consumer must be unconditional; conditions after the consumer are allowed. `take` is refused.
Only a complete execution selection can commit a source-provided boundary. Zero matches and all
skipped matches may advance it. Invalid bindings, limits, or changed active records roll back the
selection and boundary together. Query semantics and the previous boundary are checked at commit.
An expired token or changed query requires an explicit baseline or epoch decision. Cancellation
after commit retains cancelled child intents and the boundary for explicit reprocessing.

Device-only run routes expose filtered, paged selection summaries, chronological attempt history,
and a separate retained-snapshot read. Pages contain at most 100 rows and do not include record bodies
or named outputs. Detail and attempt payloads bound every preview. Skipped rows retain links to their
preceding attempt. The processing ledger does not prune record identity or automatically archive
tasks.

## Scheduled roots

The workflows plugin registers the `workflow` target with the node's scheduler. Core stores the
cadence, pause state, run ring, and timer policy. The plugin stores the approved workflow binding and
the occurrence ledger. No workflow-owned queue or timer runs beside the core scheduler.

Approval resolves a published definition in one project scope and freezes the complete graph, typed
inputs, limits, IANA timezone, generation, and processing epoch. It also pins published saved-query
revisions through the resolved graph. A timer or manual request reserves one occurrence with intended
root task and run IDs. Recovery reuses those IDs across `claimed`, `task-created`, and `run-started`
transitions.

The occurrence owns overlap until the root and every descendant are terminal. A gated descendant
therefore blocks a later timer or **Run now** request. Pausing the core schedule prevents timer
admission without cancelling the tree. Deleting it tombstones the workflow binding and retains all
task, run, occurrence, and record history.

Dispatch rechecks the published graph, repository trust, source metadata, connection authority, and
destination scope before it creates the task. A changed dependency or revoked authority moves the
schedule to `needs-review`. Temporary source failures retain the claimed occurrence for infrastructure
retry. A failed child is a workflow outcome and receives no automatic infrastructure retry.

For **Process current matches**, the first active occurrence applies ordinary repeat policy. For
**Track from now**, approval starts an inactive baseline occurrence. The persisted baseline flag makes
the processing transaction record identities, projections, and source continuation without reserving
child workflows. The schedule becomes active only after that root tree settles successfully. Zero
matches and all-skipped matches can still commit a continuation. An expired token or a changed query
returns the schedule to review for an explicit baseline or fresh epoch.
