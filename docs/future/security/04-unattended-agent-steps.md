# Phase 4: no unguarded agent step behind a record trigger

Date: October 21, 2026. Status: proposed. Severity: medium. Starts with a check that may shrink it.

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
- `plugins/agents/src/client/composer/unguardedCommands.ts` names the modes in which a harness runs
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
