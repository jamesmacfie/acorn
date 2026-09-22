# Ticket 04: Plugin-owned lifecycle collaboration

Date: 2026-09-21. Status: not started. Prerequisites: 03.
Read [context](./context.md), F02 in [findings](./findings.md), and
[lifecycle decisions](./target-architecture.md#findings-submission-and-lifecycle).

## Outcome

Composition supplies runtime dependencies only. Findings observes producer-owned lifecycle contracts;
Memory contributes Terminal launch context without a circular dependency.

## Work

- Remove the injected Agents completion callback. Its existing typed completion event and durable read
  capability are the sole automatic input to Findings.
- Define Terminal and Workflows completion events/read capabilities in their contracts. Include stable
  completion identifiers and bounded read results; keep full output off broadcast frames. Terminal
  snapshots before emission and retains the bounded window specified in the target architecture;
  Workflows reads persisted handoff data. Findings subscribes through manifest grants and resolves
  reads at call time.
- The bounded, awaited pre-teardown hook exists: `archiveTask` awaits
  `TaskSessionsBridge.captureArchiveReviewInput` and reports `reviewCaptureFailed` rather than failing
  the archive. What remains is ownership. Move archive evidence formatting out of composition and into
  Findings. The trusted producer obtains the bounded Git diff and PTY output before teardown; do not
  widen Findings' Git/process permissions. Preserve ordering before PTY buffer/worktree destruction.
- Add Terminal's launch-context contribution and register Memory through it. Terminal owns delivery;
  Memory no longer requires a root-injected launch thunk. Preserve send-to-agent as a separate action.
- Remove the product callbacks and capability imports from `apps/node/src/composition/pluginDeps.ts`.
  Retain internal environment, reconciliation barrier, and scheduler adapters. Move failing-checks
  collaboration into Workflows through GitHub's existing public capability.
- Keep optional capture failures bounded and observable, without failing the completed task or workflow.

## Acceptance

One ordinary completion produces one observation; review sessions do not recursively produce reviews.
Disable/reload Findings and verify producer work continues without stale callbacks. Archive capture
finishes or times out before teardown, and dirty-worktree/active-session checks still apply. Launch
context is bounded and ordered, and no package cycle appears. Run `pnpm lint`, architecture tests,
plugin lifecycle suites, and Node composition/restart tests.

Test a delayed Terminal snapshot read, cleanup before read, expiry/eviction, and restart unavailability.
Capture must never claim complete evidence when the snapshot has gone.

## Verify before building

Trace archive ordering from Terminal's archive handler through core task checks. Do not replace the
awaited operation with an event merely because completion uses events.
