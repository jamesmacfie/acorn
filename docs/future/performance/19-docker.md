# Docker process ownership, log tails, and Node scope

Date: October 1, 2026. Status: pending implementation; unit 19.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–18, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 13](../../../plans/performance/13-services.md).
- [Investigation 16](../../../plans/performance/16-ownership.md).

The original [unit brief](../../../plans/performance/implementation-19-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read areas 13 and 16, docs/docker.md, the reviewed unit 03
viewer/shared-producer ownership and unit 05 origin capture before implementation. Start only
after preceding units pass coordinator review. Capture a fresh cumulative baseline; joining
Docker producers and inactive-frame suppression are already shipped in this worktree.

## Child admission, failure and retirement

DockerService tracks stream children before their asynchronous spawn result. Missing executables
emit error and close without exit, so the current exit-only retirement permanently consumes all
32 slots. The events watcher has the same ownership hole. Settle each owned child once across
synchronous throw, error, exit, close, stop and dispose. Unexpected failure calls end exactly once;
intentional stop retains its suppression contract. Drain output through its actual close boundary
where needed. A failed watcher clears only its own generation and schedules one bounded backoff;
late cleanup must not retire a replacement. Dispose prevents restart, health publication and
debounced broadcasts. Preserve fixed argv, broker environment, current stream budget, event
debounce/backoff, tail 300, stderr log delivery and daemon-independent portability.

Unit 03 SharedDockerStreams already joins kind/container producers across independent viewers,
retains bounded replay and handles synchronous spawn failure. Exercise asynchronous service
failure through that actual owner; do not replace it with per-viewer child creation or teach
the helper Docker-specific ownership. Confirm subscribers receive end and a later attachment
can admit a healthy producer. Test real missing-binary ChildProcess events with disposable PATH,
and verify all synthetic children/timers settle. No normal Docker mutation is required.

## Discovery waves and freshness

Join matching cold info calls before the first await. Preserve settled 10 s health and 5 s inventory
policy and unavailable taxonomy. A held health result after disposal cannot start a watcher or
repopulate the cache. Inventory invalidation currently deletes only settled data: a held older
load can publish after mutation/event invalidation and its finally can erase a replacement wave.
Characterize and fence these generations while preserving the originating caller's honest result.
No longer TTL or discarded invalidation is an acceptable substitute.

Task summaries already await authoritative tasks and containers. Once both succeed, an empty
container inventory can return an empty summary without reading any matcher config. Preserve
authorization and all positive/negative custom matcher behavior for nonempty inventories. If
nonempty config fanout is selected, measure a small bounded worker limit, preserve output order,
join matching config reads and keep mutable worktree/home config freshness unchanged. Do not
introduce unbounded filesystem concurrency or inspect normal private config during probes.

## Display tail representation

dockerLogStore appends and slices the entire 512 Ki UTF-16 tail on every chunk. Adopt a bounded
segmented representation with a reactive version and projection at actual consumer boundaries
or a documented bounded publication cadence. Keep the current accessor contract or update all
typed consumers together. Unit 03 Node LogReplay is a different owner; a new unused helper is
not performance evidence. Preserve exact last-N UTF-16 units, including split surrogates, stdout/
stderr order, huge chunks, clear/end/reopen, eight-buffer LRU/detach, two-view sharing, reconnect,
same-Node hidden continuity and search/follow behavior. Bound segment count and backing retention.

Replay the actual prefilled eight-tail/24,000-chunk workload through production with consumer reads
as well as hidden ingestion. Measure projections/publications, CPU, retained text and segments
separately. Whole-log DOM virtualization and visibility policy remain conditional findings;
do not claim rendered Log gains from a store-only fixture or silently stop hidden streams.

## Origin Node and view ownership

Qualify subscriptions, exec IDs, log buffers, view selection and retained task roots by originating
Node/generation. Captured QueryClient ownership and targeted wsSendToNode cleanup from units 04/05
are the seams. Retire outgoing live state before incoming reattach; final detach must not reacquire
an outgoing broker interest. Delayed A cleanup cannot remove a new same-ID B owner, and B output
cannot feed A's tail. Same-Node background streams retain their continuity and existing LRU bound.

Trace dockerClient, dockerStore refresh and 15 s summaries, DockerTaskPane detached roots,
ContainerDetail actions/detail/stats, DockerExecTerminal and terminal-focus creation too. Reads,
actions and their follow-up focus/refetch must capture Node and document/task generation before
awaiting. Application-lived wiring must be disposed or safely scoped at plugin retirement. Do
not make a failed inventory look like an authoritative empty roster or overwrite established
last-known data without an explicit current contract. Runtime state must not leak into the
persisted query cache or migrate device selection between colliding Node IDs.

## Evidence

Real failed spawn 32→zero retained failed slots with exactly-once end; healthy subsequent admission;
watcher failure/replacement/stop races. Sixteen health readers→one matching CLI wave; inventory
invalidation during held reads; zero-container 300-task summaries→zero matcher reads. A/B same
task/container/exec IDs, held fetch/mutation/focus, late events/cleanup, reconnect and two viewers
through actual broker/hub/shared producer. Preserve previous artifacts and source hashes. Run
focused owner suites/types/lint, update owning docs, then coordinate native functional log/stats/
terminal transitions and fresh snapshots/screenshots with the coordinator. Short fixture gains
must remain distinct from native latency and final sustained-use proof.

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
