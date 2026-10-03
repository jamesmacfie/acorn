# Remaining Acorn performance work

Date: October 2, 2026. Status: deferred for a later session.
The implementation checkpoint is commit `61b9994c`: units 01–08 are implemented and reviewed.
All 16 investigations are complete. The table below tracks implementations, remaining assignments,
and verification limits.
This programme is separate from the performance plans retired in September 2026.

## Resume here

Use the table below to select the next pending unit. Assign one specialist at a time, review its result, then
advance in the order below. Each assignment includes the detailed coordinator brief, evidence
references, contracts to preserve, and acceptance checks. Read the main integration review for unresolved
verification failures deferred at the user's request. Revalidate the merged source first;
main has independent fixes and architectural changes since the audit. If a dependency changes,
record the reason and adjust the order without undoing completed work.

Read [the implementation contract](./contract.md) and [the conditional work and refusals](./refused.md).
The final assignment is sustained-use validation. It belongs after
all selected fixes and includes the two-Node and native/TUI composition checks.

## Sequential assignments

| Unit | Assignment | Reviewed prerequisites | Status |
| --- | --- | --- | --- |
| 09 | Managed agent client implementation record | 01–08 | Implemented |
| 10 | Managed agent process implementation record | Through 09 | Implemented |
| 11 | Agent queue implementation record | Through 10 | Implemented |
| 12 | Streamed search implementation record | Through 11 | Implemented |
| 13 | Agent results implementation record | Through 12 | Implemented |
| 14 | Git filesystem implementation record | Through 13 | Implemented; native Changes verification blocked by service bundle size gate |
| 15 | PR markers implementation record | Through 14 | Implemented; native verification blocked by service bundle size gate |
| 16 | Editor custody implementation record | Through 15 | Implemented; unit 15 identity integrated, native verification remains open |
| 17 | Editor search and tree implementation record | Through 16 | Implemented; native and PTY driver verification blocked by service bundle budget |
| 18 | Database implementation record | Through 17 | Implemented; PostgreSQL 14/15 gates pass |
| 19 | Docker implementation record | Through 18 | Implemented; native verification blocked by service bundle size gate |
| 20 | HTTP implementation record | Through 19 | Implemented; native verification blocked by service bundle size gate |
| 21 | SQL recovery implementation record | Through 20 | Implemented; native and PTY checks blocked by service bundle size gate |
| 22 | Preview implementation record | Through 21 | Implemented; native verification blocked by service bundle size gate |
| 23 | [Memory file reads, change feed, and UI work](./23-memory.md) | Through 22 | Revised for the direct-write store, 2026-10-03; fresh measurements and implementation pending |
| 24 | Workflow read implementation record | Through 23 | Implemented; native verification blocked by bundle size gate |
| 25 | Workflow custody implementation record | Through 24 | Implemented; native verification blocked by service bundle size gate |
| 26 | [Terminal client viewport, wrapping, painting, and logs](./26-tui-rendering.md) | Through 25 | Pending |
| 27 | [Terminal client selected Node and lifecycle composition](./27-tui-composition.md) | Through 26 | Pending |
| 28 | Telemetry implementation record | Through 27 | Implemented; sustained-use acceptance remains separate |
| 29 | Sustained-use validation record | Through 28 | Preparation recorded; final acceptance blocked |

The order encodes important dependencies: client origin/draft custody before agent process work;
process ownership before queue admission; raw/search completeness before wait/result projection;
marker identity before editor custody; editor custody before SQL recovery; viewport work before
TUI selected-Node composition. The database unit requires a real disposable PostgreSQL gate.
Unit 27 requires two real authenticated disposable Nodes and actual terminal-host composition.

## Evidence and completed work

The audit reports, unit briefs, implementation records, and verification logs lived in
`plans/performance/`. That folder was deleted on October 3, 2026. Recover any of them from Git
history with `git log --all -- plans/performance/`. Names below that used to link there refer to
those files.

The original audit index links every area report and probe.
Accepted results record units 01–08 gains,
costs, and limits. Verification preserves command
results, source/evidence hashes, contract fixes, and failure/replay history. Keep those artifacts.
Do not rerun or rewrite immutable before results; capture a fresh cumulative before baseline for
each remaining unit.

The checkpoint passes the bounded repository tests: 35 package tasks, including 598 TUI tests and
124 desktop JavaScript plus 40 Rust tests. Repository lint passes 34 package tasks. The isolated
real Tauri Changes empty state and plain Shell prompt are visually checked, and every recorded
fixture PID is absent after shutdown. This does not establish loaded-diff native latency, reliable
repeated focus, two-Node composition, day-long stability, or completion of the remaining programme.
The native validation notes own those limits.

## Main-merge context

Re-read [notes and memory](../../notes-and-memory.md), [agent-built apps](../dynamic-ui/README.md), and
[the terminal review](../tui-review/README.md) when their owners overlap a performance assignment.
The proposals are context, not authorization to build them. Main also contains resident diff
segments, provider idle handling, and native preview retention beyond the audit snapshot. Reproduce
remaining costs before applying an older proposed fix. Historical measurements stay attached to the
source versions that produced them.

## Deliver each unit

Capture the current owner and data flow before editing. Prove a performance difference with matched
workload counts, CPU, memory, or latency; record costs as well. Cover the consequential races,
cancellation, storage failure, teardown, and compatibility paths. Update owning shipped docs when a
contract changes. The coordinator reviews the diff and evidence before starting the next specialist.
No implementation or additional investigation is requested by writing these handoffs.

## Verify before building

- Read the resumed task instructions, docs index, architecture, conventions, and owning references.
- Inspect merged Git history and source to identify already-fixed or changed findings.
- Confirm prerequisite units and any migration/capability/wire proposals before implementation.
- Use verified single-runtime browser fixtures and actual production process/storage owners.
- Keep canonical content, unsent work, independent Node authority, and supported future seams intact.
- Coordinate builds, native checks, and heavy measurements; run one specialist at a time.
