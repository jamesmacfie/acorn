# Cache, persistence, and retained memory audit

Audit of `f8e4b59c`, October 1, 2026. Application source is unchanged. The main measured candidate is to coalesce snapshot capture before dehydration. The five-second storage throttle already limits JSON writes, but full invalidation still builds one whole snapshot per query.

## Scope and owning flow

The Node owns workspaces, projects, tasks, preferences about those resources, plugin records, and immutable blobs. Its core or plugin route supplies a response through the Node API, broker, and platform transport. Client query factories decode that response into the owning Node's `QueryClient`. Query observers project cached values to the shell, rail, settings, PR details, diff, checks, and typed-data consumers. Events invalidate the same Node partition. Transport buffering and cancellation forwarding are area 05's responsibility.

The inspected owners and consumers are:

| Owner | Role and boundary |
| --- | --- |
| `packages/client-core/src/infra/node/fleet.ts` | Lazily constructs one QueryClient and persister per Node, installs error and telemetry subscriptions, selects host storage, and drops a Node. |
| `packages/client-core/src/infra/persistence/queryPersistence.ts` | Defines snapshot restore age, per-entry write age, success eligibility, and body exclusions. |
| `apps/desktop/src/client/index.tsx` | Mounts a keyed `PersistQueryClientProvider` for the active partition; reconnect and status changes invalidate that partition. |
| `apps/tui/src/main.tsx`, `apps/tui/src/node/cache.ts` | Installs file storage before cache construction, restores before rendering, and subscribes for the process lifetime. Files use atomic temporary-file replacement. |
| `packages/client-core/src/infra/queries.ts` | Core query factories, preference selection, and a five-second telemetry-summary poll. |
| `packages/client-core/src/infra/persistence/appStartup.ts`, `startupRestore.ts` | Waits for the cache, fresh-or-settled prefs, and core lists; hydrates slices in workspace/view/panes order, then arms preference writes. |
| `packages/client-core/src/infra/persistence/devicePrefs.ts`, `features/settings/savePref.ts` | Separates device keys from Node keys, optimistically updates the cache, serializes writes per preference key, and rolls back the latest failed attempt. |
| `plugins/github/src/client/queries.ts`, `DiffForPull.tsx`, `checks/ChecksPanel.tsx` | PR summaries, patch and blob body caches, compare results, and full job logs. |
| `plugins/editor/src/client/editorClient.ts`, `editorState.ts`, `openFilesSlice.ts` | Query-caches checkout roots; file content and dirty editor state live in separate owners. The open-files codec excludes dirty flags. |
| `packages/client-core/src/features/dataSources/queries.ts` | Keys response variants by full resolved request, scope, revision, and Node. Separate requests cannot replace one another. |
| `packages/client-core/src/infra/node/fanout.ts` | Warms per-Node caches, reads their last-known values, and subscribes to invalidation with Solid cleanup. Shared-query deadline policy belongs to area 05. |
| `apps/desktop/src/client/scopedEviction.ts`, `features/tasks/archiveLifecycle.ts`, `host/registries/shell/scopeEviction.ts` | Maps completed runtime lifecycle events to feature-state eviction. Task archive leaves the active UI scope before emitting eviction. |

Read contracts: `docs/README.md`, `architecture-overview.md`, `conventions.md`, `caching.md`, `state-ownership.md`, relevant portions of `frontend.md`, `tui.md`, `data-layer.md`, `data-sources.md`, and the browser/fleet proposal in `docs/future/remote.md`. The proposal keeps independent Nodes and the host adapter seam. None of these findings requires a server-owned aggregate cache, cross-Node database, or plugin-to-core import.

### Snapshot capture, write, and restore

At this checkout, TanStack 5.101.0 drives the following path:

1. Its persistence subscriber hears query or mutation `added`, `removed`, or `updated` events. Observer-only events do not save.
2. `persistQueryClientSave` immediately dehydrates the full QueryCache and eligible MutationCache, creates the snapshot timestamp, and hands that snapshot to the persister.
3. Acorn's async storage persister coalesces those already-built snapshots over five seconds. It JSON-stringifies the selected snapshot, samples entries and characters, then calls host storage.
4. Desktop storage is IndexedDB through `idb-keyval`. TUI storage reads one UTF-8 file synchronously before render, then writes asynchronously to a sibling temporary file and renames it over the target.
5. Restore reads and parses one snapshot. TanStack discards an expired, malformed, or mismatched snapshot through `removeClient`, otherwise hydrates it. Desktop query children see `IsRestoringProvider`; TUI awaits restore before mounting the tree.

