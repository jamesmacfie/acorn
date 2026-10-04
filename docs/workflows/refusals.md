# What workflows refuses

Workflows keeps being asked for the same things. This page lists the refusals that stop a reader from
reopening a settled decision, each with what would reopen it.

## Definitions and authoring

- **A separate `edges` list.** `after` on each step keeps every committed TOML file meaning what it
  meant and puts a step's dependencies beside it. The editor draws the edges either way.
- **A `parallel` group step.** A group boxes the model in the moment a step needs two upstreams from
  different groups. `after` says that with no group.
- **Moving the TOML into the database.** A file is hashed by the trust snapshot and reviewed in a pull
  request. A row is typed behind the device gate. Two trust stories, two stores, one merged read
  ([definitions](./definitions.md)).
- **Positions in the definition.** A definition moves between a file, a row, and a run's frozen copy,
  and none of them cares where a card sat. Device preferences hold positions
  ([where positions live](./authoring.md#where-positions-live)).
- **JSON Schema forms, or a plugin-drawn inspector.** The host would need a schema-to-form renderer
  that works in cells, and JSON Schema can't say "fetch these options". A closed field vocabulary with
  an options route is what kinds use ([step kinds](./step-kinds.md#a-kind-describes-its-own-form)).
- **Running an unpublished draft.** Publication keeps the runnable version clear.
- **AI that applies or publishes changes itself.** A proposal is one undoable draft edit, and
  publication and schedule activation stay separate steps. Record samples go to a model only with
  your opt-in.
- **Authority from an AI-authored definition.** Generation names only catalogued targets, and start
  still applies source trust and the root's limits.

## Execution

- **Always a child task per parallel step.** Most reading steps don't write, so a worktree each is
  heavy. A step asks with `isolation = "worktree"`.
- **A PTY per command.** Clean stdout from a PTY is lossy, and a headless Node would have to hold it
  open. `terminal:run-target` is for a process someone wants to watch.
- **`database:write`.** Deferred, not refused. It needs an execute-tier ceiling check and an audit row.
- **Rerun from an arbitrary step.** It would mean unwinding successors' outputs. Retry of a failed
  step covers the common case ([retry](./execution.md#retry)).
- **Editing a live run's definition.** A run freezes its definition. Retry with an edited prompt
  patches one step of the frozen copy and keeps the original.
- **Agent tools that start or drive a run.** The `agent_*` tools act on managed sessions. A workflow
  control tool would have to keep frozen definitions, run authorization, and budgets intact.
- **A second child execution engine, or detached child runs.** Child dispatch runs the ordinary runner
  against a frozen graph, and waits for every admitted child.
- **Unbounded or remote recursion.** Children stay in the same project and Node, with four levels and
  at most 500 descendants per root.
- **Automatic child cleanup.** Child tasks and worktrees are your work and stay until you archive them.

## Data and scheduling

- **A universal work-item schema, or a provider-specific editor.** Both lose provider meaning or
  defeat the shared source contract.
- **Cross-source joins, or several connections in one query.** Use one query per connection.
- **A generic host query fallback, or a schema inferred from samples.** A source declares what it
  supports and what its fields are.
- **A general expression language.** Typed bindings and bounded predicates cover the known workflows.
- **Exactly-once external effects.** Invocation identity prevents duplicate tasks and runs. Repeat
  policies control admission, not external effects.
- **Automatic retries of failed items.** A retry is an explicit action.
- **Timestamp checkpoints for every source.** An incremental read needs the source's own
  continuation contract.
- **Overlapping runs of one schedule.** The next occurrence is skipped and links to the active run.
- **Implicit triggers from a draft.** Only a published workflow can be scheduled, through an explicit
  approval that freezes its graph and limits.
- **A generic provider write-back contract.** Writes go through workflow actions. Dashboard write-back
  shipped in the dashboards programme. See [dashboards](../dashboards.md#published-panels).
