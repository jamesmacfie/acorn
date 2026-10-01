# Unit 04: Cache lifecycle and preference custody

Implemented October 1, 2026 in the cumulative performance worktree. This unit covers findings
06-01 through 06-04 and initial TUI persistence parity. Units 01 through 03 remain intact.

## Ownership and behavior

Node responses flow through the API, broker, and platform transport into one QueryClient per Node.
Core and plugin observers consume that partition, and runtime events invalidate it. The cache remains
a disposable projection; Node-owned preferences remain direct API writes with independent confirmation.

The coordinator reviewed the architecture before implementation. The shared lifecycle belongs to
client-core persistence, beside the fleet-owned QueryClient. Each partition captures its storage
adapter at construction. Fleet memory readers do not restore or persist never-selected partitions.
The desktop acquires a selected lease through `QueryCacheProvider`; the TUI acquires the same owner
before its initial render and releases and flushes it on quit.

The owner uses public TanStack `persistQueryClientRestore` and `dehydrate`, with the desktop's public
`QueryClientProvider` and `IsRestoringProvider` contexts. Concurrent leases share restore; remount
restores again so seven-day offline snapshots remain useful after inactive 24-hour memory GC.
Fresh in-memory data retains TanStack's hydration protection. No snapshot schema or query policy changed.

Query and mutation added, removed, and updated events mark dirty in constant time. Observer-only
events do not trigger capture. One five-second clock coalesces dehydration, serialization, and write,
with one active capture/write and a dirty follow-up. `cache.dehydrate` duration and
`cache.dehydrate.count` measure capture separately from serialization and storage. Labels stay fixed.
The first dirty snapshot waits up to five seconds, replacing the prior immediate first snapshot.
There is no second five-second storage throttle, and preference requests gain no cache-clock delay.

The last lease release keeps listeners through synchronous child cleanup and then unsubscribes.
Already-dirty and in-flight durability survives switching. An unchanged release does not rewrite a
weekend snapshot or advance its timestamp. Inactive fleet updates start no persistence work.
Retirement stops subscriptions and queued captures, fences late reads, drains started writes, and
removes through the original adapter. Same-ID replacement restore and write wait behind retirement.
Writes and deletion share serialization, preserving the TUI adapter's fixed sibling temporary file.

Failed deletion stays a barrier and logs the failure. Repeated explicit removal retries the captured
adapter. `retryCacheRetirement(nodeId)` in fleet is the explicit recovery entry point for a mounted
replacement: retry deletion through that adapter, reacquire public restore, and flush dirty memory.
It rejects deletion, restore, or flush failures to its caller. Selected dirty tracking continues
behind a failed barrier, while reads and writes remain fenced. There is no hot retry loop.
Successful retries release their generation records with identity checks.

A pure WeakMap registers QueryClient ownership. `savePref` captures that owner before its Promise
tail; custom clients capture active selection immediately. Explicit null means captured no target,
so a broker rejects it instead of retargeting; a direct browser retains serving-origin behavior.
Write ordering, confirmed values, and rollback are per QueryClient and key. Startup captures that same
identity for key generation and hydration filtering. Malformed encoded Node prefixes are skipped
without deleting or rewriting raw preferences.

Startup hydrates workspace, view, and pane phases before arming independently owned slice effects.
Registry effects manage membership only. Codecs track deep Solid store reads. Equivalent pending raw
values keep their first deadline; change/revert cancels stale queued work, while reversions behind
in-flight changes remain ordered until acknowledged. Late hydration, disablement preservation,
tombstones, maxBytes, retry eligibility, notices policy, and cleanup flush remain covered.
Device reads use the finite declared key set, with exact ownership, exception fallback, and
localStorage-before-cache notification preserved.

## Changed owners

| Owner | Files | Reason |
| --- | --- | --- |
| Partition and generation | `packages/client-core/src/infra/node/fleet.ts`; `queryOwnership.ts` beside it | Lazy construction, captured adapters, lease composition, retirement barriers, retry, and authoritative preference origin. |
| Shared persistence | `packages/client-core/src/infra/persistence/queryCacheLifecycle.ts`; `QueryCacheProvider.tsx`; `public.ts` | One capture clock, serial writes, public restore/context composition, and mounted lease ownership. |
| Preference lifecycle | `packages/client-core/src/infra/persistence/startupRestore.ts`; `persistedState.ts`; `devicePrefs.ts`; `packages/client-core/src/features/settings/savePref.ts` | Independent slice effects, exact pending/ack handling, captured scoped keys, finite device reads, and per-client confirmation. |
| API target | `packages/client-core/src/infra/node/apiClient.ts` | Undefined remains ambient; null retains captured missing-target semantics. Unit 03 transport edits are preserved. |
| Host composition | `apps/desktop/src/client/index.tsx`; `apps/tui/src/main.tsx`; `apps/tui/src/node/cache.ts` | Hosts use the shared lifecycle; file adapter documents its serial owner. |
| Dependency | `packages/client-core/package.json`; `pnpm-lock.yaml` | Declare the already-installed public persistence core at 5.101.0, with no upgrade. |