The snapshot can be seven days old. An entry joins the next snapshot only when its query status is success, its key passes the exclusions, and its `dataUpdatedAt` is within one day. `blob` and `files` except fifth-segment `summary` are excluded. These controls are already implemented at `queryPersistence.ts:9`, `:15`, `:19`, and `:30`. Failed refetches can retain readable in-memory last-known data but fail the success-state persistence gate. Preserve that documented policy when changing event selection.

The one-day GC timer is a different clock: TanStack schedules collection for an inactive query, including one created by imperative `fetchQuery` or `setQueryData`. Its interval is not the wall-clock age of the last response. Restored entries can be older than a day, remain readable in memory, and be omitted from the next snapshot. A request that refetches successfully advances `dataUpdatedAt` even when structural sharing reuses the data object. Treating equal object identity as no durable change would change age semantics.

### Partition and subscription lifetime

`fleet.ts:152` retains clients in a module Map until explicit `dropNode`. Switching Nodes remounts the keyed desktop provider at `index.tsx:149`. The installed provider unsubscribes its query and mutation persistence callbacks on cleanup, but that unsubscribe does not cancel the persister's queued or executing write. The inactive QueryClient and its lightweight telemetry subscriber remain. Focus and online listeners belong to the mounted QueryClient provider, not every retained partition.

Fleet consumers call `clientFor` for every participating Node. A never-selected Node can therefore have a warmed in-memory cache despite having no mounted persistence provider. It has no automatic disk restore or ongoing persistence subscription until it is selected. This is bounded by query GC and client process lifetime; it is also a limitation of last-known fleet rows across a restart, not evidence that every partition should receive eager whole-cache persistence.

`onFleetInvalidation` installs one listener per Node under its Solid effect and removes them on dependency change or disposal. It filters invalidation actions so its own fetch success cannot start a refetch loop. Keep this event contract.

## Relevant history and work already present

- `89482ca9`, September 25, splits seven-day snapshot restore from one-day query age. Its recorded real-host fixture had a 22 KB snapshot, with a hidden window. It fixes weekend restore behavior and must be preserved.
- `efddc3b0` establishes the success gate, query age, body exclusions, and baseline-scoped cache namespace. Recommending those changes again would duplicate shipped work.
- `92983971`, September 3, makes the TUI restore and render through the shared per-Node client and host storage seam.
- The fleet owner already uses a five-second async persister throttle. Changing it from one second to five seconds is not an outstanding fix.
- The desktop status-triggered invalidation already uses `{ cancelRefetch: false }` at `index.tsx:114` to avoid duplicating shell requests. Keep that area 05 behavior.
- Conditional patch hydration and summary prefetch keep most unopened patch bodies out of the cache. `DiffForPull.tsx:63` seeds only the fetched per-path bodies. This audit measures the retained bodies that are actually opened, not an eager full-PR proposal.

## Measurements

Both probes use shipped owners, installed TanStack packages, and synthetic data. They do not read a normal profile or alter the live Tauri session. Environment: macOS arm64, Node 24.11.0. CPU is process CPU, including garbage collection. Timings are one focused run and are not WebKit render latency or a measured full day of use.

Replay from the repository root:

```bash
rtk proxy node --expose-gc --conditions=browser --import tsx plans/performance/06-cache-probe.mjs --tag=sample
rtk proxy node --conditions=browser --import tsx plans/performance/06-prefs-lifecycle-probe.mjs --tag=sample
```

The saved baselines are `06-cache-results-before.json` and `06-prefs-lifecycle-results-before.json`. The scripts default to `sample` and accept a validated `--tag`, so replay does not overwrite `before`. After implementation, update the cache probe to call the production capture scheduler. Re-running the imported library subscriber alone would benchmark the retired path.

### Accumulated partition model

Each entry is a synthetic PR-detail-shaped object with a 2,048-character body. The fixture varies retained query count; it does not claim that 3,000 entries is a measured user session.

