# Phase 6: let worktree reads skip checkout admission

Date: October 21, 2026. Status: proposed. Can run beside phases 7 and 8.

Every read of a task's root goes through one queue per repository. When any task in that repository
creates a worktree, fetches, or runs its setup hook, every other task's editor, Git pane, and prompt
waits. This phase lets a read of a worktree that already exists go straight through. Read
[the programme](./README.md) first.

## Starting point

- `packages/node-core/src/server/core/index.ts` sends `tasks.root`, `requireRoot`, `resolveCwd`, and
  `runConfig` through `checkoutAdmission.admitWork`
  (`packages/node-core/src/server/core/checkoutAdmission.ts`). The queue key is the repository's
  shared Git folder, not the task.
- Inside the queue, `resolveTaskCwd` in `packages/node-core/src/server/worktrees/taskWorktree.ts` can
  fetch with a 60 s limit, run `git worktree add` with a 60 s limit, copy files, and run the
  `core:worktree-created` hooks with 30 s each. A pull holds the queue for up to 120 s.
- `/v1/core/tasks/:id/tools` reaches the queue once per tool, through the terminal plugin's
  `hasRunTargets` and `runConfig`. A prompt can pass through it four times.
- From October 14 to 21, `checkout.admission.wait` recorded 3,909 waits, with a p95 of 1.65 s and a
  maximum of 12.6 s. `task.prepare` had a p95 of 7.6 s.

## Changes

1. In the root lookups, when the task row has a `worktreePath` and that folder exists, return it
   without entering the queue. These reads look at files and don't change Git state.
2. Keep the queue for anything that creates, moves, or removes a worktree, and for the archive check.
3. Inside creation, hold the repository-wide lock only around `git worktree add`, which is the step
   that changes the shared Git folder. Run the fetch, the copy, and the hooks under a per-task lock.

Check one case before you build it. A read that finds the folder while archiving is renaming it could
answer with a path about to disappear. The archive path already renames first and deletes in the
background, so the read gets a missing folder, the same answer it would get a moment later. Write the
test that shows it.

## Tests

- A root read for task A answers in under 50 ms while task B in the same repository holds the queue
  in a stubbed `git worktree add`.
- A root read for a task with no worktree still waits for creation.
- Archive and creation keep their ordering tests unchanged.

## Acceptance

- `checkout.admission.wait` count down by at least three-quarters, and its p95 under 200 ms.
- `/v1/core/tasks/:id/tools` and `/v1/p/git/tasks/:id/local/status` slow calls down over a working
  week, against 351 and about 4,000.
- [Worktrees](../../workspaces-and-tasks/worktrees.md) says which reads skip admission and why.
