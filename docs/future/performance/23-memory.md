# Memory delta indexing and fresh reconciliation

Date: October 1, 2026. Status: pending implementation; unit 23.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–22, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 14](../../../plans/performance/14-background.md).

The original [unit brief](../../../plans/performance/implementation-23-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read area 14, docs/notes-and-memory.md, Findings approval/receipts,
Memory plugin database schema/migrations and activation/disposal. Files remain truth and SQLite/FTS
remain recoverable derived projections. Capture a fresh cumulative baseline through knowledge owner.

## Delta commit

reconcileMemories currently scans all sources, preserves prior recall stats in JavaScript, deletes
both projections and reinserts every row. Apply only changed/new/removed rows in an owner transaction
covering index and FTS together. Compare all persisted semantic fields, not only contentHashId:
type, path, scope, project, source metadata and timestamps can change without a different body hash.
Preserve the existing ID/natural-key constraints and deterministic newest-source winner/tie policy;
do not introduce an incompatible content identity migration for a performance shortcut. If baseline
duplicate IDs make the existing projection ambiguous, characterize and report that separately.

Read/update recall statistics at the commit boundary so a touch during filesystem awaits survives.
Do not overwrite stats from a stale scan-time copy. Preserve search ranking/tokenization, scopes,
supersession filtering, source timestamps, get/list/launch context and exact Findings receipts.
Recover missing/corrupt derived FTS rows coherently without rewriting unchanged healthy rows on
every read. Failure leaves both projections consistent and retryable. Core cannot read plugin tables.

## Joined fresh reconciliation

Reserve one knowledge-owner wave before buildMemorySources's first await. Ordinary overlapping
readers join matching current work. Authorized source discovery stays fresh: active tasks, checkout
directories and private project roots can change. A pass admitted after explicit file write or
Findings approval must include that write, rather than acknowledge an already-running older snapshot.
Use a generation/dirty-follow-up barrier and identity-checked finally. Joined readers must not
cancel a surviving owner. Dispose prevents late publication and releases pending/cache references.
Remove redundant reconciled→allRows reconciliation only with an explicit same-wave fresh-read seam.

Start with the database delta if file parse reuse cannot prove freshness safely. If a bounded parse
cache is adopted, verify fresh file identity/stamps including ctime, inode/device, size, atomic
replacement and restored mtime. External edits, source addition/removal, changed permission and
winner topology must remain visible on the next read. No TTL or cached authorization/source list.
Avoid unbounded filesystem fanout and retaining every historical file body in an idle cache.

## Evidence

Actual disposable Memory files and plugin SQLite: 300×4 KiB cold, five unchanged and four overlapping
knowledge reads. Unchanged projections issue zero index/FTS writes; matching readers share one wave.
Measure file reads, SQL counts, CPU, transient/retained bytes independently. Exercise external edit,
same-size/restored-mtime change, rename/delete, missing/unreadable dir, source/winner changes, stale
wave after write, recall touch during scan, Findings approval/receipt retry and failed transaction.
The audit reproduced no duplicate final FTS rows under overlap; do not claim that as a repaired
baseline leak. Isolate home before module import and use synthetic project/task authorization only.
No normal Memory content/profile, private repository or provider call is required. Run focused
Memory/Findings suites/types/lint, owning docs and fresh native library/search/revisit checks with
the coordinator. Short reconciliation fixtures do not prove multi-day filesystem or UI stability.

## Completion and handoff

Implement only the reproduced issues within this assignment. Return any explicitly requested
compatibility, migration, or custody proposal to the coordinator before changing that contract.
Use current production owners for paired evidence; preserve historical fixtures and label superseded
baselines. Write an implementation record with changed files, exact commands and outcomes, before
and after comparisons, costs, and concrete remaining limitations. Update the owning shipped docs
when behavior changes. Retire all disposable resources before review. Do not start the next unit.

## Verify before building

- Re-read the merged source and applicable engineering instructions; the audit predates the main merge.
- Confirm prior units' contracts and actual callers still match this proposal.
- Resolve the listed owner, capability, data model, migration, and compatibility decisions before editing.
- Verify a single Solid runtime and normal QueryClient provider for browser measurements.
- Capture fresh source/probe hashes and the same supported workload on both sides of the change.
- Preserve canonical content, offline rows, unsent drafts, and independent Node authority.
- Run relevant tests and types, then coordinate cumulative lint, bounded tests, and real UI checks.
