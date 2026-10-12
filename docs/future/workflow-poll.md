# Polling policy gates

Date: October 12, 2026. Status: proposed; implementation not started.

This plan lets a workflow wait for something outside Acorn, such as CI on the task's pull request or a
reviewer's comments, and then carry on. [Workflow execution](../workflows/execution.md) and
[contributed step kinds](../workflows/step-kinds.md) own the behavior this changes.

## Summary

A `gate-policy` step asks a policy once and passes or fails. This plan makes a policy answer one of
three verdicts, `pass`, `wait`, or `fail`, and makes `gate-policy` ask again on an interval while
the answer is `wait`, until a timeout. Four policies ship with it: CI settled, review received, a
command's exit code, and an agent's verdict. `ci-loop` is rebuilt on the CI policy, which fixes how it
reads checks today.

A workflow such as "create a PR, wait for review, address the comments, fix CI" becomes four steps:
an agent, a polling gate, an agent, and `ci-loop`.

## The problem

Two steps look at CI, and neither waits:

- `gate-policy` with `checks-green` reads the checks once and passes or fails
  (`runPolicy` in `plugins/workflows/src/server/steps/builtins.ts`).
- `ci-loop` reads the checks, runs a fix turn when any fail, and reads again as soon as the turn ends.

Both read through `failingChecks` on the `github.mirror` capability
(`plugins/github/src/contract/mirror.ts`). That function reads the GitHub plugin's local copy of the
PR, which refreshes only when a client opens or lists the PR. In a run nobody is watching, the copy
can predate the agent's push.

`checkFailed` (`plugins/github/src/server/mirrorQueries.ts`) passes only `success`, `neutral`, and
`skipped`. The mirror stores a check run's status as `conclusion ?? status`
(`plugins/github/src/server/routes/mirror/prMirror.ts`), so a check that is still running is stored
as `IN_PROGRESS` or `QUEUED` and counts as failed. Right after a push, `ci-loop` asks the agent to fix
checks that haven't finished, and spends its rounds doing it.

Nothing waits for a review. The only pause is `gate-human`, which waits for a person to press
**Approve**.

## How a check answers

A check answers one of three verdicts:

| Verdict | Meaning | The gate |
| --- | --- | --- |
| `pass` | The condition holds. | Finishes. |
| `wait` | Not yet. | Sleeps for the interval and asks again. |
| `fail` | The condition won't hold, such as a red CI run. | Finishes, or fails the step. |

A true or false answer isn't enough, because it can't tell "not yet" from "never". With only two
answers, a failed CI run reads the same as a running one, and the gate waits for the timeout.

The gate adds a fourth result, `timed-out`, when the timeout passes on a `wait`. A workflow can treat
"CI failed" and "CI never finished" differently.

## The policy contract

`PolicyEvaluator` is `(taskId) => Promise<{ pass, detail? }>` today
(`plugins/workflows/src/shared/workflowContracts.ts`). It becomes a contribution with the same shape
as a step kind, so the editor draws a policy's settings the way it draws a kind's fields:

```ts
type PolicyContribution = {
  evaluate(ctx: PolicyContext): Promise<PolicyVerdict>
  describe: PolicyDescription
  validate?: (settings: Record<string, unknown>) => string[]
}

type PolicyContext = {
  taskId: string
  with: Record<string, unknown> // the gate's rendered `[steps.with]`
  since: number // when the wait started, kept across restarts
  previous?: PolicyVerdict // the last answer, or nothing on the first poll
  signal: AbortSignal
}

type PolicyVerdict = { verdict: 'pass' | 'wait' | 'fail'; detail?: string; value?: unknown }
```

`describe` takes the step kind's `label`, `description`, `icon`, and `fields`
(`StepKindDescription` in the same file), plus `minIntervalMs`. Validation refuses a gate whose
interval is below the policy's minimum. `detail` is one line for the run pane. `value` is structured
data a later step can bind to, such as the names of failing checks.

The extension point keeps its id, `workflows:policy` (`plugins/workflows/src/contract/extensions.ts`).
Only `checks-green` fills it today, and no plugin outside this repository contributes to it. A
plugin that can't import the workflows package keeps a copy of the type, as the terminal plugin does
for step kinds (`plugins/terminal/src/contract/workflowSteps.ts`).

## Gate fields

`gate-policy` gains four optional fields beside `policy`:

| Field | TOML key | What it does |
| --- | --- | --- |
| Settings | `[steps.with]` | Passed to the policy, rendered one level deep like a contributed kind's `with`. |
| Interval | `interval_ms` | How long to sleep after a `wait`. Defaults to 60,000. The floor is 30,000 or the policy's minimum, whichever is higher. |
| Timeout | `timeout_ms` | How long to keep asking. Required when `interval_ms` is set. |
| Branches | `branches` | A table from `pass`, `fail`, and `timed-out` to step IDs, as `decide` and `if` use. |

The keys use milliseconds because `max_wall_time_ms` and `terminal:command`'s `timeoutMs` do.

A gate without `interval_ms` asks once and treats `wait` as `fail`, so every workflow that uses
`gate-policy` today behaves as it does. A gate without `branches` fails the step on `fail` or
`timed-out`, as today. With `branches`, the gate finishes `done` and the runner skips the branches it
didn't take. The validator follows the `decide` rule in
`plugins/workflows/src/server/definitions/builtinDefinitions.ts`: each target must wait on the gate.

The gate's structured output is `{ verdict, detail, value, polls }`, where `verdict` includes
`timed-out`.

Under an autonomous posture, `gate-human` passes straight through because nobody is there to ask. A
polling gate still polls, because it isn't asking a person.

This is the workflow from the summary:

```toml
[[steps]]
id = "open-pr"
name = "Open the pull request"
prompt = "Commit the work, push the branch, and open a pull request."

[[steps]]
id = "await-review"
name = "Wait for review"
kind = "gate-policy"
policy = "github:review-received"
interval_ms = 120000
timeout_ms = 86400000

[steps.branches]
pass = "address-review"
timed-out = "nudge"

[[steps]]
id = "address-review"
name = "Address the review"
after = ["await-review"]
prompt = "Use the gh-address-comments skill to address the open review comments, then push."

[[steps]]
id = "nudge"
name = "Ask for a reviewer"
kind = "gate-human"
after = ["await-review"]

[[steps]]
id = "fix-ci"
name = "Fix the checks"
kind = "ci-loop"
after = ["address-review"]
```

## The four policies

### CI settled

`github:ci-settled` belongs to the GitHub plugin, which owns the data. Each poll:

1. Refreshes the task's PR from GitHub through `refreshPullDetail`
   (`plugins/github/src/server/routes/pulls/pullRefresh.ts`), the refresh the PR pane already uses.
2. Reads the checks for the PR's head commit from the refreshed mirror.
3. Answers `wait` while any check is queued or running. It answers `fail` when any check failed, with
   the failing names in `value` and `detail`. It answers `pass` when every check passed, was skipped,
   or was neutral.

It answers `fail` when the task has no PR or the PR has no checks, as `ci-loop` does today. A
setting, `missing = "wait"`, waits instead, for a repository whose checks take a minute to appear
after a push.

### Review received

`github:review-received` also belongs to the GitHub plugin. It refreshes the PR the same way, then
reads the reviews, inline threads, and conversation comments that `taskReviewFeedback`
(`plugins/github/src/server/mirrorQueries.ts`) already assembles for the `pr_review_comments` tool.

It answers `pass` when one of them was submitted after `since` by someone who isn't the PR's author
or a bot. `include_bots = true` counts bots. It answers `wait` otherwise. It answers `fail` when the
PR is closed or merged. `value` holds the matching reviews and comments, so the next agent step can
bind to them instead of asking GitHub again.

An approval with no comments still passes. The next step decides what an approval means.

### Command exit code

`terminal:command-check` belongs to the terminal plugin, beside `terminal:command`
(`plugins/terminal/src/server/workflowSteps.ts`). It runs one command in the task's checkout through
`core.proc.runProcess`, with the same environment allowlist, `env` lines, and per-attempt `timeoutMs`
limit of 600,000. It maps exit codes like this:

| Exit code | Verdict |
| --- | --- |
| 0 | `pass` |
| 75 | `wait` |
| Anything else | `fail` |

75 is `EX_TEMPFAIL` from `sysexits.h`, the Unix code for "temporary failure, try again later".
`detail` is the last line of standard output. `value` is `{ exitCode, stdout, stderr, truncated }`,
the same output `terminal:command` gives.

A committed workflow that uses it passes the same repository trust check at admission as any other
committed workflow, so it needs no gate of its own.

