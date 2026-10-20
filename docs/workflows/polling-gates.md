# Polling gates

A `gate-policy` step can wait for something outside Acorn, such as CI on the task's pull request or a
reviewer's comments, and then let the run carry on. This page covers how a gate polls, what it saves
across a restart, the checkout while a run waits, and `ci-loop`. The code is in
`plugins/workflows/src/server/steps/policyWait.ts` and `steps/builtins.ts`.

## How a gate polls

A `gate-policy` step asks a policy for a verdict. A policy answers `pass`, `wait`, or `fail`
([gate policies](./step-kinds.md#gate-policies)). Two answers aren't enough, because "not yet" and
"never" would read the same, and a gate would wait out its timeout on a red CI run.

A gate without `timeout_ms` asks once and reads `wait` as `fail`, which is how every gate behaved
before polling. With `timeout_ms`, the gate sleeps after each `wait` and asks again until the policy
answers `pass` or `fail`, or the timeout passes. Then it reports a fourth verdict, `timed-out`.

| TOML key | What it does |
| --- | --- |
| `policy` | The policy to ask, such as `review-received`. |
| `[steps.with]` | The policy's settings. Strings render one level deep, as a contributed kind's `with` does. |
| `timeout_ms` | How long to keep asking. Setting it is what turns polling on. |
| `interval_ms` | How long to sleep after a `wait`. Defaults to 60,000, or the policy's minimum when that is higher. |
| `branches` | A table from `pass`, `fail`, and `timed-out` to step IDs. |

Validation refuses an `interval_ms` without a `timeout_ms`, an interval below 30,000 or the policy's
own minimum, and a `timeout_ms` longer than the step's or the run's `max_wall_time_ms`. The runner's
step timer starts again in full after a restart, so the gate's own saved deadline must be the one that
fires.

A gate without `branches` finishes on `pass` and fails the step on `fail` or `timed-out`. A gate with
`branches` must name a `pass` target, and every target must wait on the gate, as `decide` targets do.
An answer that has a branch finishes the step `done`, and the runner skips the branches it didn't
take. An answer with no branch fails the step. The gate's structured output is
`{ verdict, detail, value, polls }`, where `value` is whatever the policy answered with, such as the
names of failing checks or the review comments that arrived.

```toml
[[steps]]
id = "await-review"
name = "Wait for review"
kind = "gate-policy"
policy = "review-received"
interval_ms = 120000
timeout_ms = 86400000

[steps.branches]
pass = "address-review"
timed-out = "nudge"
```

The handler stays live while it waits, with no new step status. On its first poll it saves a
`policyWait` record in the step's `inputs_json`, with `since`, `deadlineAt`, the poll count, the last
`detail`, and the next poll time (`plugins/workflows/src/shared/policyWait.ts`). After a restart the
handler reads the record back, so `since` stays put and the deadline doesn't reset. The record is
removed once the policy settles, so a retry starts a fresh wait. The run pane reads the same record,
so a reload shows when the gate asks next without waiting for it.

The sleep between polls stops on the step's abort signal, so cancelling the run stops the wait at
once. A policy that throws, or a code host read that fails, is retried at the next interval. Three failed
polls in a row fail the step with the last error, so a revoked token doesn't wait a whole day. An
answer other than the three verdicts fails the step at once.

Under an autonomous posture, `gate-human` passes straight through, but a polling gate still polls,
because it isn't asking a person.

## The checkout while a run waits

A run that hasn't finished normally marks its checkout busy, and checkout admission then refuses Git
writes with `409 checkout_busy`. A run that is only waiting leaves the checkout free
(`runs/checkoutActivity.ts`). That covers a step at a human gate and a polling gate between polls,
when nothing else in the run is running. You can commit and push from the Git pane while a run waits
for review or for your approval.

Each poll marks the gate `polling` under checkout admission before it asks, and `sleeping` after. A
Git write already in progress finishes before the poll starts, and a write that arrives during a poll
is refused until the poll ends. The moment between one step finishing and the next starting still
counts as busy, because nothing is waiting then.

## `ci-loop`

`ci-loop` asks the `ci-settled` policy of the task's code host, such as `github:ci-settled`, through
the same polling code. Each round waits for the checks to
settle, for up to `checks_timeout_ms` (default 1,800,000). It finishes on `pass` and fails on
`timed-out`. On `fail` it runs a fix turn with the failing check names, in the same session as its
earlier rounds, then starts the next round. A round after a fix waits for the new commit's checks to
appear rather than failing because there are none yet. The round limit, `max_iterations`, still ends
the step at a safety rail. With no pull request on the task, or with its code host off or filing no
`ci-settled` policy, `ci-loop` fails because there are no checks to read.

## Related pages

[Gate policies](./step-kinds.md#gate-policies) covers the policy contract and the policies that ship.
[Workflow execution](./execution.md) covers the graph, branches, retry, and human gates.
