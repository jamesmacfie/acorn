# Workflows: an editor, a database store, a run surface, and the engine changes they need

Status: proposal, 2026-09-08. Nothing here has started. Every decision in the table below was taken
with the owner on that date and a phase file may not reopen one.

acorn already runs workflows. `plugins/workflows` is a durable engine: a run is rows, a step is a
row, a restart sweeps interrupted steps back to pending, budgets and tool ceilings intersect
downward, a human gate parks the run, and any plugin can add a step kind through
`workflows:step-kind`. [docs/workflows.md](../../workflows.md) owns what has shipped.

What does not exist is anything a person touches. Definitions are TOML files someone writes by hand.
There is no place to watch a run: the agents pane's task sidebar draws step rows and opening one
spawns a terminal. A run's agent session knows which workflow started it and the agent pane never
says so. The bell rings for a gate and the row goes nowhere when clicked. And the engine cannot run
two steps at once on one task, cannot take an input from the item that started it, and cannot tell
an editor what a contributed step's form looks like.

This folder is the plan to close all of that. The first workflow it has to make possible is the
owner's: two agents investigate one issue from different angles at the same time, a third agent
reads both answers and writes the synthesis, and any of the three may lean on a shell command or a
database query along the way. Started from a Rollbar item's menu, watched in the task's run pane,
with each agent one click away.

## Two refusals reversed

[docs/future/orchestration.md](../orchestration.md) § What this does not build refuses a DAG editor
("a visual editor serves neither" the declarative nor the agent-driven half) and a workflows pane
("the Agents sidebar already merges sessions with workflow steps"). Both refusals weighed an agent
driving agents. Neither weighed a person authoring in the UI, which is the use case here. This
programme reverses both, and phase 0 rewrites that section to point here so the argument is not had
twice. Step 9 of that file's phasing, `workflow_defs` as database truth merged under the repo layer,
is phase 2 of this folder.

## Goals

1. **Author a workflow without writing TOML.** A list of nodes with an inspector, a JSON tab for the
   escape hatch, and later a canvas. Repo files stay reviewable in a pull request; database rows are
   for the person at the keyboard. The editor can write a row back into the repo as TOML.
2. **Run steps in parallel on one task.** A step names what it waits on. Two investigators share the
   checkout; a step that writes code asks for its own worktree.
3. **Feed a run from the thing that started it.** A definition declares inputs, a prompt references
   them, and the item menu fills them from the Rollbar error or Linear issue.
4. **Let a plugin's step kind draw its own form.** A kind describes its fields as data, the host
   renders them on both hosts, and the plugin keeps validation.
5. **Watch a run where the task is.** A task pane lists runs and nodes, streams each node's progress,
   and links to the agent session or terminal doing the work. The agent pane links back.
6. **Start from where the item is.** The Rollbar, Linear, and GitHub row menus gain "Start
   workflow…", which creates or attaches a task and starts the run.
7. **Notify with somewhere to go.** Every bell row for a workflow opens the run pane at the node.

## Decisions taken