| Retained queries | 30 same-object cache updates: predicate visits | Invalidate all: predicate visits | Invalidation wall time | Invalidation CPU | Final JSON bytes | Direct JSON stringify |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 3,000 | 10,000 | 3.19 ms | 5.20 ms | 261,923 | 0.32 ms |
| 1,000 | 30,000 | 1,000,000 | 250.34 ms | 464.04 ms | 2,624,423 | 2.34 ms |
| 3,000 | 90,000 | 9,000,000 | 1,280.46 ms | 1,297.38 ms | 7,886,423 | 5.53 ms |

Each workload produces two final storage writes, despite thousands of intermediate captures. One fetch transition and its same-object success each traverse the whole partition. At 3,000 entries, the 30 same-object updates cost 30.53 ms wall and 63.20 ms CPU. Direct parse of the 7.89 MB JSON takes 6.19 ms. Predicate visit counts, not a hidden window's elapsed frame timing, demonstrate the amplification.

The measurements do not reproduce the supplied Sentry leads: `cache.serialize`, six samples, median 501.5 ms and p95 9,257 ms; `cache.write`, 273 samples, median 216.5 ms and p95 1,376.6 ms. Inspected telemetry lacks release identifiers, and elapsed tails can include suspension. The stringify span covers stringify, not upstream dehydration; the write span covers asynchronous host storage settlement. This checkout's measured traversal problem is independent evidence, not an attribution of those spans.

### Retention and payloads

- Sixty-four unique 256 KiB strings, referenced by 128 blob and patch queries, retain 16,830,096 heap bytes after forced GC. There are zero observers, the query GC interval is 86,400,000 ms, and dehydration persists zero of those queries. Clearing the query cache lowers the retained heap delta to 159,568 bytes. The strings are shared between each blob/patch pair to avoid claiming two full copies where references suffice.
- A synthetic 2 MiB job log and 1 MiB compare patch produce a 3,146,640-byte persisted dehydrated state. This proves eligibility and scale for those shapes, not a measured real GitHub payload distribution.
- Device preference selection with 20 actual QueryObservers and 2,002 synthetic localStorage entries issues 40,040 `Storage.key` calls for one device save, plus 20 value reads. The fake-storage wall time is 1.07 ms; native WebKit storage cost is unmeasured.
- A transient-only change in one of three 1,000-scope slices serializes all 3,000 values and creates no write. Ten changes whose durable queued payload stays equal serialize 30,000 values, create 10 timers, cancel nine, and send one preference request.
- After persistence unsubscribe and `dropNode`, the synthetic removed client has zero queries, but the injected host storage receives no removal. A scheduled trailing snapshot writes again after five seconds with one retained query. In a host without IndexedDB, `del` throws `ReferenceError` synchronously before the attached Promise catch. The probe captures the error type and continues. A real IndexedDB delete/write race was not exercised.

## Prioritized findings and handoffs

### PERF-06-01: Coalesce capture before full-cache dehydration

- Evidence: desktop persistence composition at `apps/desktop/src/client/index.tsx:152`; reachable whole-partition invalidation at `:77` and `:114`; TUI composition at `apps/tui/src/main.tsx:98`; storage-only throttle at `packages/client-core/src/infra/node/fleet.ts:218`. Installed `@tanstack/query-persist-client-core/src/persist.ts:59`, `:122`, `:139`, and `:147` show event selection and immediate dehydration.
- Impact: for N success entries, invalidating N fresh queries causes N captures and N² predicate visits, even with no response changes or visible inactive-query refetches. At 3,000 entries, the synthetic owner spends about 1.3 seconds of CPU in one synchronous invalidation turn before the storage throttle takes effect.
- Effort: M, about one day including scheduler lifecycle and restore tests.
- Risk: medium. Restore ordering, trailing saves, mutation snapshots, and removal behavior are part of the persistence contract.
- Confidence: high. The probe calls the same library subscription and Acorn fleet persister that production composes.
- Fix sketch: give the shared persistence service an O(1) dirty-event handler and coalesce before `persistQueryClientSave` or `dehydrate`. Compose desktop restoration with public `persistQueryClientRestore`, `QueryClientProvider`, and `IsRestoringProvider`, and let the TUI drive the same scheduler. Keep the existing serialized snapshot schema and age policy. Include mutation-cache events rather than optimizing only query reads.

Choose one clock for snapshot capture and serialized writes. Leaving two uncoupled five-second throttles can add ten seconds of durability delay. A small host wrapper around the public TanStack APIs keeps the Node and browser seams intact; a provider copied without its restoration behavior would be risky. A worker or incremental snapshot database is unnecessary for the measured traversal amplification.

