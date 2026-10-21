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
  ([where positions live](./editor-details.md#where-positions-live)).
- **JSON Schema forms, or a plugin-drawn inspector.** The host would need a schema-to-form renderer
  that works in cells, and JSON Schema can't say "fetch these options". A closed field vocabulary with
  an options route is what kinds use ([step kinds](./step-kinds.md#a-kind-describes-its-own-form)).
- **Running an unpublished draft.** Publication keeps the runnable version clear.
- **AI that applies or publishes changes itself.** A proposal is one undoable draft edit, and
  publication and trigger activation stay separate steps. Record samples go to a model only with
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
- **Overlapping runs of one trigger.** A clock trigger skips the next occurrence and links to the
  active run. A record trigger runs each record on its own, so it starts nothing for a record whose
  run is still going and sees that record again on a later check.
- **A trigger fed by its own runs.** A record trigger never admits a run it started, read through the
  Workflow runs source, or the task it made for one, read through core's Tasks source. A longer loop
  through another source, or between two triggers, meets the daily cap.
- **Implicit triggers from a draft.** Only a published workflow can have a trigger, through an explicit
  approval that freezes its graph and limits.
- **A generic provider write-back contract.** Writes go through workflow actions. Dashboard write-back
  shipped in the dashboards programme. See [dashboards](../dashboards.md#published-panels).

## Unattended starts

A trigger starts a run with nobody present, so a refusal only the owner can fix stops it and asks for
review rather than retrying (see [triggers](./triggers.md#review-and-refusals)). The start service
throws `WorkflowAuthorityError` with one of these reasons:

| Reason | When |
| --- | --- |
| `forbidden` | A data source refused the Node's access |
| `connection-required` | A data source needs an account that isn't connected |
| `input-required` | A connection input, such as an account picker, has no value on this Node |
| `not-published` | The workflow or a saved query it uses has no published revision |
| `missing` | The project, the task, a configured record loop, or a field a record trigger watches no longer exists. A record trigger's expired checkpoint, or a query that changed since its checkpoint, says this too |
| `untrusted` | The project's repository configuration hasn't been reviewed and trusted |
| `unguarded-agent` | A record trigger's agent step would run commands with no sandbox and no approval, and the trigger wasn't approved to allow that. It arrives from a failed run, not from the start |

Any other failure is treated as passing, and the scheduler tries again. Every reason except
`unguarded-agent` is thrown by the start service. That one is recorded on the failed run as its error
cause, and the trigger moves to **Needs review** when the run settles
([agent steps](./triggers.md#record-triggers)).

A record trigger also stops and asks for review when it starts its daily number of runs, 50 by
default: "Started 50 runs today. Review the trigger before it starts more." A record whose values
don't fit the workflow's inputs isn't a refusal of the trigger. Its occurrence is blocked with a
reason that names the record and the input, and the other records go on.
