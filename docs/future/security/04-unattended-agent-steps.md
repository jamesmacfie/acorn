# Phase 4: no unguarded agent step behind a record trigger

## Completion note

Done October 21, 2026, on branch `phase-4-unattended-agent-steps`.

**The check.** I settled it by reading the code and proving it with tests, not with a live
`pnpm dev:agent` run, because the service budget is red and a real Claude Code or Codex in each mode
needs accounts. A workflow session doesn't take the owner's session defaults: `initializeCreatedSession`
in `plugins/agents/src/server/sessions/runtime.ts` applies the saved and last-used values to interactive
sessions only. So two things decide a trigger-started step's mode. The step's `config_options` come first
(`applyRequestedConfig`). Without them, the harness starts in its own default: Claude Code's
`permissions.defaultMode` in the account's settings, or Codex's active permission profile. A test in
`sessionExecute.test.ts` shows a saved `bypassPermissions` default doesn't reach a workflow session. The
risk is real, so the rest of the phase went ahead.

What landed:

- The mode table moved to `plugins/agents/src/shared/unguardedCommands.ts`, with a new `unguardedSetting`
  that also returns the matching value. The composer imports `unguardedCommandsWarning` from there, and
  its test moved with it unchanged.
- `agents.sessionExecute` takes `allowUnguardedAgents`. For an autonomous step without it, it reads the
  session's options after the requested ones are applied and before the first turn is queued. In a listed
  mode it throws `UnguardedAgentError` (in the contract file), carrying the mode.
- The workflows runner passes `allowUnguardedAgents` from `allowsUnguardedAgents` in
  `triggers/occurrences.ts`. A run whose root occurrence has kind `record` is allowed only when the
  frozen occurrence payload says so. Every other run is allowed, so clock triggers, **Run now**, manual
  runs, and agent launches behave as before. `runHeadless` turns the error into a
  `WorkflowAuthorityError` with the new reason `unguarded-agent`. The step fails with the run's new error
  cause `unguarded-agent`, and when the run settles, `settled` in `triggers/service.ts` moves the trigger
  to **Needs review** with that reason. The message names the step (the run adds it) and the mode.
- `allowUnguardedAgents` lives in the trigger's limits (`WorkflowTriggerLimits`), so it rides the
  existing draft, approval, and frozen-payload path with no migration. Saving a draft puts an approved
  trigger back in **Needs review**, so changing it needs approval again.
- The approval sheet shows **Let agent steps run commands without asking**, with the spec's text, for a
  record trigger whose workflow has an agent step. `prepare` returns `recordAgents`, with
  `from: "issues in acme/billing-api"` when the source declares a `reach`. Only GitHub's sources do.

Decisions and deviations:

- The refusal can't happen at the start, because the mode is only known once a session exists. So the
  trigger moves to review when the failed run settles, using the run's error cause, which is how
  `checkpoint-expired` already works. Records already started in the same check can each fail once
  before the trigger moves.
- If the refused step is inside a child workflow, the cause is on the child's run and doesn't reach the
  root, so the run fails but the trigger doesn't move. Child runs don't pass `errorCause` up today.
- The "agent step" test on the sheet uses built-in step kinds only (`BUILTIN_AGENT_STEP_KINDS`). A
  contributed agent kind gets no warning on the sheet, but the agents plugin still refuses it.
- The line about who writes records says "Anyone who can create a record there", not "open an issue",
  because it has to read right for every source. Sources without a `reach` leave the first line out,
  and the checkbox still shows.
- Headless profiles never reach the check. Claude's headless argv uses `--permission-mode auto`.

What later phases need to know:

- The Node service graph grew by 1,241 bytes, from 1,932,913 to 1,934,154. The ceiling is still
  1,931,900, so `pnpm --filter @acorn/node build` stays red by 2,254 bytes until the coordinator raises
  it.
- `@acorn/arch-tests` `sourceFields.test.ts` fails on this branch for `createdByTask`, which phase 3 added
  to core's Tasks source without regenerating the SDK field lists. It isn't from this phase. Rerun it with
  `UPDATE_SOURCE_FIELDS=1` once.
- Phase 6 can list the tests: `sessionExecute.test.ts` (refusal, supervised, allowed, saved defaults),
  `unguardedAgents.test.ts` (record vs clock, settle, sheet), `workflowAgentSession.test.ts` (runner
  mapping), and `TriggerDialog.test.tsx` (the box).
