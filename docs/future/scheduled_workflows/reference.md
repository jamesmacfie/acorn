# Scheduling contract

> Superseded on 2026-09-13 by [workflow v2](../workflow_v2/README.md).
> Do not implement this historical plan. Its original text is retained for background; the new
> [scheduling contract](../workflow_v2/scheduling.md) and implementation slices are authoritative.

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

## Schedule binding and approval

Persist a workflow target containing project ID, scoped definition reference, resolved string inputs,
approved definition-graph fingerprint, and bounded task-title configuration. The Node is the owning
database, not a freely supplied dispatch destination. References and defaults use workflow_tasks
resolution. Freeze resolved defaults at approval so later defaults do not silently alter inputs.

Creation produces a paused draft. An explicit device-authenticated arm operation validates inputs,
project access, every referenced definition, source trust, effective authority, and finite unattended
execution limits. Store the approved revision atomically with arming. Reject required blank inputs
and unknown input names. Input fields are not a secret store; use approved connection references
for credentials, not secret values in schedule payloads or logs.

Before each dispatch, compare the execution-affecting graph fingerprint with the approved one.
A changed prompt, binding, child reference, tools, model, budget, or input schema requires review
and rearming. Display needs-review rather than silently following an edited definition.
The run itself freezes the approved graph. Revoked trust or missing project/plugin blocks dispatch
without creating a task. A risk-tier stamp alone is insufficient to detect meaningful changes.

## Occurrence identity and recovery

Use a durable occurrence record, separate from the recent-history ring. An automatic occurrence
has a unique key from schedule ID, schedule generation, and scheduled due instant. Manual run-now
uses a request idempotency key. Reserve occurrence identity, intended task ID, and intended run ID
before effects. Persist dispatch state and result IDs. Duplicate claims converge through uniqueness.

The workflow_tasks invocation layer receives the occurrence key and reserved identities.
Core root creation accepts intended IDs and verifies matching seeds. Across databases, recover
by looking up reserved IDs and resuming the recorded transition. Never retry by allocating new IDs
after an ambiguous timeout. Retain deduplication records independently of the 20-row history ring;
retain a tombstone for deleted schedules until no occurrence can be replayed.

Preserve the scheduler's catch-up-once policy, not backfill. Persist the selected due instant
before advancing cadence state. Retry the claimed occurrence, not a new occurrence manufactured
from wall-clock retry time. A crashed claimed dispatch is recovered before selecting another.

## Overlap and completion

Initial overlap policy is skip while the schedule's previous root run or any admitted descendant
is nonterminal. Record the skipped occurrence with its reason; do not queue it. This applies to
run-now too. Claim the per-schedule admission lock atomically so manual and automatic dispatch
cannot race. Different schedules may run concurrently within Node and workflow limits.

A schedule dispatch succeeding means a task/run pair was durably started, not that the workflow
succeeded. History presents dispatch state separately from workflow state, with task/run links.
A gated workflow remains gated and counts as active. Do not force autonomous posture.

Pause prevents future occurrences; it does not cancel an active run. Delete stops future dispatch,
retains existing tasks and runs, and lets in-progress reconciliation finish. Cancellation is an
explicit workflow action using tree-wide cancellation. Run-now is an explicit device action,
requires a valid approved binding, and may run a paused schedule, subject to overlap and budgets.
Do not automatically queue offline mutations.

## Cadence and task defaults

Reuse interval, daily, and weekly scheduler cadence and its minimums. Display Node-local timezone
and next occurrence. Preserve and test the scheduler's daylight-saving behavior; document skipped
or repeated local times. No arbitrary cron, per-schedule timezone, or external trigger.

Create a root task for each admitted occurrence in the chosen project. In Git projects, derive a
unique branch using intended identity and use normal lazy worktree provisioning. In non-Git
projects, warn that task directories are shared. Keep inputs, workflow revision, and schedule origin
as run provenance. Do not auto-delete or archive tasks after completion.

## Verify before building

Verify the cadence parser and dispatch lifecycle against the surveyed code. Confirm paused
creation cannot race arming, history retention cannot erase replay protection, and plugin removal
fails closed without requiring a broader plugin capability.