Lasting regression tests are beside fleet, lifecycle, provider, startup restore, device prefs,
preference custody, and the TUI file adapter. The TUI boot test drives the production lifecycle;
its cold-client assertion still uses public restore against the real disposable file snapshot.
Owning documentation updated: `docs/caching.md`, `docs/state-ownership.md`, and `docs/tui.md`.
No source file exceeds 400 lines.

## Correctness gates

| Gate | Result |
| --- | --- |
| 3,000 invalidations, 30 same-data updates, same-data fetch | Zero capture traversal in event handlers; one full capture at five seconds; all final rows invalidated. |
| Eligibility and retention | Success gate, failed-refetch removal from snapshot, query removal, same-data structural identity/timestamp advancement, body exclusions, summaries, seven-day restore, one-day entry policy, and 24-hour GC preserved. |
| Mutations and observers | Paused mutation added/update/removal persisted; observer-only changes capture nothing; pending query Promises excluded. |
| Selected leases | Concurrent restore joins; release/remount during a held restore has one subscription; clean release writes nothing; inactive updates do not write; remount restores offline rows after memory clear. |
| Provider composition | Real browser/Solid provider gates queryFn until restore; cached rows publish before held fresh response; unmount before restore settles has no late component publication or idle write; retired late read cannot hydrate or publish. |
| Retirement and adapters | Started write drains before deletion; queued capture canceled; same-ID replacement waits; adapter replacement does not retarget built partitions; never-selected fleet clients remain memory-only. |
| Recovery | Failed removal fences replacement reads/writes; repeated removal and explicit mounted recovery retry original adapter; recovered mounted replacement keeps persisting without restart. |
| Preference custody | Immediate A-to-B selection cannot redirect A save; custom fallback and captured null tested; A/B same-key confirmations, ordering, and failures remain independent; direct-browser origin behavior preserved. |
| Slice effects | Only changed slice serializes; deep mutable codec reads tracked; late plugin hydration before write; no sibling effect recreation; equal pending deadline stable; zero-to-one-to-zero cancels stale write. |
| Preference acknowledgement | Reversion behind held change persists correctly; acknowledgment cannot erase a newer pending value; failed value remains retryable; disposal flush stays on captured Node. |
| Device and slice policy | 5,000 unrelated storage keys are not enumerated; partial storage exception returns empty; observer ordering, tombstones, disabled values, maxBytes, and notices policy preserved. |
| Real TUI adapter and boot | Disposable `/tmp` file restore, switch, retirement, same-ID replacement, modes, atomic write, real supervised Node/pinned-TLS broker boot, and final child drain pass. |

## Paired evidence

Before files are preserved. New probes dynamically select each source root and hash the production
owners. The baseline uses its actual installed public persistence subscriber; the after variant
acquires its actual production lifecycle. The coordinator independently replayed both final probes
and confirmed counts, bytes, and retirement assertions.

Artifacts:

- `04-cache-paired-before-unit04-clean.json` and `04-cache-paired-after-unit04-final.json`.
- `04-prefs-paired-before-unit04-clean.json` and `04-prefs-paired-after-unit04-final.json`.
- `04-cache-custody-before-unit04.json` and `04-cache-custody-after-unit04-final.json`.
- `04-cache-owner-hashes-final.json`, including source parents, descendants, public composition, and dependency metadata for both roots.

The earlier after `clean` artifacts remain. Final source refinements add explicit failed-retirement
recovery, dirty tracking behind the rejected barrier, guarded Node-prefix parsing, and source-comment
clarity. Final probes record those source hashes. Main final hashes are fleet
`79b1c3790d1ac314c38506f817dbb989c95753d930fdcf2b805868eccedcd2f6`, lifecycle
`9c7bba1685bce7cb6bae5012be7ccb46e8bf4da47eccd36cd5ae076e74810723`, and startup restore
`739f34098e49e879759354d347c35514fb54bf4fa5f142708d35e1b04212d162`.

