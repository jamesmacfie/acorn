# Ticket 04: Plugin-owned lifecycle collaboration

Date: 2026-09-21. Status: complete (2026-09-23). Prerequisites: 03.
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

## Implementation record

Agents now has one completion path: its event and durable read capability. Terminal emits identifiers
after capturing a short-lived output snapshot; Workflows emits identifiers after persisting its run
status and reads its handoff note from Notes. Findings resolves both read capabilities when handling
events and reconciles persisted workflow completions on startup. An unavailable Terminal snapshot
creates an unavailable checkpoint, without an observation claiming the output was captured.

Terminal gathers bounded PTY tails, session IDs, and Git diff before core starts archive teardown.
It runs `terminal:archive-review`; the loaded Findings handler builds and persists the observation.
An explicit Findings failure sets `reviewCaptureFailed` while core still archives. The generic hook
runner waits at most five seconds per handler and logs a timeout. Its verdict does not distinguish an
absent optional handler from a timed-out one, so a timeout leaves archive successful without that
result flag; the hook run record shows the timeout. A disabled Findings package has no handler.

Memory contributes launch text to Terminal. Terminal sends ordered contributions under one 16 KiB
byte budget on the session's idle edge. Application composition now supplies only internal process
environment, reconciliation, and scheduler access. Workflows resolves GitHub checks through its
public capability.

## Verification

- `pnpm lint`: 34 of 34 packages passed. After removing obsolete dependency fields from two Node
  integration fixtures, `pnpm --filter @acorn/node lint` passed again.
- Terminal snapshot and launch-context tests: 4 passed. Findings lifecycle: 9 passed. Loaded Findings
  integration: 9 passed, including hook dispatch across enabled, disabled, and re-enabled boots.
- Plugin-disable: 12 passed. Core archive/worktree: 22 passed. Agents lifecycle: 6 passed.
- Architecture: 61 of 63 passed. The two failures are the existing palette command invocation and
  Findings migration-test filename rules; no phase-04 boundary rule failed.
- Node composition/restart: 4 passed in an isolated elevated run. Harness contribution and
  plugin-disable integration fixtures: 14 passed after replacing obsolete callback fields with the
  typed runtime dependency shape.
- `git diff --check`: passed.
- The plugin-types generated manifest schema test remains out of sync on `showInSwitcher` and
  `collapsible`. Neither its Zod contract nor the committed schema changed in this ticket; ticket 08
  owns the contract verification pass.
