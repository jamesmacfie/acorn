# An editable approval form on the human gate

Status: proposal, 2026-09-29. No implementation has started. Reviewed against commit `d79854b4`.

Give `gate-human` an optional form. The step declares typed fields and a binding for each one that
fills it from earlier steps. When the run reaches the gate, the reviewer sees the proposed values in
the run pane and can correct them before pressing **Approve**. The step's output is the values that
were approved, so later steps read what the person agreed to rather than what the agent first wrote.

The idea comes from noclick's approval node (`references/noclick/backend/nodes/approval_node.py`),
which pre-fills a form from upstream references and resumes the run with the edited values. Acorn
keeps its own gate semantics and borrows only the form.

## What the gate does today

The handler in `plugins/workflows/src/server/workflowBuiltins.ts` returns `waiting-gate`, or
`done` with `{ approved: 'autonomous' }` when the run's posture is autonomous. The runner parks the
step, sets the run to `gated`, rings the bell, and raises the `workflow:gate:<stepId>` attention row.
The run pane's node detail (`plugins/workflows/src/client/runs/NodeDetail.tsx`) draws "Waiting for
you." with **Approve** and **Reject**.

`POST /v1/p/workflows/workflows/runs/:runId/gate` takes `{ stepId, approved }` and calls
`resolveGate` in `workflowRunner.ts`. Approval writes `resultJson: { approved: true }` and resumes the
run. Rejection fails the step and the run. The step never writes `structuredJson`, so no later step
can bind to a gate's output. `${steps.<gate>.output}` renders the `resultJson` fallback.

The gate's `describe` in `plugins/workflows/src/shared/stepFields.ts` has no fields.

## Part one: only a device answers a gate

This part is delivered with the form, as the first change, and the form must not ship without it.

**The hole.** The gate route has no `isTaskConfined` refusal. The `ownsRun` middleware in
`plugins/workflows/src/server/routes/workflow.ts` only checks that a task-confined caller owns the
run's task, and an agent working in that task does. So an agent with the task's loopback credential
can approve its own run's gate, which turns a human gate into no gate. With a form it gets worse,
because the agent could also write the approved values.

The route test says the current behaviour is intended, and it's wrong. In
`plugins/workflows/src/server/routes/workflow.test.ts`, the block "a task-scoped credential is confined
to its own runs" checks that a confined caller can't gate a *foreign* run. A comment above "cannot
retry even its own run" calls retry "the one run action a confined caller may not take, even on its
own run". Cancel and kill are safe to leave open to the agent, because both stop work. Approval moves
a run past a check that exists to stop the agent, which is the reason retry is refused.

**The change:**

1. In the gate handler, refuse a confined caller before parsing the body, the same way retry does:
   `if (isTaskConfined(c)) return respondError(c, 403, 'forbidden')`.
2. Add a test beside "cannot retry even its own run": a confined caller posting
   `{ stepId: 's', approved: true }` to `/api/workflows/runs/run1/gate` gets 403, and the bridge's
   `gate` is never called. Also cover `approved: false`, because a rejection fails the run, and that
   decision belongs to the owner as well.
3. Reword the retry test's comment so it names both retry and gate as the run actions a confined
   caller can't take on its own run, and says why.
4. Record the rule in [security.md](../security.md) next to the other task-token route decisions:
   a gate answer is device-only.

The foreign-run cases in the existing test keep returning 404, because `ownsRun` runs first. That
order is right, since a foreign caller should not learn that the run exists.

## Part two: one answer per gate

This is also delivered with the form, before it.

**The race.** `resolveGate` in `plugins/workflows/src/server/workflowRunner.ts` reads the step, checks
`status === 'waiting-gate'`, then writes through `setStep`. Two devices answering the same gate both
pass the read. Today an **Approve** and a late **Reject** can both land. The step ends failed, but the
first answer's `tick` may already have started the next step. With a form, two approvals could also
write different values. The route answers `{ ok: true }` in every case, so neither device learns that
it lost.

**The change:**

1. Make the transition a compare-and-swap. Update the step `WHERE id = ? AND status = 'waiting-gate'`
   and check the affected-row count, as definition saves do. Only the caller whose update changed a row
   goes on to resume the run or finish it as failed.
2. Have `resolveGate` report the outcome as `resolved`, `already-resolved`, or `not-found`, instead of
   returning nothing. The deadline branch keeps its safety-rail behaviour.
