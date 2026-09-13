# Scheduling and record processing

Date: 2026-09-13. Status: accepted design, implementation not started.
Context: [decisions](./context.md). This replaces the earlier scheduling programme's proposed contract.

## Schedule target and approval

Keep core's scheduler as the sole periodic-work engine. Register a workflow target through the
existing capability/target seam. Workflow plugin storage owns approved workflow bindings,
occurrences, and per-record processing state. Core continues owning cadence and dispatch lifecycle.

A schedule stores project, published workflow reference, resolved typed inputs/defaults, timezone,
effective unattended limits, approved execution-graph digest, and revision/generation identity.
The digest covers referenced published queries and child workflows. New schedules are inactive
drafts. Activation validates scope, graph, source capabilities, repository trust, and finite limits.
Approval is a device action. A task-scoped agent cannot approve its own broader execution scope.

Check the approved graph immediately before dispatch. Changed execution semantics require review.
Unavailable plugins/connections and revoked access block dispatch before root task creation. Labels
and editor layout do not change execution approval. Publication notifications improve the UI but
cannot substitute for this admission check.

Defaults are interval/daily/weekly cadence, the scheduler's existing minimum intervals, and one
active run tree per schedule. Add explicit IANA timezone support to calendar cadence without changing
the timezone semantics of unrelated preexisting scheduler targets. Default from the Node at creation
and persist it. Skip nonexistent local times; choose the first occurrence of repeated local times,
once per calendar date. Show the next concrete occurrences before activation. Interval cadence uses
elapsed time, not local clock arithmetic. Do not add cron or external webhooks in this programme.

## Occurrences and overlap

Reserve an occurrence keyed by schedule ID, cadence/approval generation, and scheduled UTC due
instant. Manual Run now uses an explicit idempotency key. Reserve intended root task/run IDs and
dispatch state before creating either. Reuse the existing internal workflow-start capability and
core intended-ID behavior. Reconciliation looks up those IDs; it never allocates replacements after
an ambiguous response. Retain occurrence identities beyond the small visible recent-history ring.

Use catch-up once after downtime, not replay of every missed interval. Persist the selected due
instant before advancing scheduler state. Reconcile claimed occurrences before selecting another.
When the prior root or any admitted descendant is active, skip the new occurrence with a visible
reason. Gates count as active. Apply the same atomic overlap admission to scheduled and Run now
requests. Distinguish dispatch success from workflow completion.

Pause stops future occurrences and does not cancel work. Delete stops future dispatch while retaining
tasks, run snapshots, and occurrence tombstones needed for recovery. Run now is available on a paused
but approved schedule and uses its processing history. Root cancellation is a separate workflow action.

## Processing identity

The history scope is schedule ID + explicit processing epoch + stable loop occurrence path. A loop
path includes stable caller step IDs; nested loops also include ancestor record identities so two
different parent items cannot accidentally share a child-loop history. Renaming steps changes none
of these. A copied schedule has independent history. Ordinary manual runs use fresh run scope.

Within that scope, key a record by its full source/connection/record identity, or its declared
ordinary-array key. Store selected snapshot/provenance, the last admitted tracked-field projection,
active attempt, and attempt history. Keep absent and null distinct in projection encoding. Canonical
object key ordering removes serialization noise; array order remains meaningful.

| Policy | Admission |
| --- | --- |
| Every match | Admit every matching record for this occurrence. Invocation idempotency still protects retries. |
| Previously unseen | Admit a record without prior baseline or admitted attempt in this history scope. |
| Selected fields changed | Admit a new record, or a changed projection relative to its last admitted/baselined projection. |

Compare against the latest projection, not a permanent set of all historical hashes. A → B → A is
a change on both transitions. No active record gets another concurrent attempt within its scope.
Source changes during a run are considered on the next scheduled query, not enqueued as every
intermediate version. This is polling, not event capture.

Failed attempts remain recorded and are not automatically retried for an unchanged projection.
A genuinely different tracked projection is new work under the changed-fields policy. Explicit
retry resumes the failed attempt's snapshot; explicit reprocess creates a fresh recorded attempt.
Neither operation erases previous outcomes or charges. Changing the workflow alone does not mark
unchanged records as new. The review offers an explicit fresh processing epoch when desired.

Track-field edits retain attempt history. If a newly selected field exists in the retained snapshot,
recompute the baseline projection. If it cannot be reconstructed, require the review to choose a
fresh baseline or reprocessing epoch; do not assume every missing field means changed. Source or
connection changes naturally select different identities but do not delete previous ones.

## First check and time windows

Activation offers **Process current matches** or **Start tracking from now**, defaulting to current
matches within the configured query window. A baseline check must complete and durably record the
matching identities/projections before activation is reported ready. Preview is not that baseline.
For incremental sources, obtain the source's initial committed boundary through its declared
baseline operation. Failure retains an inactive schedule with its draft choices.

Relative duration windows and since-midnight windows resolve once per query using a captured UTC
evaluation instant and the saved timezone. Use half-open ranges `[start, end)` for date comparisons.
The source translates endpoint conventions correctly. Calendar and rolling windows can miss data
beyond the chosen range after downtime; describe that limitation in contextual help.

**Since the last completed check** requires a source-declared incremental continuation capability.
The source owns its opaque token and documents deletion handling, late visibility, expiration, and
when a safe completed boundary may be committed. The host does not manufacture a timestamp guarantee.
A provider without this capability still supports rolling windows and repeat tracking when its
query operators permit them. The initial real providers need not claim checkpoint support without
verified API evidence; an installed fixture proves the generic capability.

## Selection commit and recovery

Persist the query selection before dispatch. In one workflow-database transaction, record all
selected identities/snapshots, their admitted or skipped decision, reserved dispatch intents for
eligible rows, and the committed continuation boundary. Only then create child tasks. The source
page cursor is temporary pagination state, not the committed incremental boundary.

If a source fails, a selection exceeds a bound, a required binding fails, or initial child admission
cannot fit, commit neither child intents nor the new boundary. A complete zero-match selection may
advance the boundary. A complete selection of previously handled records may also advance it.
Reject `take` with incremental windows. Do not advance past undispatched records to make a limit fit.

A checkpoint query must feed one designated tracked loop in this version. Reject ambiguous use by
several tracked loops or a path that can skip its consuming loop. This makes the selection/intent
commit boundary explicit without introducing a distributed consumer-watermark system. Ordinary
queries can feed several consumers without this restriction.

Committed intent is durable work even before task creation. Restart resumes pending intents. If a
user cancels the run after commit, retained unstarted rows are shown as cancelled and can be
explicitly reprocessed; they are not silently forgotten because the checkpoint advanced. Child
failure does not rewind the boundary. Recovery of an expired provider token requires an explicit
new baseline/window decision with retained history, not a silent reset to now.

## Verification and retention

Use transaction uniqueness for occurrence and record admission, not in-memory flags. Keep active
and ambiguous operations through pruning. Retain processing identity/projections for the schedule's
life, plus deleted-schedule tombstones while any occurrence can recover. Attempt payload retention
must not erase replay protection. This programme adds no automatic task/worktree archival.

## Verify before building

Recheck core scheduler cadence, catch-up, jitter, backoff, and target serialization. Workflow overlap
must cover the whole run tree rather than the short dispatch call. Read [workflow recovery](./workflow-contract.md)
and [publication](./publication.md) before adding occurrence tables or approval digests.