| # | Decision | Why | What it forecloses |
| --- | --- | --- | --- |
| 1 | A step declares `after`, the names of the steps it waits on. Absent means the previous step; an empty list means a root. Edges are derived from `after`. | Every existing TOML file keeps its meaning with no migration. The runner change is "start every ready step" instead of "start the first pending step". | A separate `edges` table; a `parallel` group kind. |
| 2 | Parallel steps share the task's checkout. A step sets `isolation = "worktree"` to get a child task and its own checkout, through the fan-out machinery that already creates children. | Investigate, review, and summarise do not write. Paying a worktree per reader is what makes fan-out feel heavy. | Always a child task per parallel step. |
| 3 | A definition declares `inputs`. Prompts and `with` strings reference `${inputs.<name>}`. The start body carries values. | A run started from a Rollbar item needs that item, and prose in a task link does not reach a `terminal:command` step. | One implicit context string; task-context injection as the only path. |
| 4 | Database definitions live in `workflow_defs` with a `workspaceId` and a nullable `projectId`. The rail lists the workspace's rows plus its projects' repo files, badged by source. Repo wins on an id collision. TOML never moves into the database. | The rail is workspace-scoped. A repo file is hashed by the trust snapshot; a row is owner-typed. Different trust stories, different stores, one merged read. | Project-only rows; node-wide rows. |
| 5 | A step kind carries `describe`: a label, an icon, a closed list of fields, and an output note. Fields are `text`, `textarea`, `number`, `boolean`, `select`, or `prompt`, and a select may name a route that lists its options. The host draws the form. | `CredentialField` and collection params already work this way, on both hosts. A form the host draws can be indexed and validated. | JSON Schema forms; a plugin-rendered inspector tree. |
| 6 | An agent node has `inputs = "append" \| "template" \| "none"`, default `append`: every incoming edge's output lands under a heading after the prompt. `template` means the prompt places `${steps.x.output}` itself. | A node connected to two upstreams should see both without editing the prompt, and a node that wants a subset needs a way to say so. | Always explicit; always append. |
| 7 | `terminal:command` runs `/bin/sh -c` in the task's checkout through core's process runner, captures stdout, stderr, and the exit code, and streams the tail to the run pane. A non-zero exit fails the step unless `allowFailure` is set. `terminal:run-target` starts a declared run target and outputs its URL. | Capturing a clean stdout from a PTY is lossy, and a headless node with no client attached still has to hold the PTY. The run-target path already exists as `requiresRun`. | A PTY per command; a per-node tee. |
| 8 | `database:query` runs a saved query or inline SQL and outputs columns and rows, capped at 200 rows or 256 KB. `database:generate` turns a prompt into SQL through the existing generator and runs it. The database plugin exports a `database.query` capability. | Both reuse code the database plugin has. The cap keeps a result small enough to interpolate into a prompt. | `database:write` (deferred, not refused). |
| 9 | The editor is a list of nodes with an inspector and a JSON tab, drawn from the kit so both hosts have it. A canvas comes last, as a kit `Graph` node with a DOM projection and a cell projection. | Plugin client code may not emit raw DOM or SVG. A canvas is therefore a kit admission, and the kit admits a node when two surfaces need it with both projections written. The run pane is the second consumer. | Canvas first. |
| 10 | Editing happens on a project-scoped surface at `/p/:projectId/x/workflows/:id`, reached from a "Workflows" left-rail source. Repo files open read-only with "Copy to database". | A definition is not task state, and Settings has no project in scope and no terminal counterpart. The HTTP and database panels are addressed the same way. | A task pane; the Settings page. |
| 11 | The run pane shows, per node: for an agent, its state, last text, cost, and "Open in Agent pane"; for a command, the streamed tail and exit code, and for a run target a button to its terminal; for a data node, a table or JSON and the SQL or URL behind it. | The transcript stays in the agent pane. The run pane answers "what is it doing" and "where do I go". | A rendered-prompt view (a door left open). |
| 12 | "Start workflow…" on a Rollbar, Linear, or GitHub row opens the existing promote-to-task modal with a workflow picker on top, inputs prefilled from the item, then the New task and Attach tabs. All three lists move onto the context-menu registry under a new `item.row` location. | One modal already knows how to create or attach. GitHub's menu is hand-written and Rollbar's is host-drawn; the registry is where both belong. | A separate start dialog; task-only starts. |
| 13 | A waiting gate is an attention row (`warn`, kept until resolved) and a notice. A failed or safety-railed run is a notice. A finished run keeps its notice. Every one targets the run pane at the node. An agent's permission request inside a run stays the agents plugin's row, naming the workflow in its detail. | A row with nowhere to go has no reason to exist. | |
| 14 | The agent pane header shows a chip, "Workflow: name · step", that opens the run pane. The sidebar row for a workflow session gets a glyph. The sidebar's "Terminals and workflows" rows go, because the run pane owns steps. | The data is on the session row and unread. | Grouping sessions by run in the sidebar. |
| 15 | "Save to repo" serialises a row to `.acorn/workflows/<id>.toml` in the task's checkout. The row is kept or deleted at save time. | Draft it in the UI, commit it for review. The snapshot covers the file from then on. | Export-only. |
| 16 | A failed or safety-railed node offers "Retry" and, for an agent node, "Retry with edited prompt". The run leaves `failed` and continues from that node. | The cheap half of proliferate's rerun controls. | Rerun from an arbitrary node; run-again as the only option. |
| 17 | A step's `name` stays its identity. Renaming in the editor rewrites every `${steps.old.output}` and every `after` entry in the draft. Names are slug-shaped and unique. | TOML stays readable and every existing file keeps working. | A minted `id`. |
| 18 | Out of scope: triggers and schedules for database definitions; agent tools that start or drive a run; retargeting a live run. | Each is a programme of its own. A run freezes its definition at start already. | |
| 19 | Node positions live in device preferences keyed by definition id, never in the definition. | proliferate's rule, and it keeps a portable definition portable. | |

## The admission rule for a new step kind

A kind joins the catalog only if all four hold:

1. It is owned by the plugin whose code already knows how to do the thing safely. The HTTP kind lives
   with the scheme check; the command kind lives with the process runner's environment allowlist.
2. Its inputs are a `describe` the host can draw. If a field needs a component, it is not a field.
3. Its output is structured, so a later `decide` can branch on it. Prose is not control flow.
4. A failure and an answer are told apart on purpose. An HTTP 500 is an answer; a refused URL is a
   failure. A non-zero exit is a failure unless the step says otherwise.

[refused.md](./refused.md) holds what failed the rule and why.

## The files

Supporting documents, readable in any order:

| File | What it holds |
| --- | --- |
| [01-what-exists.md](./01-what-exists.md) | The verified inventory, with paths, so a phase does not re-survey. Read this first. |
| [02-definition-model.md](./02-definition-model.md) | The definition after this programme: inputs, `after`, isolation, the agent node's fields, validation, and the worked example. |
| [03-step-kinds.md](./03-step-kinds.md) | `describe`, the field vocabulary, the catalog route, and the four kinds this programme adds. |
| [04-runs-and-live-state.md](./04-runs-and-live-state.md) | The parallel tick, retry, what streams over the socket, notices with targets. |
| [05-ui.md](./05-ui.md) | The rail source, the editor, the run pane, the start flow, the agent pane chip, the palette, and what each draws in a terminal. With mockups. |
| [06-storage-and-trust.md](./06-storage-and-trust.md) | The `workflow_defs` table, its routes, the merged read, save to repo, and where trust sits. |
| [refused.md](./refused.md) | What was considered and set aside, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document under `docs/` that changes, which phase changes it, and how. |

## The phases

| Phase | File | What it delivers | What it unblocks | Waits on |
| --- | --- | --- | --- | --- |
| 0 | [phase-0-engine.md](./phase-0-engine.md) | `after`, `inputs`, `isolation`, the agent node's `inputs` mode and config options, retry, notices that name the run and step | Everything else. The owner's first workflow runs from a TOML file | Nothing |
| 1 | [phase-1-step-kinds.md](./phase-1-step-kinds.md) | `describe` on every kind, the catalog route, `terminal:command`, `terminal:run-target`, `database:query`, `database:generate` | Forms in the editor; command and query nodes in the first workflow | Phase 0 |
| 2 | [phase-2-database-definitions.md](./phase-2-database-definitions.md) | `workflow_defs`, its routes, the merged read, start by id, save to repo | The editor has somewhere to write | Phase 0 |
| 3 | [phase-3-editor.md](./phase-3-editor.md) | SHIPPED. The rail source, the project surface, the draft model, the inspector, the JSON tab, layout preferences | Authoring in the UI | Phases 1 and 2 |
| 4 | [phase-4-run-pane.md](./phase-4-run-pane.md) | SHIPPED. The task pane, per-kind node detail, controls, the attention source, notice targets, the agent pane chip, the sidebar cleanup | Watching a run; every bell row has a destination | Phase 0; reads phase 3's list rendering |
| 5 | [phase-5-start-from-items.md](./phase-5-start-from-items.md) | SHIPPED. `item.row` on the context-menu registry, all three lists on it, the modal's workflow step | The one-click start from an item | Phases 2, 3, 4 |
| 6 | [phase-6-canvas.md](./phase-6-canvas.md) | SHIPPED. The kit `Graph` node, both projections, the editor's view toggle, the run pane's graph | A picture of the graph | Phases 3 and 4 |

## The order of work

Phase 0 is the engine and stands alone. It is worth landing first because the owner's first workflow
can then run from a hand-written TOML file, which proves the parallel tick, the inputs, and the
synthesis step before any UI exists.

Phases 1 and 2 both wait only on phase 0 and can run beside each other. Phase 1 is node-side and
touches three plugins; phase 2 is one plugin's table and routes.

Phase 3 needs both: the catalog to draw forms and the table to save into. Phase 4 needs only phase 0,
but its node list is the same rendering phase 3 builds, so doing 3 first avoids two list components.
Phase 5 needs a workflow to pick (2), a picker to draw (3), and somewhere to land (4). Phase 6 is the
canvas and comes last because the list already works on both hosts.

## How to work a phase

Each phase file has the same sections as the client-plugins programme: goal, why now, scope, design
detail, code touched, tests, docs owed, doors left open, done when, verify before building. Two rules
apply:

- **Verify before building.** File and line references were checked against the tree on 2026-09-08.
  Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says which
  document owns each behaviour afterwards. A phase is not done until that document says the new true
  thing.

Two more that are this folder's own:

- **The smoke check is the owner's first workflow.** Phases 0, 3, and 4 each end by running it: two
  investigators in parallel, one synthesiser, started with an input, watched to the end.
- **A planned file is marked.** The documentation checker refuses a repo-rooted path in backticks that
  does not exist unless the line says `(new)`. Every file a phase adds is written that way here.

## What this folder is not

- It does not build agent tools that spawn or wait on agents. [orchestration.md](../orchestration.md)
  owns that and its spawn ledger.
- It does not give database definitions a trigger or a schedule. Repo files keep theirs.
- It does not change how a run's agent session is stored or streamed. `plugins/agents` owns the
  session; this folder reads two fields it already writes.
- It does not build a second run list. The merged list at Settings → Runs stays as it is; the run
  pane is the workflows plugin's own surface, addressed by task.
- It does not schedule anything.