Acceptance: invalidate 3,000 fresh queries and count at most one full traversal per configured capture window, then restore the final values and required invalidation state. Cover query success, removal, failed-refetch eligibility, same-data timestamp advancement, paused mutation inclusion, mutation removal, and disposal. `pending` query Promises must remain excluded. Add a bounded `cache.dehydrate` duration/count sample so telemetry can distinguish upstream capture from stringify and write.

### PERF-06-02: Dispose partition persistence before removing storage

- Evidence: `packages/client-core/src/infra/node/fleet.ts:243` deletes the client Map entry and clears queries, while `:253` calls `idb-keyval.del` directly. It bypasses `CacheStorage.removeItem` at `:163` and the persister's storage seam at `:206`. Installed async throttle retains `lastArgs` and scheduled work in `asyncThrottle.ts:16`, `:21`, and `:35` with no cancel method. Desktop removal is emitted before rehoming at `infra/node/fleetActions.ts:61`.
- Impact: a removed inactive partition can finish a trailing write of its pre-removal snapshot. Clearing an active subscribed client can itself queue an empty replacement snapshot. Direct IndexedDB deletion is incompatible with TUI file storage and future browser adapters. Clearing a client also emits one removal event per query, so it can amplify PERF-06-01 during teardown.
- Effort: M, about one day together with the capture scheduler.
- Risk: medium. Ordering must handle both already-started asynchronous writes and queued work.
- Confidence: high for the bypass and surviving queued write; medium for exact real-IndexedDB race timing.
- Fix sketch: store an explicit persistence lifecycle owner beside each NodeCache. Stop its subscription and queued capture, mark its generation retired, finish or fence the already-started write, and remove through that partition's storage adapter. Only then may a replacement owner for the same Node ID write. Removal must win over all writes from the retired generation.

Acceptance: use gated injected storage to hold a write in flight, remove the Node, release the write, and assert the snapshot is absent. Repeat with trailing work, an active provider, an inactive partition, and a same-ID replacement. Verify `removeItem` receives exactly the intended Node key. Keep ordinary switch disposal distinct from explicit removal: switching must preserve useful last-known snapshots.

### PERF-06-03: Give preference slices independent persistence effects

- Evidence: `packages/client-core/src/infra/persistence/startupRestore.ts:108` owns one effect for the registry and every bound value; `:128` serializes every scope of every slice. `:73` compares only confirmed storage; `:79` through `:90` replaces a queued timer even when its pending raw value is equal. `plugins/editor/src/client/openFilesSlice.ts:29` omits dirty flags from codec output, while `editorState.ts:67` changes the bound task map when dirty state changes.
- Impact: changes to an editor task can rerun codecs for unrelated layouts, contexts, filters, dashboards, and notices. Transient dirty state pays durable serialization work. Repeated equivalent queued values churn timers and can postpone an otherwise ready save.
- Effort: M, about one day for per-slice roots, timer comparison, and lifecycle tests.
- Risk: medium. Codecs can read nested mutable Solid proxies. Identity alone is not a valid unchanged-value test.
- Confidence: high for dependency amplification and timer work; the exact task/registry population in a real day remains unmeasured.
- Fix sketch: keep a registry effect that creates and disposes one owned persistence effect per bound slice after hydration. Compare serialized raw against both confirmed and queued values before replacing a timer. Only add per-scope memoization where the owning store has a reliable immutable version or a canonical durable projection; preserve codec dependency tracking otherwise.

Keep late plugin hydration before its first persistence pass, workspace/view/panes order, tombstones for removed scopes, preservation when a plugin is disabled, bounds checks, failure retry, and pending-save flush on cleanup. A changed value that returns to `lastStored` before 500 ms must cancel or replace its stale queued write. The source returns at `:73` before inspecting `queued`, so that reversion case needs characterization before changing timer deduplication. A failed save must remain eligible for a subsequent retry.

Preference writes also need stable originating-Node custody. `savePref.ts:71` defers `setPref` through a Promise tail, and `:15` supplies no explicit Node ID, so delivery reads the ambient active Node. `startupRestore.ts:153` flushes old-shell writes on cleanup after a switch can change that ambient value. Bind the Node and per-Node write state explicitly when implementing this area; do not let an optimization retarget queued work or mix confirmed values between partitions. Cross-Node transport behavior was source-traced but not exercised by the synthetic fetch stub.