3. Have the route answer 409 with the domain code `gate-resolved` for `already-resolved`, and 404 for
   `not-found`. The run pane handles 409 by refetching the step and showing the outcome, with the line
   "This gate was already answered."
4. Test it by resolving the same gate twice, approve then reject, and confirming that exactly one
   succeeds, the other gets `already-resolved`, and the run's final state matches the winner.

The compare-and-swap has to go through `setStep`'s side effects: the step-changed frame, the
gate-changed frame, and the telemetry span. So the conditional write belongs inside the runner, not in
a raw update beside it. A small `setStepIf(stepId, expectedStatus, patch)` that returns whether it
wrote is enough. `setStep` can then call it without an expected status.

## The definition

A gate gains an optional `form` key. Its field list reuses `WorkflowInput`, the type a workflow's own
inputs use, and its bindings reuse `WorkflowValueBinding`, the type child workflow inputs use. No new
value vocabulary is needed.

```json
{
  "id": "approve",
  "name": "Approve the release note",
  "kind": "gate-human",
  "after": ["draft"],
  "form": {
    "fields": [
      { "name": "title", "label": "Title", "schema": { "type": "string" }, "required": true },
      { "name": "body", "label": "Release note", "schema": { "type": "string" }, "required": true },
      { "name": "notify", "label": "Post to the channel", "schema": { "type": "boolean" }, "default": false }
    ],
    "values": {
      "title": { "address": { "from": "step", "stepId": "draft", "pointer": "/title" } },
      "body": { "address": { "from": "step", "stepId": "draft", "pointer": "/body" } }
    }
  }
}
```

A field's value comes from its binding, then its `default`, then nothing. A binding may read run
inputs and completed transitive predecessors, the same rule every other binding follows. In TOML,
`form` uses the encoding inputs and child bindings already use in `workflowToml.ts`:
`schema_json`, `default_json`, and `binding_json`.

A gate without `form` behaves exactly as it does today. Its output stays `{ approved: true }` in
`resultJson`, so no existing definition changes meaning.

**Why not a new kind.** `gate-human` already owns the waiting status, the gated run, the bell, the
attention row, child-run gating, and the autonomous-posture rule. A separate `gate-form` kind would
repeat all of it, and the two would drift.

## The output

An approved form gate writes `structuredJson`:

```json
{ "approved": true, "values": { "title": "…", "body": "…", "notify": true }, "edited": ["body", "notify"] }
```

`edited` lists the fields whose approved value differs from the proposal. It records what the person
changed. It also lets a later `if` or `decide` step branch on whether anything was changed.

The output schema is derived from the fields: an object with `approved`, `values` holding one property
per field, and `edited` as an array of strings. One pure function in `shared/` computes it. Two readers
call it: `workflowOutputSchema` in `client/editor/bindingOrigins.ts`, so the binding picker offers
`/values/title` downstream, and the runner's output check in `persistOutcome`. Nothing else learns
that a gate's schema depends on its fields.

## Reaching the gate

The handler resolves the form's bindings against the frozen run through `resolveChildWorkflowInputs`
in `server/workflowBindings.ts`, then applies defaults. It validates each resolved value against its
field schema. A binding that resolves to the wrong type fails the step with the field's name, the same
way a bad child input does. A missing value is legal here. It shows as an empty field for the person to
fill.

The proposal is frozen into the step's `inputsJson` before the step waits. That column already holds
"the assembled bundle handed to the step". The approver edits against a proposal that cannot move
underneath them, and the proposal stays readable after the run ends. This needs the `waiting-gate`
outcome in `StepHandlerOutcome` to carry an optional `inputs`, which is an additive change.

**Under an autonomous posture** the gate approves the proposal unchanged, as it does today, and writes
`approved: 'autonomous'` with an empty `edited`. A required field with no value fails the step with a
message saying that the run is autonomous and nobody was asked. Validation reports the same problem
early when the definition's own posture is autonomous. The runtime check stays because the problem can
still reach a run.

## Answering the gate

The route body becomes `{ stepId, approved, values? }`. The route refuses task-confined callers, as
described in the precondition. `values` is accepted only with `approved: true` and only on a gate that
has a form.

The node checks the submission before it writes anything:

1. The step is `waiting-gate` and belongs to the run.
2. `values` names only declared fields. An unknown name is refused.
3. Absent `values` means "approve the proposal as it stands". The node still validates it, so an empty
   required field refuses the approval.
4. Each value passes `validateDataValue` against its field schema within the shared 16 MiB limit.
5. Every required field has a value.