The same workload runs under Node 24.11.0 on macOS arm64 with shared installed external dependencies.
Rows and storage are synthetic. The table reports the 3,000-row workload; raw files retain all sizes.

| Measure | Before | After final |
| --- | ---: | ---: |
| Total production capture scans in burst | 3,032 | 1 |
| Total scans including normal invalidate findAll | 3,033 | 2 |
| Total row visits including findAll | 9,099,000 | 6,000 |
| Same-data update capture scans, 30 updates | 30 | 0 |
| Same-data settled fetch capture scans | 2 | 0 |
| Invalidation turn CPU | 1,641.385 ms | 2.345 ms |
| Invalidation turn elapsed | 1,802.463 ms | 3.151 ms |
| Whole capture-window CPU, including writes and fixed wait | 1,791.524 ms | 137.997 ms |
| Whole capture-window elapsed, including fixed 5.2-second wait | 7,122.515 ms | 6,458.548 ms |
| Snapshot writes | 2 | 1 |
| Final snapshot bytes | 7,886,423 | 7,886,423 |
| Excluded body retained heap, 16 MiB input | 16,822,248 bytes | 16,850,352 bytes |

The full-window CPU sample falls by about 92.3%. This is an owner fixture, not native latency or
all-day stability evidence. It removes repeated allocation work; no allocated-byte profiler was
run. Retained excluded bodies and 24-hour GC are intentionally unchanged. Separate stringify/parse
samples are noisy: final 3,000-row stringify takes 643.636 ms elapsed but 22.054 ms CPU. No stringify
speedup or native latency gain is claimed from those elapsed samples.

Device projection with 20 observers and 2,000 unrelated drafts changes from 40,040 key enumerations
to zero, with 500 direct reads, or 25 declared keys per observer. One transient change in three
1,000-scope slices changes serialization counts from `[1000, 1000, 1000]` to `[1000, 0, 0]`.
Ten equivalent pending raw changes create one timer and zero cancellations instead of 10 timers and
nine cancellations; both send one preference request. The changed slice still serializes all its
scopes to preserve deep/mutable dependencies. No unsupported identity-only memo was added.

The original retirement fixture leaves one row on disk, bypasses the injected adapter, and throws
synchronous ReferenceError because IndexedDB is absent. The changed fixture invokes remove once,
leaves no snapshot immediately or after the window, performs no post-retirement write, and throws
no synchronous storage error. This deliberately changes the assertion to absent snapshot. The
original custody artifact fails all four gates: request targets B, A keeps its rejected optimistic
value, B rolls back to A's confirmation, and reversion writes stale one. The final artifact passes
all four using the same production calls and synthetic transport.

### Exact commands

Validation disables pnpm 11's automatic dependency reinstallation because its offline frozen attempt
aborted before mutation with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. The installed public core
5.101.0 was linked only into client-core's dependency directory. Manifest and lock agree; shared
module directories were not purged. Carry the override during local cumulative commands, or complete
a normal managed install before running them.

```sh
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/client-core exec vitest run src/infra/node/fleet.test.ts src/infra/node/fanout.test.ts src/infra/node/apiClient.test.ts src/infra/persistence/queryPersistence.test.ts src/infra/persistence/queryCacheLifecycle.test.ts src/infra/persistence/QueryCacheProvider.test.tsx src/infra/persistence/startupRestore.integration.test.ts src/infra/persistence/startupRestore.test.tsx src/infra/persistence/appStartup.test.tsx src/infra/persistence/devicePrefs.test.ts src/features/settings/savePref.test.ts src/features/settings/savePrefCustody.test.ts
# Final 12 files / 98 tests passed.
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/tui exec vitest run src/node/cache.test.ts src/node/boot.test.ts src/startupGraph.test.ts
# 3 files / 22 tests passed. First sandbox attempt failed listen EPERM; disposable loopback escalation was automatically approved.
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts
# 2 files / 58 tests passed.
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/client-core exec tsc --noEmit
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/tui exec tsc --noEmit
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/desktop exec tsc --noEmit
# All passed.
rtk proxy pnpm --config.verify-deps-before-run=false exec oxlint packages/client-core/src/infra/node/fleet.ts packages/client-core/src/infra/node/fleet.test.ts packages/client-core/src/infra/node/apiClient.ts packages/client-core/src/infra/node/queryOwnership.ts packages/client-core/src/infra/persistence packages/client-core/src/features/settings/savePref.ts packages/client-core/src/features/settings/savePrefCustody.test.ts apps/tui/src/main.tsx apps/tui/src/node/cache.ts apps/tui/src/node/cache.test.ts apps/tui/src/node/boot.test.ts apps/desktop/src/client/index.tsx
# Passed.
rtk proxy git diff --check
# Passed.
rtk proxy node --expose-gc --conditions=browser --import tsx plans/performance/04-cache-paired-probe.mjs --root=/tmp/acorn-perf-original-f8e4b59c --tag=before-unit04-clean
rtk proxy node --expose-gc --conditions=browser --import tsx plans/performance/04-cache-paired-probe.mjs --tag=after-unit04-final
rtk proxy node --conditions=browser --import tsx plans/performance/04-prefs-paired-probe.mjs --root=/tmp/acorn-perf-original-f8e4b59c --tag=before-unit04-clean
rtk proxy node --conditions=browser --import tsx plans/performance/04-prefs-paired-probe.mjs --tag=after-unit04-final
rtk proxy node --conditions=browser --import tsx plans/performance/04-cache-custody-probe.mjs --root=/tmp/acorn-perf-original-f8e4b59c --tag=before-unit04
rtk proxy node --conditions=browser --import tsx plans/performance/04-cache-custody-probe.mjs --tag=after-unit04-final
# All completed exit 0; baseline correctness gates intentionally record false, final gates record true.
```

