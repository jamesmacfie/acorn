# Remaining Acorn performance work

Date: October 2, 2026. Status: deferred for a later session.
The implementation checkpoint is commit `61b9994c`: units 01–08 are implemented and reviewed.
All 16 investigations are complete. The table below tracks implementations, remaining assignments,
and verification limits.
This programme is separate from the performance plans retired in September 2026.

## Resume here

Start with [unit 13](./13-agent-results.md). Assign one specialist at a time, review its result, then
advance in the order below. Each assignment includes the detailed coordinator brief, evidence
references, contracts to preserve, and acceptance checks. Read [the main integration review](../../../plans/performance/merge-main-review.md) for unresolved
verification failures deferred at the user's request. Revalidate the merged source first;
main has independent fixes and architectural changes since the audit. If a dependency changes,
record the reason and adjust the order without undoing completed work.

Read [the implementation contract](./contract.md) and [the conditional work and refusals](./refused.md).
The final assignment is [sustained-use validation](./29-sustained-validation.md). It belongs after
all selected fixes and includes the two-Node and native/TUI composition checks.

## Sequential assignments

| Unit | Assignment | Reviewed prerequisites | Status |
| --- | --- | --- | --- |
| 09 | [Managed agent client implementation record](../../../plans/performance/implementation-09-agent-client.md) | 01–08 | Implemented |
| 10 | [Managed agent process implementation record](../../../plans/performance/implementation-10-agent-processes.md) | Through 09 | Implemented |
| 11 | [Agent queue implementation record](../../../plans/performance/implementation-11-agent-queue.md) | Through 10 | Implemented |
| 12 | [Streamed search implementation record](../../../plans/performance/implementation-12-agent-search.md) | Through 11 | Implemented |
| 13 | [Agent wait facts and complete result capture](./13-agent-results.md) | Through 12 | Pending |
| 14 | [Git observations, filesystem admission, and exact paths](./14-git-filesystem.md) | Through 13 | Pending |
| 15 | [Shared pull request comparisons and marker identity](./15-pr-markers.md) | Through 14 | Pending |
| 16 | [Editor custody implementation record](../../../plans/performance/implementation-16-editor-custody.md) | Through 15 | Implemented; unit 15 identity integration and native verification remain open |
| 17 | [Editor search, file tree viewport, and host admission](./17-editor-search-tree.md) | Through 16 | Pending |
| 18 | [Database implementation record](../../../plans/performance/implementation-18-database.md) | Through 17 | Implemented; PostgreSQL 14/15 gates pass |
| 19 | [Docker implementation record](../../../plans/performance/implementation-19-docker.md) | Through 18 | Implemented; native verification blocked by service bundle size gate |
| 20 | [HTTP decoding, draft custody, and cancellation](./20-http.md) | Through 19 | Pending |
| 21 | [SQL scratch limits and oversized draft recovery](./21-sql-recovery.md) | Through 20 | Pending |
| 22 | [Preview listener admission, retirement, and URL resolution](./22-preview.md) | Through 21 | Pending |
| 23 | [Memory delta indexing and fresh reconciliation](./23-memory.md) | Through 22 | Pending |
| 24 | [Workflow read implementation record](../../../plans/performance/implementation-24-workflow-reads.md) | Through 23 | Implemented; native verification blocked by bundle size gate |
| 25 | [Workflow custody implementation record](../../../plans/performance/implementation-25-workflow-custody.md) | Through 24 | Implemented; native verification blocked by service bundle size gate |
| 26 | [Terminal client viewport, wrapping, painting, and logs](./26-tui-rendering.md) | Through 25 | Pending |
| 27 | [Terminal client selected Node and lifecycle composition](./27-tui-composition.md) | Through 26 | Pending |
| 28 | [Telemetry retirement and total histogram bounds](./28-telemetry.md) | Through 27 | Pending |
| 29 | [Sustained-use and final performance validation](./29-sustained-validation.md) | Through 28 | Pending |

The order encodes important dependencies: client origin/draft custody before agent process work;
process ownership before queue admission; raw/search completeness before wait/result projection;
marker identity before editor custody; editor custody before SQL recovery; viewport work before
TUI selected-Node composition. The database unit requires a real disposable PostgreSQL gate.
Unit 27 requires two real authenticated disposable Nodes and actual terminal-host composition.

## Evidence and completed work

[The original audit index](../../../plans/performance/README.md) links every area report and probe.
[Accepted results](../../../plans/performance/implementation-results.md) record units 01–08 gains,
costs, and limits. [Verification](../../../plans/performance/verification.md) preserves command
results, source/evidence hashes, contract fixes, and failure/replay history. Keep those artifacts.
Do not rerun or rewrite immutable before results; capture a fresh cumulative before baseline for
each remaining unit.

The checkpoint passes the bounded repository tests: 35 package tasks, including 598 TUI tests and
124 desktop JavaScript plus 40 Rust tests. Repository lint passes 34 package tasks. The isolated
real Tauri Changes empty state and plain Shell prompt are visually checked, and every recorded
fixture PID is absent after shutdown. This does not establish loaded-diff native latency, reliable
repeated focus, two-Node composition, day-long stability, or completion of the remaining programme.
The [native validation notes](../../../plans/performance/native-validation-notes.md) own those limits.

## Main-merge context

Re-read [simple memory](../memory/README.md), [agent-built apps](../dynamic-ui/README.md), and
[the terminal review](../tui-review/README.md) when their owners overlap a performance assignment.
These proposals are context, not authorization to build them. Main also contains resident diff
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
