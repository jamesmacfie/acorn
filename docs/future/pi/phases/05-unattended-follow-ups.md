# Phase 05: unattended follow-ups

Status: proposed, 2026-10-03. Entry: phase 04 accepted with its advisor consumer. Next:
[phase 06](./06-portable-skills.md).

## Outcome

Workflow and delegated operations can receive policy explanations and advisor notes while retaining
control of lifetime, completion, cancellation, and accounting. Enable the advisor's unattended mode
only after this phase passes. Sources: the unattended claims in
[session messages](../03-session-messages.md), [advisor](../05-advisor.md), and
[workflow execution](../../../workflows/execution.md).

## Why this is its own phase

`plugins/agents/src/server/sessions/sessionExecute.ts` collects results for the turn IDs it enqueues.
An asynchronous completed-turn subscriber cannot be assumed to delay step success or include a
later plugin turn in the result. Acorn control of the session is distinct from an active workflow or
delegation owning the work. A late review must not start work after that owner has finished.

## Ownership and data flow

Workflow/delegation owner → agents operation association → original turn completion → bounded
follow-up review window → attributed plugin turn → operation accounting and result → owner completion.
Cancellation travels from the owner to pending review work, plugin messages, generation, and provider
execution. Each operation stays on its task and retains its tool ceiling.

Read managed session execution/control, delegation jobs and reports, workflow runner budgets and
recovery, durable turn policy, cancellation, and phase 04's advisor. Follow public contracts between
agents and workflows. Neither plugin may query the other's storage or import private runtime code.

## Implementation

1. Associate an unattended session's allowed follow-up work with its owning operation, including
   workflow run/step or delegated job, task, originating turn, and cancellation generation. Persist
   correlation needed for recovery; treat an absent or terminal owner as unavailable. Do not infer
   a live operation from session kind, title, or `controller: 'acorn'`.
2. Extend messenger admission with a coarse `operation-closed` refusal and an origin-turn field for
   unattended messages. The host verifies the association, inherits policy/tool ceilings, and
   records the accepted follow-up in the operation. A grant to send a note cannot widen tools,
   reopen a settled run, or select a different operation from another task.
3. Add an owner-declared, host-bound `agents:turn-follow-up` point for opted-in completion reviewers.
   Its typed contract belongs to agents. A contributor receives the completed turn address and an
   abortable review window, not the raw transcript. Snapshot accepted participants for the window;
   the owner waits for their bounded callbacks before finalizing the unattended operation. This is
   lifecycle participation, distinct from an observational completed-turn event.
4. Use a 30-second shared review deadline, inside the operation's remaining timeout. A callback may
   read phase 04's bounded input, generate, and queue one note using the messenger. Close admission
   before releasing the owner on timeout, cancellation, archive, or reviewer disposal. Reject late
   callbacks and record that review was skipped or timed out. A missing/failed reviewer does not
   turn ordinary workflow execution into a permanent wait or an automatic refusal.
5. Await accepted follow-up turns before final result publication. Do not hold the provider event
   queue or pump while waiting for reviewers or their turns. Track original and plugin turns through
   one operation; reconcile final structured output after a correcting follow-up rather than
   publishing the superseded original output. Skip reviewer participation for plugin-origin turns
   to avoid recursive reviews. Keep the messenger's per-plugin session cap as an additional limit.
6. Extend the workflow/delegation contracts to account for all operation-owned turns and generation
   where their budgets can represent it. Preserve provider-specific usage semantics; Codex totals
   may be cumulative, so summing every turn's totals can double-count. Unknown usage stays unknown.
   A provider-budget exhaustion rejects extra work and reports a visible outcome. Advisor model
   calls remain separately charged to phase 04's grant; do not invent dollar prices or hide them in
   agent usage. Document both spending paths and their limits.
7. Recover an interrupted operation without duplicate review generation or plugin turns. Reuse
   durable review/message keys. Cancel all its queued/running follow-ups when the owner stops. A
   completion report to a delegated parent fires after the accepted corrective work, once, and
   no late advisor result wakes the parent after completion.
8. Adapt the advisor to use the bounded point for unattended completion; keep lifecycle events for
   interactive review. Add fixed high-grant disclosure for participation and its possible extra
   turns. Enable the off/unattended/all settings choices. Extend the policy consumer to explain
   denials within an active operation; explanations may queue during a running turn but must be
   included before operation finalization. Keep unsupported/closed cases as recorded refusals.

This point does not turn the advisor into an approval gate. It does not interrupt an in-flight
provider turn, hold arbitrary context for a future user prompt, or allow unbounded reviewer chains.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Test at the agents/workflows
contract boundary with a deterministic reviewer and fake driver:

- A blocker arriving at original completion runs its correction before result publication.
- A denial explanation queued during the original turn stays within the owning operation.
- A review timeout finishes with a recorded limitation; a late callback cannot enqueue.
- Concurrent original completion, cancellation, and queue admission cannot create orphan work.
- Budget exhaustion, cumulative usage, structured-result correction, restart, and duplicate events
  preserve one operation outcome and one delegation report.
- Plugin-origin turns do not trigger another automatic review window.

Run a real workflow and delegated job with seeded bad changes and an enabled loaded advisor. Cancel
another run during generation. On desktop and terminal, inspect correction turns, usage, owner
status, and parent reports. Run with clients disconnected to prove Node ownership. Do not mark this
phase accepted if notes merely run after a workflow has already reported success.

## Documentation and handoff

Update [managed agents](../../../managed-agents.md),
[workflow execution](../../../workflows/execution.md), [security](../../../security.md),
[node extension points](../../../plugins/node-side-extension-points.md), and
[workflow acceptance](../../../testing/workflows.md). Record the completion point's shipped name,
deadline, operation correlation, usage semantics, and cancellation ownership. Give phase 11 the
real unattended-run evidence and exact consumer revisions.

## Verify before building

Check phase 04's runtime and worker callbacks, workflow result publication, delegation report
timing, model-call cancellation, and budget data types. Confirm the 30-second window fits inside
owner deadlines and does not create a provider-pump deadlock.
