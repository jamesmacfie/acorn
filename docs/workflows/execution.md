# Workflow execution

This page covers how the Node runs a workflow: the execution model, the graph, inputs, isolation,
retry, and human gates. The code is in `plugins/workflows/src/server/`.

## Execution model

The workflow loader parses and validates a definition, rejects cycles, expands static branches, and
checks the exact repository configuration trust snapshot before starting a run from a committed file. Steps can invoke
managed agent sessions, terminal/run targets, GitHub checks policies, or human gates. Structured step
output is the only value that controls branching and joins; transcript prose cannot satisfy a gate.

Runs and steps persist state transitions. A restart reconciles persisted operation IDs and never
blindly repeats an external side effect with unknown outcome. Ambiguous work parks in an explicit
recovery/gated state. Cancellation propagates to child sessions and process groups.

The Node implementation follows those boundaries under `plugins/workflows/src/server/`.
`definitions/` loads and resolves frozen definitions. `validation/` checks their graph, bindings,
and destination. `runs/` coordinates graph ticks, start, retry, recovery, row writes, and termination.
Its `read/` folder projects persisted runs for the client. `steps/` renders handler inputs and records
step outcomes. `dispatch/` reserves and waits for child workflows. `processing/` owns tracked record
attempts and incremental checkpoints. `schedules/` owns scheduled admission. `routes/` exposes
the Node capabilities without owning execution state.

Run lists and task navigation select scalar fields from SQLite. Navigation retains every historical
descendant when choosing the latest run per task. Equal update timestamps keep insertion order.
Reprocess roots use the source dispatch's original root when that lineage remains available.
Task run history retains the frozen definition for the graph and reads compact parent and root
lineage separately. Equal creation timestamps keep insertion order. Usage is grouped by run and root;
an absent admission remains unknown, while a recorded zero remains zero. Execution graphs and
authority stay in durable rows for execution and recovery.

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

### Isolation

An agent step with `isolation = "worktree"` runs on a child task with a checkout of its own, created
through `CoreServices.tasks.createChild()` with a branch derived from the run name and the step ID.
The child task ID lands in the step's `inputs_json`, so
cancelling the run reaches it. The default, `shared`, runs the step on the run's own task beside its
siblings. Two investigators reading the same checkout can share a task; child workflows use separate tasks.

### Retry

`POST /v1/p/workflows/workflows/runs/:runId/retry` takes a `stepId` and an optional `prompt`. The run
must be `failed` or at a safety rail, and so must the step. The step goes back to `pending` with its
error cleared and its iteration count kept, every skipped step that only the retried step could reach
comes back with it, and the run returns to `running`. A step with a managed session reuses it, so a
retry with an edited prompt is another turn in the session the owner is already watching.

An edited prompt patches the run's frozen definition for that step alone. The original is kept in the
step's `inputs_json` as `originalPrompt`, so the record of what was first asked survives the re-run.

Retry is a device action. A task-confined caller, meaning an agent inside the run, gets a 403,
because it could otherwise loop a failed step past the rail that stopped it. The budget rule holds
either way: a retry's usage adds to the run's persisted sum and the same rail fires again.

### Human gates

A `gate-human` step parks the run in `gated`, rings the bell, and raises the
`workflow:gate:<stepId>` attention row. Under an autonomous posture it passes straight through with
`{ approved: 'autonomous' }`. Approving resumes the run and rejecting fails the step and the run.

A gate can carry a `form`. Its `fields` are declared the way workflow inputs are, and its `values`
bind each field to a run input or a transitive predecessor, the way child inputs bind:

```json
{
  "id": "approve", "name": "Approve the release note", "kind": "gate-human", "after": ["draft"],
  "form": {
    "fields": [
      { "name": "title", "label": "Title", "schema": { "type": "string" }, "required": true },
      { "name": "notify", "schema": { "type": "boolean" }, "default": false }
    ],
    "values": { "title": { "address": { "from": "step", "stepId": "draft", "pointer": "/title" } } }
  }
}
```

A field's proposal is its binding's value, then its `default`, then nothing. When the run reaches
the gate, the handler resolves the proposal, checks each value against its field's type, and freezes
it into the step's `inputs_json` as `form.values` before the step waits. The reviewer edits values
that cannot change underneath them, and the proposal stays readable after the run ends. A value of
the wrong type fails the step with the field's name. A missing value is allowed and shows as an empty
field. A form holds at most 20 fields. In TOML, fields use `schema_json` and `default_json` and
bindings use `binding_json`, as inputs and child bindings do.

An approval with a form writes the step's structured output:

```json
{ "approved": true, "values": { "title": "…", "notify": true }, "edited": ["notify"] }
```

`edited` names the fields whose approved value differs from the proposal. The output schema is
derived from the fields (`plugins/workflows/src/shared/gateForm.ts`), so a later step binds to
`/values/<field>` and the editor's picker offers it. `approved` is left out of that schema, because it
is `true` or `'autonomous'`. A gate without a form writes no structured output and keeps
`{ approved: true }` in `result_json`.

The route body is `{ stepId, approved, values? }`. `values` comes only with an approval, only on a
gate with a form, and is the complete set being approved: a field left out is approved empty. Without
it, the node approves the proposal as it stands. The node refuses an unknown field, a wrong type, and
an empty required field with a 400 that names each one, and the gate keeps waiting.

Under an autonomous posture, a form gate approves its proposal unchanged with
`approved: 'autonomous'` and an empty `edited`. A required field with no value fails the step,
because nobody was asked. Validation reports the same problem when the definition's own posture is
autonomous.

Only one answer lands. The step leaves `waiting-gate` through a conditional update, so of two devices
answering together one changes the row and the other gets a 409 with the `gate-resolved` code. Only
the winner resumes or fails the run. A gate answer is device-only: a task-confined caller gets a 403
even on its own run ([security.md](../security.md)). A rejected gate can be retried like any failed
step, and the re-run resolves a fresh proposal.

An older node ignores `form` and runs the step as a plain gate. Any later binding to `/values` then
fails validation, because a plain gate declares no structured output, so such a definition does not
load there.

## Related pages

<a id="what-an-agent-step-sees"></a>
<a id="a-turn-that-ends-early"></a>

[Agent steps](./agent-steps.md) covers what an agent step sees and a turn that ends early.

<a id="what-a-run-reports"></a>
<a id="where-a-file-comes-from"></a>
<a id="child-workflow-tasks"></a>
<a id="client-run-refreshes-and-live-output"></a>

[Running child workflows](./child-runs.md) covers what a run reports, where a file comes from, child
workflow tasks, and live output.
