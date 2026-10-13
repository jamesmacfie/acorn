# Phase 06: git calls in checkout admission

Status: planned, October 13, 2026.

Read the [programme page](./README.md) first. This phase needs nothing else and is the one to start
with. The numbers come from the [Sentry baseline](../../testing/sentry-baseline-2026-10-13.md).

## Deliverable

Looking up a task's folder starts no `git` process when the repository is already known. Lookups for
tasks in the same repository stop waiting on each other's `git` calls.

## The problem

Core wraps four task lookups in checkout admission: `root`, `requireRoot`, `resolveCwd`, and
`runConfig`, in `packages/node-core/src/server/core/index.ts`. Plugins call these all the time. The
git, editor, preview, agents, and http plugins each ask for a task's folder before they do anything.

`admitWork` in `packages/node-core/src/server/core/checkoutAdmission.ts` calls `lockKey` twice. It
calls once to pick the queue, and once inside the queue to check that the checkout didn't move while
it waited. Each `lockKey` runs `git rev-parse --path-format=absolute --git-common-dir`. So every
lookup starts two processes.

The second call runs while the lookup holds its repository's queue. Ten lookups for one repository
therefore wait behind ten `git` processes in a row, at 37 ms each at the median and about 100 ms
under load. The routes that start with a folder lookup are the slow ones in the baseline:

- `/v1/p/git/tasks/:id/local/status` took 502 ms at the median and 4.0 s at p95.
- `/v1/core/tasks/:id/tools` took 537 ms at the median.
- `/v1/core/task-statuses` took 443 ms at the median.

Core recorded 34,575 `git rev-parse` calls and 47,401 process starts in the day under owner `core`.
This lookup is the most likely source, but nobody has confirmed the split.

## Change

Cache the `rev-parse` answer per mapped path inside `createCheckoutAdmission`. `lockKey` still reads
the task and project from the database each time, so a project whose path changes gets a new cache
key and a fresh answer. The `checkout_moved` check keeps working, because the test for it moves the
project's path, not the repository on disk.

The answer for a given folder changes only if someone replaces that folder with a different
repository. External tools don't take part in checkout admission, as
[git client operations](../../git-client/operations.md) says, so that case is already outside its
guarantee. Give each entry a time limit, 60 seconds to start, and drop an entry when `git` fails, so
a missing checkout isn't remembered.

With the cache, the check inside the queue costs a database read, and the queue holds for
microseconds instead of a process start.

Don't remove the queue for reads. It's what keeps a lookup from running during a write, and its
actions are short once the `git` call is gone.

## Implementation steps

1. Confirm the source. Add a temporary count of `lockKey` calls and compare it with
   `git.rev_parse.count` for owner `core` over a working hour.
2. Add the per-path cache to `createCheckoutAdmission`.
3. Add tests to `checkoutAdmission.test.ts`, with a fake `git` that counts calls:
   - Two `admitWork` calls for one task in a row run `rev-parse` once.
   - A failed `rev-parse` isn't cached.
   - The test "refuses checkout movement while queued" still passes.
4. Record a day of use and compare with the baseline.

## Acceptance

- `git.rev_parse.count` for owner `core` falls by at least half over a comparable day.
- The median of `/v1/p/git/tasks/:id/local/status` and `/v1/core/tasks/:id/tools` falls below
  250 ms. Below that, Sentry stops keeping the spans, so a drop in the slow-call count also counts.
- The admission tests pass unchanged.

## Risk

A repository moved on disk while Acorn runs keeps its old queue key for up to 60 seconds. Every
caller gets the same stale key in that time, so lookups still queue together. The risk is two keys
for one repository when a cached entry and a fresh one overlap. The time limit bounds that.
