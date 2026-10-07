# Phase 05: unattended follow-ups

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phase 04 accepted
with its advisor consumer. Next: [phase 06](./06-portable-skills.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-05-unattended-follow-ups`, at the commit titled "Phase 05:
Unattended follow-ups". [Unattended follow-ups](../../managed-agents/unattended-follow-ups.md) is
the owning contract.

- **The point.** `agents:turn-follow-up`, declared in `plugins/agents/src/contract/turnFollowUp.ts`.
  A contribution is `{ review(window) }`. The window is `{ taskId, sessionId, turnId, owner, deadline,
  signal }`, with `owner` either `workflow` or `delegation`. `TURN_FOLLOW_UP_DEADLINE_MS` is 30,000.
  It's a disclosed node point, with the fixed high line "Review your workflow and delegated agents'
  finished turns before they report, which can hold their results and add turns on your agent
  provider".
- **Operations.** `server/sessions/turnFollowUps.ts`, `TurnFollowUps`, loaded on first use. An
  operation is keyed by the owner's turn id and lives in memory. A workflow step opens its own in
  `sessionExecute`. A delegated turn's opens on its first note or its report, while
  `DelegationReports#operationLive` holds: `reportTo` set, no report queued, no `delegation.cancel`
  for the turn, and an owner neither archived nor failed. A note about a note or a continuation joins
  the turn it follows, through `followUpOf` or `continuationOf`.
- **Messenger.** `SessionMessage.originTurnId`, required on workflow and delegated sessions and
  ignored on interactive ones. `unattended-not-supported` became `operation-closed`. Admission runs
  inside the per-session chain from phase 03, and `TurnFollowUps#admit` checks `open` in the same tick
  it records the admission, so closing either refuses a note or waits for it. The note's turn has
  `followUpOf` and inherits `model`, `effort`, `configOptions`, `workflowRunId`, `workflowStepId`,
  `schema`, and `resultSchema`. It never inherits `reportTo`. With a result schema, the visible text
  asks for the `json` block again.
- **Review window.** One per operation, after the owner's turns finish, and only on a `completed`
  turn. Reviewers are snapshotted, the window closes at the earlier of every callback settling or the
  deadline, the signal is aborted, and the participants' later notes are refused. The outcome is an
  `agent_operations` row, `turn-follow-up:<turn id>`, command `turn-follow-up.review`.
- **Owners.** `sessionExecute` tracks every owned turn, cancels them all newest first on abort or
  timeout, and returns only after the operation is closed and its turns settle. Its result comes from
  the last turn by queue order. `DelegationReports` reviews, waits for the notes, closes, and queues
  one report from the last turn's message, and dedupes concurrent deliveries. An owner's
  `agent_cancel` on a note cancels the whole operation and is saved against the delegated turn.
- **Usage.** `HeadlessResult.capture` sums every owned turn's usage and USD cost, except Codex, whose
  last cumulative report is used. Unreported values stay undefined. No contract type changed for
  this. The workflow's safety rail sees the total when the step settles.
- **Restart.** `AgentStore#cancelWorkflowFollowUps` runs in `reconcile()` before the pump, because a
  workflow step's operation doesn't survive the process and the step reruns as a new turn. The
  delegated startup pass no longer blocks boot: it fires `deliver` for live operations only.
- **Consumers.** Advisor 0.2.0 joins the point, runs a window's review at once rather than through
  its queue, sends a concern even after a finished answer, names `originTurnId`, and has the modes
  `off`, `unattended`, and `all`. A stored `interactive` from 0.1.0 keeps meaning interactive only.
  Permission policy 0.3.0 names the request's turn as `originTurnId` and logs a refused note.

No migration: the follow-up and review state live in existing JSON and operation rows. The wire
change is additive apart from the renamed refusal, which only loaded plugins read.

**Decisions and deviations.**

- **The operation is in memory for workflows and derived for delegation.** A workflow step's owner is
  the running `sessionExecute` call, so a restart rightly ends it. A delegated owner is durable, so its
  liveness is read from the turn and session rows on every note. No new table.
- **Admission stays open while notes run.** A denial explanation during a correction still joins the
  operation. Only reviewers whose window closed are refused early. The per-plugin cap of 20 still
  bounds the rest.
- **A follow-up's malformed reply uses the step's existing continuations**, up to two, rather than a
  new rule.
- **The workflow budget isn't checked before a note is admitted.** Agents doesn't know the workflow's
  budget. A correction can push a step over, and the safety rail then fails the step visibly. An
  exhausted model grant refuses the reviewer's call, the review records `failed`, and the step
  finishes.
- **A delegated turn with a terminal owner takes no notes.** It has no report to hold.
- **The 30-second window can consume a short step's remaining timeout.** It's capped at what's left,
  so a step with less than 30 seconds left can time out while reviewing.
- **`agents.sessionExecute` loads on the first step.** That cut 14 KB from the boot graph, which paid
  for this phase. The service measures 3,126,635 B, and the ceiling dropped from 3,131,500 B to
  3,127,500 B to keep the cut.

**Verification.**

- `pnpm lint` passes. `@acorn/arch-tests`: 86 passed, after splitting
  [unattended follow-ups](../../managed-agents/unattended-follow-ups.md) from session messages for
  the 200-line rule. `apps/node` `pnpm build` passes the budget.
- `turnFollowUps.test.ts`, 9 cases at the agents and workflows boundary with a scripted driver, a
  deterministic reviewer, and the real messenger: a blocker's correction runs before publication and
  its structured output and summed usage are published; a note queued during the running turn stays
  in the step and notes without a live operation are refused; a review timeout is recorded and the
  late note refused; a failing reviewer doesn't stop the step; cancellation racing admission leaves
  no unsettled turn; Codex usage isn't summed; a second review of an operation does nothing and the
  restart sweep cancels a queued workflow note; a delegated turn reports once after the correction,
  under concurrent delivery; and an owner's cancel of a note sends no report and cancels it.
- `sessionMessages.test.ts`: workflow and delegated sessions with no operation answer
  `operation-closed`. `service.test.ts` waits for the startup report it no longer blocks on.
- `reload.test.ts` under Node 26.8.1 hands a loaded worker's reviewer a window and aborts it later:
  the fields, a host function, and the abort all cross.
- Advisor `node --test`: 12 passed, adding the window review, the mode split, and the deadline.
  Permission policy: 11 passed, adding `originTurnId` and the logged refusal.
- `@acorn/plugin-agents`: 1,141 passed. `@acorn/protocol`: 294. `@acorn/plugin-workflows`: 568.
- `pnpm test` under Node 26.8.1: 33 of 36 packages passed. `@acorn/node-core`: 1,597 passed, and the
  3 failures are `storage/backup.test.ts`, whose 12 tests pass on Node 24.11. `@acorn/client-core`:
  2,453 passed, with the known `scopes.test.ts` and `cssHygiene` box-shadow failures, and
  `DiffPane.test.tsx`'s colour-timeout case, which passes alone (12 of 12). `@acorn/node`: 273 passed,
  with 2 `EnvironmentTeardownError`s from `runtime.test.ts` under load. Its suite passes alone with no
  errors. `@acorn/tui`: 676. `@acorn/desktop` passed.

Real host, `pnpm dev:agent -- --session pi-phase-05`, Claude Code through ACP, Opus 5.5:

- The trust prompt for advisor 0.2.0 listed the new fixed line beside the messenger's
  (`screenshot-1791335933386.png`).
- With the advisor on **Unattended sessions** and a Claude Code Haiku grant, a one-step workflow over a
  seeded `a - b` ran three times. Each time the window closed at 30 seconds with `timed-out`, the job
  was `cancelled`, the harness log said `claude-code cancelled in 29,97x ms`, no note was sent, and
  the run finished `done` with the step's own result. The call stayed charged at 4,000.
- A model-free fixture reviewer, installed from a folder outside the repository, queued one blocker in
  its window. The transcript shows the step's turn, then **From p05-fixed-reviewer**, then the agent's
  reply, and the run reported only after it. The step's structured output is the reply's, which
  quotes the note. The step cost $0.37, which is $0.165 for the step's turn plus $0.202 for the reply
  (`screenshot-1791335969130.png`). The agent declined to edit `add`, because the prompt said not to.
- Cancelling another run while the advisor was generating aborted the CLI call at 5.2 seconds, saved
  the review as `cancelled`, cancelled the job, and sent no note.
- Screenshots are in the session's ignored `.acorn/agent-dev/pi-phase-05/screenshots/`.

**Limitations.**

- **No real-host correction by the advisor itself.** On this machine, its Claude Code generate in the
  Node ran past 30 seconds on 3 of 3 runs. The same argv with the diff takes 5 to 6 seconds from a
  shell, and phase 04's whole interactive review took 15.6 seconds. The cause wasn't found. Phase 11
  should run the advisor on a connection backend, which this machine has no key for, or find what
  slows the CLI in the Node.
- **No real-host delegated run.** The test app's managed Claude session didn't list `agent_spawn`
  from the acorn MCP server, and the first attempt used Claude's own subagent instead. The delegated
  path is covered at the contract boundary in `turnFollowUps.test.ts`.
- **No terminal-client or disconnected-client run.** The runs were driven through `nodeFetch`, and the
  terminal fixture runs its own Node without the advisor. Notes draw through the same
  `AgentEventCard` as phase 03's.
- **Codex wasn't run.** Its account is at its usage limit until 2026-10-10. Cumulative usage is
  covered by a test.
- **Restart recovery wasn't run on the real host.** It's covered by tests.

**For phase 06 and phase 11.** Advisor 0.2.0 and permission policy 0.3.0 are the consumer revisions at
this commit. Phase 11 owes the advisor's own real-host correction, a delegated run, a terminal and a
disconnected-client run, and checks 159 to 162 in [workflow checks](../../testing/workflows.md).

## Outcome

Workflow and delegated operations can receive policy explanations and advisor notes while retaining
control of lifetime, completion, cancellation, and accounting. Enable the advisor's unattended mode
only after this phase passes. Sources: the unattended claims in
[session messages](./03-session-messages.md), [advisor](./04-model-grants-and-advisor.md), and
[workflow execution](../../workflows/execution.md).

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
status, and parent reports. Run with clients disconnected to prove Node ownership. Run the advisor
on one workflow and one interactive session for a day and read its recorded notes, to judge
whether it is worth its cost. Do not mark this phase accepted if notes merely run after a workflow
has already reported success.

## Documentation and handoff

Update [managed agents](../../managed-agents.md),
[workflow execution](../../workflows/execution.md), [security](../../security.md),
[node extension points](../../plugins/node-side-extension-points.md), and
[workflow acceptance](../../testing/workflows.md). Record the completion point's shipped name,
deadline, operation correlation, usage semantics, and cancellation ownership. Give phase 11 the
real unattended-run evidence and exact consumer revisions.

## Verify before building

Check phase 04's runtime and worker callbacks, workflow result publication, delegation report
timing, model-call cancellation, and budget data types. Confirm the 30-second window fits inside
owner deadlines and does not create a provider-pump deadlock.