- Not checked live. The acceptance in `pnpm dev:agent` (a record trigger stops at **Needs review**, and
  approving with the box ticked lets it run) is covered by those tests, not by a real harness.

Date: October 21, 2026. Status: done. Severity: medium. Starts with a check that may shrink it.

A record trigger starts a workflow for records that other people write: a GitHub issue, a Linear
issue, a Rollbar error, a new pull request. Those fields reach the workflow's agent steps as inputs.
Unattended runs reject every permission prompt, which is right, but a harness running with its
checks off never asks. Then whoever can open an issue on a watched repository can try to steer an
agent with a shell. Read [the programme](./README.md) first.

## Starting point

Read at `32b2ab6c3`.

- [Workflow execution](../../workflows/execution.md) says the runner passes its `posture` to the
  agents plugin, and that under autonomous attendance "a permission is rejected once, with a recorded
  reason and no attention row. The Node does not approve permissions."
- `unguardedCommands.ts`, then in `plugins/agents/src/client/composer/`, names the modes in which a harness runs
  commands with no sandbox and no approval: Claude Code's `bypassPermissions`, and Codex's
  `:danger-full-access` and `danger-full-access`. It says "Acorn does not turn on Claude Code's own
  sandbox", so in `bypassPermissions` nothing stands between a command and the account.
- The composer warns about those modes in a conversation. Nothing warns when a trigger is approved.
- [Agent steps](../../workflows/agent-steps.md#what-an-agent-step-sees) delivers upstream output and the
  task context as `<acorn-context>` blocks, which marks them as information. That helps a model ignore
  injected text, but it isn't an enforcement.
- [Triggers](../../workflows/triggers.md#review-and-refusals) already has refusals only the owner can
  fix, through `WorkflowAuthorityError`, which move a trigger to **Needs review**.
- Not checked in the review: which mode a trigger-started agent step actually gets. It could come
  from the step's `config_options`, the profile, or the owner's session defaults.

## Changes

### Check first

Start a record-triggered workflow with one agent step in `pnpm dev:agent`, with the owner's Claude
Code default set to each mode in turn, and read the session's reported mode from its config options.
Do the same for Codex. Write down which setting decides the mode.

If no setting can give a trigger-started step an unguarded mode, stop here. Add one sentence to
[triggers](../../workflows/triggers.md) saying so, with the test below that holds it, and skip the
rest of this phase.

### Refuse an unguarded step unless the owner chose it

1. Move the mode table out of `unguardedCommands.ts` into `plugins/agents/src/shared/`, so the server
   and the composer read one list.
2. When the agents plugin accepts a turn under autonomous attendance, resolve the session's mode
   before the harness starts. If the mode is on that list, refuse the turn with the reason
   `unguarded-agent`, unless the run's trigger was approved with `allowUnguardedAgents`. The agents
   plugin doesn't know about triggers, so the workflow runner passes that flag with the posture, and
   maps the refusal to a `WorkflowAuthorityError`. The trigger moves to **Needs review**, and the
   refusal names the step and the mode.
3. Add `allowUnguardedAgents` to the trigger's approval, off by default, with the text: "This
   trigger's agent steps run commands without asking. Anyone who can create a matching record can
   write text those agents read." Approval freezes it with the rest of the graph, so a later edit to
   the workflow needs approval again.

Clock triggers and **Run now** start from the owner's own schedule with no outside records, so leave
them alone. Apply the refusal only to occurrences of kind `record`.

### Say who can reach the trigger

On the approval sheet of a record trigger whose workflow has an agent step, add one line naming who
writes the records, from the source's description: "Records come from GitHub issues in
`acme/billing-api`. Anyone who can open an issue there can write text your agent steps read." A
source that can't say leaves the line out.

## Tests

- An agents plugin test: an autonomous turn in `bypassPermissions` is refused with `unguarded-agent`,
  and a supervised one isn't. With `allowUnguardedAgents`, the autonomous turn runs.
- A triggers test: a record occurrence that hits the refusal moves the trigger to **Needs review**,
  and a clock occurrence doesn't hit it.
- The composer's warning test still passes against the shared table.

## Acceptance

- In `pnpm dev:agent`, a record trigger whose agent step would run in `bypassPermissions` stops at
  **Needs review** with the step and mode named. Approving it with the box ticked lets it run.
- [Triggers](../../workflows/triggers.md) and [refusals](../../workflows/refusals.md#unattended-starts)
  list `unguarded-agent`.
