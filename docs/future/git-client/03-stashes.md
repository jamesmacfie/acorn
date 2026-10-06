# Phase 03: stashes and checkout admission

Date: October 7, 2026. Status: planned; implementation not started.
Depends on [phase 02](./02-history-and-diffs.md).
Read the [full implementation context](./README.md), especially
[stash behavior](./README.md#stash-behavior) and
[task activity and admission](./README.md#task-activity-and-admission).

## Deliverable

A person inspects repository stashes, creates a stash from a task, applies or pops it onto an
explicit idle task, or confirms a drop. Busy tasks and stale selections are refused by the Node.

## Steps

1. Add stash list/detail contracts with object ID, selector, roster fingerprint, origin branch,
   message, time, base, and captured untracked files. Reuse phase 02 revision detail and diff;
   account for stash index/untracked parents without drawing ordinary merge semantics.
2. Introduce the shared Node checkout admission seam with authoritative Agents and Workflows
   activity projections. Map enqueue, start, retry, resume, recovery, cancellation settlement,
   setup, and archive paths. Make the activity check and Git write one guarded operation; do not
   hold a guard across a nested workflow-to-agent admission. Release on every failure.
3. Add task-targeted create/apply/pop and repository drop routes. Validate roster/object/selector
   freshness and checkout state under admission. Return observed conflicts and partial failures;
   invalidate Git and Changes state after every attempted write that may have changed it.
4. Add task-pane actions, repository target-task selection, explicit option controls, destructive
   drop confirmation, and busy/dirty/stale-selection refusals. Preserve typed message and option
   values on failure. Do not introduce automatic dirty-checkout cleanup.
5. Keep a conflicted pop's stash and show conflicted files with Changes/editor guidance. Git
   operation markers may be absent for stash conflicts; avoid unsupported operation controls.

## Acceptance

- Real repositories cover tracked creation, include-untracked, keep-index, restore-index, ignored
  files, apply preserving the stash, successful pop removing it, conflicting pop retaining it,
  dirty target refusal, and empty/no-change creation.
- Reorder or drop stashes between selection and submission, including duplicate objects. Verify
  that an action never intentionally targets a different stash because a selector moved.
- Controlled races prove both admission orderings, queued turns, live permission waits, cancelling
  agents, gated/cancelling workflows, retries, shared checkout aliases, failure release, and no
  nested-admission deadlock. Idle sessions alone remain eligible.
- Both hosts demonstrate target identity, options, conflict feedback, and preserved failed input.
  Run [phase gates](./README.md#verification-strategy) for Git, core, Agents, Workflows, Changes,
  public API, and affected consumers before phase 04.

## Verify before building

- Recheck owner runtime statuses and every path that admits work; a lifecycle event is not an
  authoritative busy check.
- Confirm stash command/version behavior and Git's limits on external reflog transactions.
