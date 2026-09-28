# Workflow execution

Part of [workflows.md](../workflows.md).

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
durable transcript ([managed-agents.md](../managed-agents.md)). A profile without one runs it headless:
a one-shot process, its stream captured into the step's events, and no session for the run pane to
draw. Each child workflow resolves its own step profile from the frozen definition.

One narrowing on top of that: a `decide` step needs a profile with a one-shot structured mode, which
validation tests for on the profile itself rather than against a list of names, so both `claude-code`
and `codex` qualify and a profile with no such mode is refused when the file is saved. A harness a
plugin contributed as manifest data passes that check too, because it declares the same one-shot mode
to appear in the Generate lists ([plugin-authoring.md](../plugin-authoring.md) § Harnesses). One whose
stdout is read as plain text has no way to answer with a verdict object, so the step fails while it
runs rather than when the file is saved. A `decide` step that has to work names a code-tier profile.

An agent step also takes `config_options`, a table of provider option ids to values as the provider
advertises them, such as `model` and `reasoning`. The runner hands them to the agents plugin, which
applies them to the session after the provider reports its option list and before the turn is
enqueued. A value the provider does not offer is dropped and recorded in the transcript rather than
failing the step. Where a step sets both `model` and `config_options.model`, validation refuses the
file. Effort names don't mean the same amount of thinking on every model: Anthropic measured
`medium` on Opus 5.5 matching `high` on Opus 5, so a `reasoning` value carried over from Opus 5 runs
longer and costs more than it did.

### A turn that ends early

A managed step is a turn, and the step's result is that turn's final message. A model can end a turn
on a progress report instead of the finished work, so acorn guards the step three ways
(`plugins/agents/src/server/sessions/sessionExecute.ts`):

1. A Claude session for a workflow step or a delegated agent gets an extra instruction appended to
   Claude Code's system prompt. It names the ways of ending a turn early that Anthropic has seen and
   asks the model to carry on instead (`plugins/agents/src/server/drivers/claudeHarness.ts`). An
   interactive chat doesn't get it, because a person is there to answer.
2. If the turn ends without the result the step needs, meaning no message at all or no `json` block
   that matches the step's schema, acorn sends one more turn telling the agent to finish or say what
   blocks it. It does that twice at most, then the step is `malformed` as before. The transcript
   labels these turns **Acorn**, and the step's own prompt **Workflow**. The step's events cover
   every turn, but its usage and cost are the last turn's alone.
3. A turn the model declined, with the stop reason `refusal`, fails the step with that reason and is
   never sent again. Asking again in the same words gets the same answer.

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

### What a run reports

A run raises a `workflow.run` span and each of its steps a `workflow.step` span, both through
`ctx.telemetry`, both owned by this plugin, and all of them in one trace, so a slow step is found
from the run rather than from a list of unrelated spans
([telemetry.md](../telemetry.md) § Ambient attribution). The run span carries the run id, the trigger
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