Require fail-before correctness cases for these paths. With two online synthetic Node statuses and a transport stub that records target Node IDs, select A, call `savePref(qA, nodeOwnedKey, 'A-value')`, synchronously select B before yielding to the Promise tail, then await the save. The request must target A. Next, seed different confirmed values under the same preference key in qA and qB, start overlapping writes, reject one, and assert each rollback uses its own QueryClient's confirmed value. A `WeakMap<QueryClient, Map<key, PrefWriteState>>` or an explicit partition-owned writer can preserve per-key ordering while separating confirmation state. For the debounce reversion case, seed durable value 0, change the binding to 1 and back to 0 before 500 ms, advance the timer, and assert no stale 1 write remains. These are prerequisites for the preference optimization, not optional after-fix testing.

Acceptance: the three-slice probe should serialize only the changed slice. Test a codec whose output excludes a transient field, repeated equal queued values, change/revert before flush, tombstones, late registration, disable/re-enable, write failure, and disposal flush. A Node switch while a prior key has an unresolved save must keep each request, optimistic rollback, and acknowledgment with its original partition.

### PERF-06-04: Read declared device keys directly

- Evidence: `packages/client-core/src/infra/persistence/devicePrefs.ts:4` already declares the finite device-key set; `:58` enumerates every localStorage key for every read. `infra/queries.ts:115` calls the projection independently for preference observers. `features/settings/savePref.ts:55` correctly writes localStorage before notifying the cache.
- Impact: device preference projection scales with unrelated draft/recovery storage multiplied by observer count. The synthetic one-save case issues 40,040 key enumerations despite only one relevant device preference.
- Effort: S, a few hours including storage-unavailable and ordering tests.
- Risk: low. Direct reads can preserve every declared key and the same fallback behavior.
- Confidence: high for the operation count; native storage elapsed cost remains unmeasured.
- Fix sketch: iterate `DEVICE_KEYS` and call `getItem(PREFIX + key)` instead of scanning storage. Preserve exact-key ownership, exception handling, and the localStorage-before-cache ordering. This avoids stale memoization and a cross-window invalidation mechanism.

Acceptance: add thousands of unrelated draft keys and verify device read operations stay proportional to the declared device set; existing device ownership and observer update tests must still pass. Do not indiscriminately delete unrelated keys to make the scan cheaper.

### PERF-06-05: Separate reconstructable body retention from offline snapshots

- Evidence: `fleet.ts:194` applies 24-hour GC globally. GitHub `queries.ts:121`, `:140`, and `:177` do not override it for full file lists, per-path patches, or immutable blobs. `DiffForPull.tsx:66` seeds patches directly with `setQueryData`; `:71` fetches blobs imperatively. `queryPersistence.ts:19` excludes these bodies only at dehydration.
- Impact: opened bodies remain in inactive query memory for a day and increase every whole-cache scan, although none supplies offline snapshot data. The synthetic body fixture retains about 16.8 MB after all observers leave. This is a measured lifetime, not proof that the application leaks memory without bound over multiple days.
- Effort: M to establish a body-only retention policy and route every seed/fetch through it; larger if a byte budget is required.
- Risk: medium. Repeated navigation and gap expansion depend on reuse, and active consumers must keep their bodies.
- Confidence: high for the owner and retained heap; medium that a shorter or byte-bounded policy is worth its navigation cost on representative sessions.
- Fix sketch: characterize a plugin-owned body budget or shorter inactivity lifetime for excluded, immutable/read-only keys. Keep ordinary summaries and offline rows at their existing policy. Apply it before each query is first constructed, including direct patch seeds; TanStack retains the maximum GC interval a query has seen, so lowering options after a 24-hour default query already exists is insufficient.

Do not evict active observers, parsed diff data needed by the mounted view, unsaved editors, editor undo, drafts, pending mutations, or authoring recovery copies. Query-key-only body policies cannot account for those separate owners. Compare repeated warm navigation and immutable blob-cache refetch cost before choosing any interval. This candidate can follow the capture fix; PERF-06-01 removes CPU amplification without changing retention.

## Large-data and cleanup decisions