### Agent verdict

`agent` is built into the workflows plugin, because it needs `runHeadless`. Each poll is a fresh
one-shot turn, as `decide` runs (`runDecision` in `plugins/workflows/src/server/steps/builtins.ts`),
with three differences:

- It gets read-only tools, such as file reads, `pr_review_comments`, and `gh`, because an agent with
  no tools sees the same prompt each poll and can't notice a change.
- It gets the last poll's `detail` as a context item, so it can say what changed.
- Its schema is fixed: `{ verdict: 'pass' | 'wait' | 'fail', reason: string }`.

Prose can't end a wait. A reply without a valid verdict fails the step, as `decide` does.

Its minimum interval is 300,000 ms. Each poll takes an agent slot from the Node's four-slot limit and
adds its cost to the run's budget, so `max_cost_usd` stops a wait that costs too much. A cheaper check
followed by a `decide` step covers most cases. Use this one when nothing else can see the condition.

## Restarts, budgets, and cancellation

A Node restart sets a running step back to `pending`, and its handler runs again from the start
(`reconcile` in `plugins/workflows/src/server/runs/runner.ts`). On its first poll, the gate saves
`since` and `deadlineAt` into the step's `inputs_json` through `setStep`, as `ci-loop` saves its
`iteration`. A rerun reads them back, so `since` stays put and the deadline doesn't reset.

The runner's step timer lives in memory and restarts at the full budget after a restart. Validation
refuses a gate whose `timeout_ms` is longer than the step or run `max_wall_time_ms`, so the gate's own
timeout always fires first and reports `timed-out` instead of a safety rail.

The sleep between polls stops on `ctx.signal`, so cancelling the run stops the wait at once. Each
poll passes the signal to its GitHub read, process, or agent turn. A policy that throws, or a GitHub
read that fails, is retried at the next interval. Three failed polls in a row fail the step with the
last error, so a missing `gh` login or a revoked token doesn't wait a whole day.

The handler stays live while it waits, with no new step status. `waitForChild` in
`plugins/workflows/src/server/dispatch/childLifecycle.ts` waits the same way.

## The checkout while a run waits

Any run that hasn't finished marks its checkout busy
(`plugins/workflows/src/server/runs/checkoutActivity.ts`), and checkout admission then refuses Git
writes with `409 checkout_busy`. A day-long wait for review would lock the Git pane for that day.

The checkout counts as free while a run is waiting and doing nothing else. That covers a run in
`gated`, and a run whose only running steps are polling gates between polls. A poll that runs a
command or an agent turn marks the checkout busy for that poll only. This changes `gate-human` too:
you can commit and push while a run waits for your approval.

## `ci-loop` and `checks-green`

`ci-loop` asks `github:ci-settled` through `services.policy`, the way `gate-policy` finds a policy.
Each round:

1. Polls until the checks settle, using a `checks_timeout_ms` field with a default of 1,800,000.
2. Finishes on `pass`.
3. Fails on `timed-out`.
4. On `fail`, runs a fix turn with the failing names from `value`, in the same session as its
   earlier rounds, then starts the next round.

Its round limit and session reuse don't change.

`checks-green` stays as a one-shot name for `github:ci-settled`, so a workflow that names it keeps
working.

`checkFailed` stops counting queued and running checks as failed. The `pr_checks` agent tool
(`plugins/github/src/server/agentTools.ts`) uses the same rule, so it stops telling agents that
running checks failed.

`failingChecks` loses its two callers in the workflows plugin, and the capability method goes away.
The workflows plugin then reaches GitHub only through the policies GitHub contributes.

## The run pane and the terminal client

