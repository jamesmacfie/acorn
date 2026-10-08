# Goals for workflow agent steps

Date: October 8, 2026. Status: implemented October 8, 2026. See
[agent steps](../workflows/agent-steps.md#completion-conditions) for the reference. One gap remains:
the standalone Agent pane doesn't show a workflow session's goal. The run pane, which draws the same
conversation, does.

Let a workflow author define a completion condition for an agent step. Acorn checks recorded
evidence and continues the step until that condition is satisfied or execution reaches a blocker
or limit. This proposal covers authoring, execution, persistence, and inspection.

## Problem and outcome

A managed workflow step can finish with a valid final message while its assigned work remains
unfinished. Result repair asks for missing text or structured output, and plugin reviewers can send
corrections, but neither supplies a completion condition for the step itself.

An author must be able to say both what to do and what counts as finished. Downstream steps receive
the result only after the completion check passes and the final output satisfies the step's schema.
Completion remains a model judgment from recorded evidence. It is not an independent test runner.

## Scope

The first release supports these uses:

- An optional goal on the built-in `agent` step, in workflow files and the editor.
- An optional goal on `workflow-map.agent`, with separate state for each dispatched item.
- Managed Claude, Codex, and contributed harnesses that support the goal evaluator's model call.
- Gated and autonomous workflow postures, shared and worktree isolation, and structured results.
- Desktop and TUI authoring and run inspection through their shared workflow components.

Headless-only profiles, `decide`, `ci-loop`, and contributed step kinds are outside this release.
Their execution or completion rules differ. Workflow-wide goals, automatic retries of failed steps,
configurable judges, and a separate goal orchestration service are also outside scope.

## Author experience

In an agent step's inspector, add an optional **Completion condition** field after **Prompt**.
Use the same field in **For each > Agent**. Keep it visible alongside the result schema and timeout.
Use this help text: "Acorn checks this condition after turns and continues while useful work remains."

For example, an author configures this step:

| Field | Value |
| --- | --- |
| Prompt | Investigate and fix the login regression in the supplied issue. |
| Completion condition | The regression is fixed, the login tests pass, and the fix is committed. |
| Timeout | 30 minutes |

For each Dependabot issue, an author can give the item agent a condition that its affected tests pass
and its fix is committed. Each item keeps its own session and goal state. The map's isolation and
concurrency settings continue to decide where and when it runs; a goal creates no additional task.

An absent goal preserves ordinary agent-step behavior. Clearing the field removes the definition's
goal. Editing a definition affects future runs; a running step keeps its frozen completion condition.

## Definition and validation

Add optional `goal: string` to `WorkflowStepDef` for `agent`, and to `WorkflowMapAgent`.
Use `goal` in both workflow JSON and TOML. For example, a proposed step table is:

```toml
[[steps]]
id = "fix-login"
name = "Fix login"
kind = "agent"
prompt = "Investigate and fix the supplied login regression."
goal = "The regression is fixed, the login tests pass, and the fix is committed."
```

The goal uses the prompt's binding syntax and validation rules. Render it once from the frozen
inputs and predecessor values, then save the resolved text with the step attempt's inputs.
Accept one to 2,000 characters after trimming and rendering. Reject an empty, oversized, or invalid
goal with an error naming the step and field. The editor writes a blank field as absent.

A goal requires a managed driver and support for the evaluator's model generation. Validate the
resolved harness, including the workflow default. If the Agents capability becomes unavailable at
dispatch, fail with an actionable error before starting work. Do not silently run a goal headlessly.
Unsupported step kinds reject the field. Parsing, serialization, definition fingerprints, file trust,
publication, and frozen run definitions must all include it.

## Execution and completion

The agents plugin owns one execution loop for the workflow operation. It incorporates goal checks
into managed step execution. Reuse the interactive goal evaluator's evidence builder, verdict
validation, continuation prompt, model selection, and limits. Keep interactive goal scheduling
attached to interactive sessions; the workflow owner queues its own continuations.

Execution follows these rules:

1. Include the resolved goal in the opening prompt alongside the work request and result contract.
2. Wait for the operation's accepted turns and joined plugin notes to settle before checking.
3. Check evidence from this step attempt's owned turns, including notes and continuations. Exclude
   earlier attempts and unrelated turns in a reused session. Supply the frozen goal as instruction
   and transcript content as evidence, with the shared 12,000-character bound.
4. Save the verdict against the exact evaluated turn set and committed sequence ceiling.
5. Continue only for `goal_not_met_yet`, with the goal, the verdict's reason, and the result contract
   in the next prompt. Use the normal turn admission path and the same managed session.
6. After satisfaction, require the final output to match the result schema. Missing text or malformed
   output can use the two result-repair attempts. Recheck the goal after a repairing turn.
7. Open the plugin review window once when the goal and result are both acceptable. Wait for joined
   corrections and recheck their final evidence and output. A correction opens no second window.
8. Close and drain the operation before publishing. If a note or turn joined during admission or
   evaluation, discard the stale completion decision and inspect the saved operation again.

The step remains running through checking, continuation, and review. It publishes one final result
and one downstream handoff. Intermediate JSON or a progress report cannot finish the step.
Its final result comes from the last owned turn, preserving the workflow's output schema.

| Outcome | Required behavior |
| --- | --- |
| Goal satisfied and final output valid | Complete the step and release downstream work. |
| Useful work remains | Queue a bounded continuation. |
| Missing evidence, human decision, external wait, or unsupported assumption | Fail the step with the check's reason. |
| Refusal, `BLOCKED:`, provider failure, or interruption | Preserve the terminal reason and queue no goal continuation. |
| Invalid, timed-out, or unavailable check | Fail with "Unable to check completion" and retain its diagnostic. |
| Goal continuation or progress limit reached | Fail with an explicit goal-limit reason and retain the last verdict. |
| Workflow budget exhausted | Use the workflow's safety-rail outcome. |
| Run or step cancelled | Cancel the operation and publish no successful result. |

## Limits and accounting

Keep a maximum of eight automatic continuations per goal-enabled step attempt, shared between goal
continuation and result repair. Result repair also retains its two-attempt limit. Stop after two
consecutive goal continuations without a tool call or file change. Joined plugin notes retain their
own admission limits and contribute to the operation's usage and deadline.

Use one deadline for the whole step, including evaluation and review. Each check gets at most
30 seconds and the remaining step time. A continuation, repair, or check must not reset that deadline.

Reserve the workflow turn budget before each automatic continuation or repair. A step with
`maxTurns = 1` cannot admit a second agent turn. Charge reported provider usage for every owned turn
and judge call once, preserving Codex cumulative accounting. Judge calls count toward cost, token,
and time budgets, but do not consume an agent-turn reservation. Unknown usage stays unknown.
The adapter must reconcile these reservations with its opening admission without charging aggregate
operation usage again. Check budget availability before each call and settle its reported usage.

## Attendance, cancellation, and recovery

Goals inherit the run's attendance and tool ceiling. Gated execution remains supervised and can
wait for a person. Autonomous execution cancels questions and denies permission requests; a required
decision ends the step as blocked. Goal text, verdicts, and continuation prompts cannot widen authority.

Cancelling the run aborts an in-flight judge, closes note admission, and cancels the operation's turns.
After every awaited read, model call, or admission hook, check cancellation before saving a verdict
or accepting another turn. Late callbacks cannot finish a cancelled step or replace a retry's state.

Persist goal state per step attempt and managed operation, keyed by the opening turn. Store the
objective, counters, evaluated turns, verdict, timestamps, and terminal reason. Repeated callbacks
reuse saved verdicts and idempotent continuation keys. Keep attempts separate when retry reuses a
session. A retry keeps the frozen goal; changing its prompt does not silently change that condition.

Preserve workflow restart and unknown-outcome recovery rules. Startup must not restart goal work
independently of the workflow runner. Retain interrupted checks for inspection, cancel abandoned
notes, and admit a fresh attempt only through the runner's authorized recovery or retry path.

## Run inspection

The step inspector shows the resolved completion condition, status, continuation count, last check
reason, and evidence summary. Show **Checking completion** and **Continuing toward goal** as progress
states. Link to the agent session and identify automatic turns as goal continuation or result repair.
Keep this host metadata separate from the step's structured output and downstream bindings.

Workflow controls own Stop and Retry. A workflow session displays its goal as read-only operation
state; it has no interactive **Edit**, **Clear**, or **Resume** controls. The failure view retains the
goal and verdict so the person retrying can understand the unfinished condition.

## Ownership and implementation boundaries

The workflows plugin owns configuration, bindings, frozen inputs, run controls, budget reservations,
and step outcome projection. Extend its authoring field descriptions, serializer, validators, map
agent conversion, and read model together.

The agents plugin owns evidence, model evaluation, operation persistence, turn admission, and the
continuation loop. Extend the agents-owned `agents.sessionExecute` request and result with typed
goal configuration and summary. Workflows consumes that public contract and maps the summary into
step inspection metadata. Keep generic core result contracts and workflow output schemas independent.
Use focused feature-owned modules and explicit ports; keep activation files as composition.

## Acceptance and verification

Implementation must demonstrate these behaviors:

- Editor, TOML, JSON, publication, and frozen-run round trips preserve the goal; absent goals preserve
  ordinary execution. Invalid goals and unsupported harnesses fail before an agent turn starts.
- A valid first result with unfinished work keeps downstream steps waiting, continues in the same
  session, and publishes once after satisfaction. Structured result repair also passes the final check.
- A For each map gives every item isolated goal state and includes it in the parent's result summary,
  while preserving configured worktree sharing, concurrency, and item failure policy.
- Concurrent notes invalidate an earlier check; review runs once; late verdicts and cancellation
  during reads or admission cannot queue work or finish a cancelled or retried attempt.
- Continuation, no-progress, turn, cost, token, and deadline limits stop execution with the right reason.
  Judge and agent usage are charged once. An autonomous blocker receives no further continuation.
- Restart and explicit retry retain inspection evidence, separate attempts, and admit no duplicate
  work or unknown external side effect. Desktop and TUI show the same goal state and terminal reason.

Run focused evaluator, managed execution, workflow adapter, parser, budget, map, and renderer tests.
Inspect one successful continuation and one blocked run in the real desktop and TUI. Verify a live
managed harness receives the goal and continuation prompt. Run the full test and lint gates at handoff.
Update [agent steps](../workflows/agent-steps.md), [workflow execution](../workflows/execution.md),
[turn operations](../managed-agents/operations.md), and the capability and authoring references when shipped.

## Verify before building

Trace `plugins/agents/src/server/sessions/sessionExecute.ts`, `sessionGoal.ts`, and `turnFollowUps.ts`.
Confirm workflow admission and accounting in `plugins/workflows/src/server/steps/execution.ts` and
`plugins/workflows/src/server/validation/treeSafety.ts`, plus `workflow-map` child-run construction.
The owning references above take precedence over these October 8, 2026 path hints.