A refused submission answers 400 with one problem per field. The step keeps waiting, so the reviewer
can fix the value and try again. A second answer to a gate that has already been answered gets the
409 from part two.

**Rejection** is unchanged. It fails the step and the run, and any values sent with it are refused.

## The run pane

When the gate is waiting, the gate body in `NodeDetail.tsx` draws one `TypedValueField` per field,
filled with the proposal, with the field's label and description. A changed field carries a quiet
"Edited" marker and a **Reset** control that restores the proposal. **Approve** is disabled while any
field is invalid, and a 400 answer puts each problem under its field. After the gate resolves, the body
shows the approved values and marks the edited ones. Every control is a kit node, so the terminal
client draws the same form.

`TypedValueField` edits a non-text schema as JSON. That is acceptable for a number or a boolean. It is
poor for a structured object, so the first version should expect string, number, boolean, and enum
fields and let anything else fall back to JSON.

Edits in progress are held per step in the client while the app is open and aren't saved anywhere.
Closing the app before approving loses them, and the proposal remains. If a long body turns out to be
common, the editor's device recovery store (`client/editor/recoveryStore.ts`) is the model to follow.

The bell and the attention row still open the gate node, and nothing approves from the bell. A form
has to be seen to be approved.

## The editor

The inspector for a `gate-human` step gains a **Form** section. It reuses
`client/editor/InputsInspector.tsx` for the field list, and for each field a `TypedBindingPicker`
chooses where the proposal comes from. `WorkflowDispatchForm.tsx` does the same for child inputs.
`fieldHome` in `shared/stepFields.ts` answers "step" for `form`. The step preview lists the fields and
where each one is filled from.

`BUILTIN_STEP_VALIDATORS['gate-human']` checks the form against these rules:

- Field names follow the input-name rule and are unique.
- Each binding names a declared field.
- Each binding reads only run inputs and transitive predecessors.
- A `default` passes its field's schema.
- A form has at most 20 fields. That cap is a proposed number, not a measured one.

## Authoring by generation

The "Gates and posture" teaching in `server/generateWorkflow.ts` describes `form` with one example:
an agent drafts a value, a gate lets a person correct it, and a later step binds to `/values/...`.
Grounding must accept `form` on a `gate-human` step. When a generated form is invalid, the generator
drops the form and keeps the gate, never the other way round, so the result fails safe.

## Order of work

All seven steps are one piece of work. The first two change today's gate and are useful on their own,
so they go first and in separate commits.

1. Refuse task-confined callers on the gate route (part one).
2. Make gate resolution a compare-and-swap with a 409 for the loser (part two).
3. Add the `form` contract, validation, TOML round trip, and the derived output schema, with no UI.
4. Freeze the proposal at the gate, validate answers, write the output, and handle the autonomous path.
5. Draw the form in the run pane on both hosts.
6. Add the **Form** section to the editor.
7. Update the generation teaching and grounding.

## Not in this proposal

- **A rejection branch.** noclick routes a rejection down its own edge. In acorn a rejection fails the
  run, and a branch changes run semantics and failure reporting. Weigh that separately.
- **A rejection note.** It's cheap, but no one has asked for it.
- **Approving from the CLI.** `docs/cli.md` says the CLI never approves a gate. A form doesn't change
  that.
- **Gates on individual agent tool calls.** noclick also holds single tool calls for approval. That is
  a tool-policy question and belongs with `docs/agent-tools.md`.

## Docs to update when it ships

[workflows.md](../workflows.md) covers the run pane table and the gate's output.
[workflows/authoring.md](../workflows/authoring.md) covers the inspector.
[security.md](../security.md) records that a gate answer is device-only.
[api-reference.md](../api-reference.md) gains the gate route, which it doesn't list, with its 403,
404, and 409 answers.
[testing.md](../testing.md) gains a manual smoke item beside item 52: edit a proposed value,
approve it, and confirm that a later step received the edited value.

## Verify before building

- Whether a version 1 loader refuses an unknown step key. If it ignores `form`, an older node would run
  a form gate as a plain gate, and every downstream `/values/...` binding would fail. If so, make the
  loader refuse the key rather than bumping the format version.
- Whether contributed kinds may return `waiting-gate`, since widening that outcome widens their
  contract as well.
- Whether retry can re-run a resolved gate. If it can, it must write a fresh proposal rather than reuse
  the old one.
- Whether the `polish` worktree's move of `workflowBuiltins.ts` to `server/steps/builtins.ts` has
  landed. The paths above follow `main`.