`job-log` and `compare` are eligible for persistence because the exclusion only names `files` and `blob`. The source confirms they can carry full text: `plugins/github/src/server/routes/checks/actions.ts:45` reads the complete job log without an Acorn byte ceiling, and `routes/pulls/prCreate.ts:96` maps provider compare patches. `queries.ts:198` trusts a job log indefinitely within the query's lifetime. `ChecksPanel.tsx:53` fetches lazily only when a step opens, then uses that one log for all steps.

Do not blindly add these prefixes to the exclusion. The checks server explicitly delegates reuse to the client and has no Node mirror or immutable BLOBS record for logs. Offline log inspection would disappear. Compare has a potentially useful preview, although branch-pair keys can change underneath their bodies. A later owner-specific plan can separate summary metadata from persisted large text, keep logs in a bounded Node blob owner, or define an explicit offline body budget. It needs realistic payload-size evidence and a product decision about offline usefulness. The two-key synthetic byte count is enough to identify the handoff, not enough to pick a byte cap.

Typed-data responses have their own Node budgets: at most 5,000 records or 16 MiB per execution, 256 KiB per record, and 1 MiB per detail, with preview capped at 25 records. A full request/revision key protects correctness but each visited variant can become another retained query. There is no whole-partition byte budget. Do not replace those full keys with a coarser key, drop successful offline rows, or weaken completeness to reduce cache size.

Task archive evicts module state through registered owners and disposes held pane models on desktop. It does not remove task-specific QueryCache entries. Small examples are `['run-targets', taskId]`, `['editor', 'root', taskId]`, and `['task-pulls', taskId]`; they remain until GC. PR and blob keys may be shared by several tasks or browse views, so broad string matching on a task ID is unsafe. If explicit read-cache cleanup is added, put each task-only key predicate beside its factory and register it through the scope seam. Remove only after archive succeeds and component cleanup completes. Area 08 should own any general lifecycle expansion.

No TUI source mapping from `runtime:task-archived`, `runtime:node-removed`, or `runtime:node-switched` to `evictScope` was found; desktop has that composition in `scopedEviction.ts`. Treat TUI lifecycle parity as an ownership handoff, not permission to make a second disposal registry.

Cancellation is already query-consumer-specific. Core and GitHub observed query factories consume `signal`; TanStack cancels when their last observer leaves. The probe confirms signal consumption aborts and prevents its answer from entering the cache, whereas a function that never reads signal finishes and warms the cache after unsubscribe. Imperative blob `fetchQuery` has no observer disposal to own cancellation, and fetched immutable data can still be useful. Diff patch hydration already aborts its own controller and rejects stale generations on dispose at `kit/diff/hydration.ts:243`. Preserve area 05's established rule that a fleet deadline must not cancel a shared QueryObserver query.

## Verification and limits

After implementing selected findings, run `rtk pnpm lint` and the relevant focused suites. Suitable gates include client-core fleet, queryPersistence, startupRestore, appStartup, devicePrefs, savePref, and fanout suites; GitHub diff/cache tests if body lifetime changes; and TUI cache/boot tests if storage or shared subscription composition changes. Use `rtk pnpm test` for the bounded full suite when requested by the coordinator. The coordinator reports that baseline lint and the bounded suite already pass; this source-read-only audit does not repeat them.

Test desktop integration in the real isolated Tauri window after the scheduler change: restore last-known offline tasks and preferences, switch Nodes with identical resource IDs, reconnect after accumulation, remove a Node with a pending save, reopen the app, and verify the selected partition and final data. Run a visible-window measurement for interaction elapsed time. The inspected live `perf-baseline` session remains hidden/unfocused, and its process subtree can contain provider work, so it is not a quiet CPU or visible-latency baseline. No live session mutation was needed here.

Unmeasured: native IndexedDB throughput/quota, native WebKit localStorage cost, a full day of user cache growth, real large-log distribution, persistence across process termination inside a five-second window, real IndexedDB deletion races, and browser/mobile suspension behavior. TUI synchronous restore timing is represented by parse size and source ownership, not a disk benchmark. These gaps do not weaken the deterministic N² traversal or operation-count findings.

Rejected approaches: shortening all GC to five minutes, reducing seven-day restore age, dropping successful snapshots, eager persistence on every inactive fleet Node, cancelling shared fleet queries at a caller deadline, identity-only codec memoization, ignoring mutation-cache events, and adding a worker before fixing event amplification. Each would either weaken a documented behavior or introduce a larger boundary change than the measured problem requires.