Each poll emits `{ type: 'progress', text }`, such as "Checks running: 9 of 12 finished". The run
pane draws an unrecognized event as JSON (`plugins/workflows/src/client/runs/NodeDetail.tsx`), even
though [progress events](../workflows/step-kinds.md#progress-events) says it shows one line.
This plan draws `progress` as one line under the node, which fixes it for every step kind.

Step events aren't stored. The gate keeps the last `detail`, the poll count, and the next poll time in
`inputs_json`, so a reload or a second client shows "Waiting: 3 of 12 checks running, next check at
2:41 PM" without waiting for the next poll. Both clients draw the run pane from the shared workflows
client plugin, so the terminal client needs no separate work.

## Out of scope

| Left out | Why | What would reopen it |
| --- | --- | --- |
| A data-source condition check | No data step can name the task's PR. The pull source can't filter by number or branch (`plugins/github/src/server/data/pullQuery.ts`), and its details read returns only `state` (`plugins/github/src/shared/pullSourceDescription.ts`). | A `context` address for the task's PR, and a details read that returns checks and reviews. |
| Loops in the graph | The graph refuses cycles, and validation, the run pane's step order, and recovery all depend on that. `ci-loop` keeps its loop inside one step. | A second loop that a step can't hold. |
| A parked step status that frees the handler | `waiting-gate` only ends through an outside answer, and a timer would need changes to the tick, reconcile, and every status display. A live handler with a saved deadline works. | A Node holding enough waiting gates that the live handlers cost memory. |
| Starting a workflow when a review lands | Triggers in committed files need a consent design that doesn't exist ([workflow followup work](./workflows-gaps.md)). | That consent design. |

## Verify before building

- Confirm that the checks the mirror reads come from the PR's head commit. `prFetch.ts` reads
  `commits(last: 1)` beside `headRefOid` (`plugins/github/src/server/routes/mirror/prFetch.ts`).
  Compare the two, and answer `wait` while they differ.
- Confirm that `runHeadless` accepts a read-only tool limit in one-shot mode. `decide` passes
  `tools: { allow: [] }`.
- Confirm that the mirror records whether a review's author is a bot. The review-received policy
  needs it, and the GraphQL `author` union already tells a `Bot` from a `User`.
- [Workflow execution](../workflows/execution.md#execution-model) says a restart parks ambiguous work
  in a recovery state, but `reconcile` in `runner.ts` queues a running step again. Correct that doc
  separately. This plan depends on the queuing behavior.

## Build it

Build in this order. You can check each slice on its own:

1. Policy contract. Move `checks-green` to the contribution shape and keep its one-shot behavior.
   Add the verdict union, `describe`, and `validate`.
2. Polling gate. Add `interval_ms`, `timeout_ms`, and `branches`, the saved `since` and deadline, the
   abortable sleep, the error streak, and the structured output. Test it with a fake policy.
3. CI settled. Add the GitHub policy, the refresh before each read, the head-commit check, and the
   `checkFailed` fix. Alias `checks-green` to it.
4. Review received. Add the GitHub policy and bot filtering.
5. Command exit code. Add the terminal policy and its copy of the contract type.
6. Agent verdict. Add the built-in policy, the fixed schema, the read-only tools, and the
   five-minute floor.
7. Checkout release. Add the waiting checks to `checkoutActivity`.
8. `ci-loop`. Rebuild each round on the CI policy and remove `failingChecks`.
9. Run pane. Draw `progress` lines and the saved last detail.

## Acceptance

Tests:

- A polling gate with a fake policy answers `wait` twice, then `pass`. The step finishes after three
  polls, and `polls` is 3 (`plugins/workflows/src/server/workflowGate.test.ts`).
- A restart during a wait keeps `since` and `deadlineAt`, and the gate still reports `timed-out` at
  the original deadline.
- A gate with `branches` takes `timed-out` and skips `pass`. A gate without `branches` fails on
  `timed-out`.
- `ci-loop` with checks `IN_PROGRESS`, then `FAILURE`, then `SUCCESS` waits, runs one fix turn, and
  finishes after two rounds (`apps/node/test/integration/plugins/workflowRunner.test.ts`).
- `pr_checks` reports a queued check as not failed (`plugins/github/src/server/agentTools.test.ts`).
- The command policy maps exit codes 0, 75, and 1 to the three verdicts
  (`plugins/terminal/src/server/workflowSteps.test.ts`).
- The Git pane can write to a checkout whose run is waiting at a gate.

Real-app check:

1. In `pnpm dev:agent`, run a workflow with a polling gate over a command check that exits 75 until a
   file exists.
2. Watch the gate's progress line, and commit from the Git pane while it waits.
3. Create the file and see the gate pass.
4. Restart the app mid-wait and see the poll count and deadline survive.

When it ships, update [workflow execution](../workflows/execution.md),
[contributed step kinds](../workflows/step-kinds.md), [workflows](../workflows.md), and the GitHub
plugin's [mirror](../github-integration/mirror.md) doc, then remove this file from
[the future index](./README.md).