## Coordinator review

The coordinator reviewed the lifecycle, fleet generation barriers, explicit-null delivery, per-client
preference confirmation, independently owned slice roots, browser provider tests, real file adapter
and boot gates, and owning documentation. Review refinements preserve unchanged-release behavior,
offline restore after memory GC, failure retry without hot loops, original-adapter recovery, and
malformed scoped-key tolerance. The first snapshot's five-second delay is explicit.

Independent source-selected replays complete with exit zero:
`04-cache-paired-after-unit04-coordinator.json` and `04-prefs-paired-after-unit04-coordinator.json`.
Their final source hashes match the specialist's final artifacts. At all three query counts, same-data
updates and fetches scan nothing, the full burst has one capture plus normal invalidation's findAll,
and one write preserves the final snapshot size and invalidated rows. Preference replay confirms
zero key enumeration, 500 direct reads, codecs `[1000, 0, 0]`, one equivalent-value timer, and no
retired snapshot or late write after the full window. These replays confirm implementation and
counts; the preserved paired samples own the comparative CPU claim.

The focused gates pass, and unit 04 is accepted for cumulative implementation. Native behavior,
complete TUI Node switching, repository gates and sustained-use checks remain open.

The cumulative desktop check catches four plain Node suites importing JSX through the persistence
barrel. The coordinator removes the component from that barrel and gives `QueryCacheProvider.tsx`
its own declared component entry point, matching the existing library export convention. The four
affected suites then pass all 42 tests. The provider and measured cache logic are unchanged. The
updated composition and export hashes are in `04-cache-owner-hashes-component-export.json`; original
paired artifacts and their hashes remain intact.

The next full desktop run passes 123 tests but exceeds the unchanged 1,500 ms boot budget at
2,089 ms during parallel client transformation. An isolated staged boot replay passes all eight
tests. The coordinator bounds desktop Vitest workers at four, preserving the budget; the subsequent
full JavaScript suite passes all 124 tests. The enclosing staging and Rust result is recorded in
the cumulative verification page.

## Remaining dependencies and limits

Unit 05 owns Node-switch eviction order, pane/drawn model scope, Notes save custody, and outgoing Node
terminal cleanup. Same-Node hidden live attachments and xterm reuse retain their established policy. The pure QueryClient ownership and explicit-null target seams are available to
that unit. Unit 27 owns complete active TUI Node provider switching and its two-Node presentation
gate; this unit changes only initial selected TUI persistence and quit durability.

Broad GC, offline body eviction, shared query deadline cancellation, arbitrary data caps, and snapshot
schema changes remain outside scope. The first capture's five-second delay can lose the newest cache
projection on an abrupt process kill, within the established trailing-write window; source-of-truth
preference writes keep their own acknowledgement contract.

No native assets were staged and no normal profiles or paid providers were touched. The disposable
TUI test drained its supervised children and released its data-root lock. All test/probe sessions
finished. Cumulative repository lint/test, fresh desktop staging and boot, native acceptance after
unit 05, and sustained mixed-use verification remain coordinator gates. No native responsiveness
or multi-day stability claim is made here.
