# Unit 06 — client plugin lifetime and mounted authority

Status: implemented; source and evidence prepared for coordinator review. Native desktop staging, the cumulative desktop/Rust gate, and the final repeated-use gate remain coordinator work. This record covers unit 06 only.

## Context and accepted scope

Read the engineering guide, RTK instructions, docs index, architecture/conventions, plugin descriptor/security/authoring, shell, TUI, HTTP, state ownership and future documentation; the implementation contract/plan, unit06 review brief, reports03 and16, and accepted units02–05 records. Git history and prior shipped performance changes supplied context. No performance claim here comes from historical Sentry traces; older traces could precede shipped fixes.

The client plugin path is installed declarations → frame/tree/chrome registries → registered layout or inline consumer → captured provider QueryClient/Node → frame services/broker → capability-scoped Node plugin API. A tree module executes in a browser worker or permission-restricted TUI Node worker, with a tree channel for render traffic and a frame bridge for API/cache/document/UI requests. The old module worker retained the first component's services and supplied them to every tree. That coupled warm module lifetime to a view's authority and could keep a retired view alive. Frame load handlers and SDK callback registries had separate lifetime defects.

The accepted changes repair these owners, preserve plugin/runtime/capability/auth/custody/portability boundaries, and avoid making draft recovery or future document work depend on global mutable authority. Persisted schemas, grants and Node endpoints retain their existing contracts. Modern module reuse and legacy compatibility have explicit different costs.

## Changes and source ownership

The exact32 production files and hashes are in [the final v3 manifest](evidence/unit06-final-source-manifest-v3.json). The preserved [v1 manifest](evidence/unit06-final-source-manifest.json) records the earlier freeze. Later production deltas are comments/formatting and a type-only Owner alias; runtime SDK probe bundle hashes were rebuilt and are unchanged. Fixture changes and evidence provenance are listed separately in v2/v3. V3 preserves v2 and records the final removal of frame trailing whitespace and an extra database-client EOF blank line.

| Area | Source | Change |
| --- | --- | --- |
| Frame transactions | `packages/client-core/src/host/frames/PluginFrame.tsx`, `broker.ts` | A frame load explicitly owns its bridge, channel, handshake timer and external subscriptions. Disposers are registered immediately, run independently even when one throws, and retire by load generation. A held old error/timer cannot close a replacement load. Original setup failures remain visible. |
| Remote callback lifetime | `remoteRoot.ts` | Only attached references hold handlers strongly; reference counts release detached/replaced handlers, stable IDs are weakly indexed, same-root moves preserve handlers and root disposal clears all. |
| Contribution reconciliation | `host/plugins/registrationSnapshot.ts`, `syncContributions.ts`, `frames/register.ts`, `chrome/chromeRegister.ts`, `surfaceFailures.ts`, `registries/extensionPoints/exclusiveSlots.ts` | Canonical declaration/trust/hash snapshots skip equivalent successful registration. All affected old registrations retire before changed replacements. Failed collisions still retry, rendered exclusive-provider failure retries only its plugin, and healthy unrelated providers retain identity. Installed source/bundled/date/client-byte metadata does not cause declaration churn. |
| Layout origin/intent | `frames/register.ts`, `registries/commands/clientEvents.ts`, `tree/table.ts` | Provider QueryClient Node is captured at construction, including explicit null. Opening plugin selection is consumed once per matching shared layout and passed consistently to regions. Routed current selection and live selection updates remain reactive. Real document grants remain only on document layouts. |
| Captured tree services | `tree/bridgeFactory.ts`, `bridgeAuthority.ts`, `public.ts`, desktop/TUI `RemoteTree.tsx` | Framework-free factories capture origin/permissions and individual focus. Immutable model/grant identity is distinct from complete legacy affinity. Document accessor generations fence revoked handles permanently and clear a retired bridge's local accessor. Actual DocumentSurface publication eagerly advances the generation. |
| Worker/slot owner | `tree/workerHost.ts` | Modern shared modules, separate mounted-slot bridges, legacy authority owners, early admission, bounded hint/idle pools, transactional construction and generation-safe stop/request completion. Latest pre-ready props replace pending state rather than accumulate messages. |
| SDK/protocol | `frames/sdk.ts`, `plugin-sdk/src/public.ts`, `protocol/src/plugin/bridge.ts`, `protocol/src/tree/messages.ts` | Additive per-mounted-slot capability and optional transferred bridge. Modern bootstrap has metadata without privileged services; draw receives its own bridge. Pending requests/listeners/ports/tree root retire with the slot. New SDK on an old host explicitly uses legacy semantics. |
| Native TUI worker | `apps/tui/src/plugins/workerFactory.ts`, `pluginWorker.js` | Drain stdout/stderr without screen output; retain exactly the initial hello across awaited module startup; release/restore observers at settlement or deadline; observe asynchronous thread termination before same-hash replacement; cancel deferred construction without spawning. |
| First-party clients/models | HTTP `httpClient.ts`, `panelModel.ts`, `app.tsx`, `HttpDetail.tsx`, `HttpVariables.tsx`; database `databaseClient.ts`, `DatabasePanel.tsx`, `GenerateSqlModal.tsx`, `SaveQueryModal.tsx` | Construct clients with the region's API rather than call global connect per operation. HTTP equivalent model state shares live leases; mutation/copy closures belong to the invoking region. Retired shared idempotent reads can continue through an equivalent live lease; mutations are never replayed. |

The larger workerHost owner remains one module because admission, capability classification, authority promotion, slot ownership and stop transactions share invariants. The new factory/key files keep framework construction and immutable authority identity out of that state machine. No general plugin fallback or capability bypass was introduced.

## SDK compatibility and bounded ownership

Bridge/tree protocol versions remain1. The connected acknowledgement advertises `treeSlotBridge:1`, and modern tree mount messages may transfer a per-slot bridge. `TreeRender(bridge, mount)` already supplies the constructor seam. Metadata is available to module-scope `connect().context`; privileged bootstrap services are denied on a repaired modern host.

| SDK / host | Behaviour |
| --- | --- |
| Updated / repaired | One module worker per hash; bootstrap mode has first immutable metadata and no view privilege. Every mounted slot receives mode `mount`, its own context.item, API/cache/document/focus and retirement. |
| Legacy / repaired | The detection worker evaluates once. Existing connected acknowledgement, or an API request before that acknowledgement, promotes the same worker to its immutable legacy authority. Awaited module-scope connect/API remains usable and executes at most once per admitted legacy context. |
| Updated / older | Operates in mode `legacy` with a warning. Usable existing surfaces retain the older host's first-context/global semantics; the SDK does not claim safe per-slot ownership. |
| Legacy / older | Unchanged old semantics. The before evidence demonstrates the existing first-context problem; repaired host behaviour requires the repaired host. |

Complete legacy affinity includes bundle/plugin/version, immutable QueryClient and Node, surface/target, task/project, effective API/events/panes/destinations/hosts/claimsKeys, conservative document accessor plus grant generation, and immutable initial item. Equal task/project IDs or document URI do not prove equivalent grants. Equivalent live slots share a context owner and focus union. Retiring the first lease releases its focus/accessor references; a sibling continues through its own production services. Once the last legacy lease retires, its worker terminates immediately because an old SDK cannot safely drop/reconnect its global bridge.

Modern `context.authority` is an opaque model/grant equivalence key, excludes one-shot opening item, and grants nothing by itself. Full legacy sharing affinity adds initial item. This permits ordinary HTTP list/detail regions to share draft/selection state while every modern per-region action still uses its own bridge. A document grant that is initially null may become ready once. After admission, null/replacement permanently retires older bridge generations; even returning the same handle object cannot revive them. A new region gets the new generation.

| Owner | Bound and retirement |
| --- | --- |
| Bundle slot admission |512 total live slots/early reserved leases per bundle across authority contexts; reservations release on failure/release. Additional slots on a handle debit the same budget. |
| Modern active workers | One per active bundle hash. No artificial global active-bundle cap added. |
| Modern idle modules | Maximum16 bundle hashes,30second grace; oldest idle evicted, active workers untouched, warm recent remount/reactivation preserved. |
| Legacy active workers | One per distinct immutable live authority context; worst case512 distinct contexts for a bundle. This is a visible compatibility cost, not a memory/CPU improvement claim. |
| Legacy idle workers | Zero. Last authority lease terminates immediately. |
| Capability hints |256 hashes in a process-local cache. Eviction only repeats classification; a live exact owner is consulted first and is not disturbed by hint eviction. |
| Unclassified detector | Owns an admitted lease. A retired first authority cannot promote its services. A surviving context may replace the detector without global rebinding. |
| Native same-hash retirement | New adapter waits for actual retired thread settlement; canceled deferred owners never spawn. Existing live foreign legacy contexts continue. The100-rotation actual-native proof keeps one old native detector during held termination and admits one replacement after it exits. This is not a universal two-thread bound across all512 independent live legacy contexts. |
| Startup/pre-ready traffic | One initial hello/its transferred handles; latest props per slot, no general queued traffic. Bootstrap claim expires10s with a host-visible failure. Existing worker-host startup/heartbeat ownership retires after two10s beats; late readiness/error cannot affect a newer owner. |

Old bundled remoteRoot code can still retain callbacks inside its surviving module. Repairing the host cannot edit those SDK bytes; rebuilding a plugin with the new SDK repairs its internal handler lifetime. Legacy workers dropping at the last lease limits their idle retention, at the cost of losing warm legacy reuse.

## Fresh measurements and observations

No coordinator builds, native sessions or other probes ran during these comparisons. Before source is preserved under `/tmp/acorn-perf-unit06-before`, with original source hashes in [the before manifest](evidence/unit06-before-source-hashes.json). Legacy built SDK bytes were copied before any disposable build and are listed in [the legacy manifest](evidence/unit06-legacy-sdk-hashes.json). The snapshot uses current installed dependencies/accepted prior-unit support; selected unit06 ownership sources are reverted. The before TUI factory's custody import was rewritten to the current absolute source so the recorder seam resolves; this fixture transform is distinct from the original source hash.

Browser component fixtures resolve exact installed Solid and Tanstack ESM files, construct ordinary QueryClientProvider roots, and verify Solid/web createComponent identity. TUI uses its actual universal cell renderer and ordinary provider. Neither browser fixture substitutes useQueryClient. API transport is an origin recorder; production frameServices, broker, SDK, host and permission-scoped native worker execute. These are source composition tests in jsdom/universal environments, not a Tauri window measurement or browser Worker measurement.

### Frame and registration work

| Matched workload | Before | After |
| --- | --- | --- |
|40 frame open/dispose cycles |40 provider construction/cleanup;0 owned host bridge endpoints closed;0 webview stub detaches;120 retired-frame pushes from one action/core event/appearance;40 missing-owner cleanup warnings |40 construction/cleanup;40 host endpoints closed;40 webview stub detaches;0 retired pushes/warnings |
|20 loaded plugins, each of10 unchanged syncs |40 registry observer runs,20 list mounts and20 unmounts on every sync; observer sees empty roster |0 observer runs/mounts/unmounts; no empty roster |
| Registration CPU per unchanged sync, median of10 |3,280.5µs user+system |382µs |
| Registration elapsed per unchanged sync, median of10 |1.739ms |0.329ms |

Sources: [frame before](evidence/client-frame-lifetime-unit06-provider-final-before.json), [frame after](evidence/client-frame-lifetime-unit06-provider-final-after.json), [registration before](evidence/client-registration-unit06-provider-final-before.json), [registration after](evidence/client-registration-unit06-provider-final-after.json). The dispatched iframe load callback has no Solid owner in both runs, making explicit lifetime ownership necessary even with correct provider construction. The frame fixture observes native-webview subscription stubs, not actual child webview handles. CPU/elapsed values are a short single matched microbenchmark, not application-wide percentages, startup speed, INP or p95. The before final pass has a10.44ms outlier; removed mounts/observers are the stronger evidence.

### Remote callbacks and synthetic heap

The forced-GC workload removes10,000 nodes or replaces10,000 handlers. Each handler captures512 synthetic numbers; WeakRef observation arrays contribute their own bookkeeping.

|10,000 changes | Before retained synthetic payloads / heap growth | After retained synthetic payloads / heap growth |
| --- | --- | --- |
| Removed node |10,000 /45,091,104B |1 current loop payload /805,864B |
| Replaced handler |10,000 /44,861,528B |1 current loop payload /558,320B |

Old handlers dispatch after detachment before, and do not after. Final root disposal plus GC leaves0 payloads in both final runs. After-dispose heap includes WeakRef/fixture bookkeeping, so it does not measure application residual growth or a new callback leak. Earlier runs whose current fixture closure left one payload are preserved; the final pair supersedes their after-dispose claim. See [before](evidence/client-remote-handlers-unit06-final-before.json) and [after](evidence/client-remote-handlers-unit06-final-after.json).

### Actual host, SDK and native worker matrix

A module's tree port and bootstrap bridge use two host-owned port1 endpoints. Every modern mounted slot adds one bridge host endpoint. The numbers below count **explicit close calls on host-owned port1**, before final pool stop; they do not count SDK-adopted receiving endpoints. Original transferred port2 objects have0 explicit close calls in these probes; the SDK peer-close lasting test separately verifies adopted endpoint retirement. The two remaining modern endpoints belong to the warm authority-free module and are closed by the finally pool stop.

| Composition | Construction/cleanup | Native workers | Channels / host port1 closes before pool stop | Result |
| --- | --- | --- | --- | --- |
| Before desktop, legacy SDK, A/B same entity IDs |2/2 |1 |2/0 | B reads Node A/cache A/document A; first retired grant remains usable, sibling focus fails. |
| Repaired desktop, modern SDK, two documents, held A operation,100 warm remounts |102/102 |1 |104/102 | B uses its own Node/QC/document/focus; A aborts/rejects on retirement; revoked document denied; recent remount reuses module. |
| Repaired desktop, legacy SDK, two distinct document/Node contexts |2/2 |2 |4/4 | Each context reads/writes its own document and API; top-level API once per context; both workers terminate at last lease. |
| Updated SDK on before host |2/2 |1 |2/0 | Mode legacy/warning; usable old behaviour explicitly retains first-context limitations. |
| Repaired actual TUI RemoteTree/cell renderer, modern SDK, two documents, held A,5 warm remounts |7/7 |1 |9/7 | Origin/cache/document/retirement/revocation match modern desktop. Focus/navigation exercised in desktop case only. |
| Repaired desktop, equivalent legacy siblings, first lease disposed,3 later remounts |5/5 |4 total, all retired | Not instrumented in this earlier final fixture | Surviving sibling retains API/document/focus; top-level API once per admitted context. No legacy idle reuse. |

Sources: `evidence/unit06-owner-before-legacy-ports-final.json`, `unit06-owner-desktop-modern-ports-final.json`, `unit06-owner-legacy-distinct-ports-final.json`, `unit06-owner-new-sdk-old-host-ports-final.json`, `unit06-owner-tui-modern-ports-final.json`, `unit06-owner-legacy-equivalent-await-final.json`. Modern module-scope privileged calls are denied (0 transport calls); legacy module-scope await connect/API executes once on each admitted context. All cases use genuine module-level await in the final probe bundle.

### Startup and stdout/stderr

The independently reproduced cold-start failure uses the original native bootstrap, an ordinary actual worker factory with no listening barrier, a generic message listener, and a200ms module delay followed by true top-level await connect/API. Before: the module reports its generic listener and SDK listening, but the initial hello was already lost;0 API calls and the fixture8s deadline expires. After: the retained initial hello reaches the SDK and the same delayed legacy bundle completes (the548ms test completion includes fixture work). Ordinary no-barrier cold modern/legacy owner runs also pass. This removes a startup hang; it is not a general548ms startup benchmark. See `unit06-owner-delayed-await-before-final.json` and `unit06-owner-delayed-await-after-final.json`.

The retained hello is only startup traffic. Arbitrary earlier listeners cannot consume its sole ownership. Observers restore on adoption, import success/rejection and deadline. Expiry closes both unadopted transferred endpoints and fails visibly; adopted endpoints are not closed by releasing the bootstrap retention. Actual native tests cover all of those paths.

A separate matched actual factory writes19,922,944 stdout/stderr characters with backpressure. Before it has not completed at1.5s, stdout contains155,648 buffered bytes and flowing is null. After it completes by the same1.5s checkpoint, both streams flow, buffer length0 and data-listener count0. No output is appended to screen/transcript. This removes stalled output and repeated retention; it is not a general startup-speed estimate. See [before](evidence/unit06-noisy-factory-before.json) and [after](evidence/unit06-noisy-factory-after.json).

## Lasting verification

| Gate | Result |
| --- | --- |
| Client frame/tree/plugin plus chrome suites |36 files,416 tests pass |
| TUI plugin suites |3 files,16 tests pass, including6 actual factory cases and100 held-detection rotations |
| HTTP tree suites |4 files,14 tests pass (10 model cases) |
| Database tree suites |3 files,10 tests pass |
| Architecture suite |5 files,67 tests pass on final isolated rerun; concurrent TUI/arch rerun hit one parser5s timeout, then isolated pass |
| Relevant6-package TypeScript/lint |6/6 pass before final fixture type cleanup |
| Full `pnpm lint` |Pass: oxlint0 errors (existing warnings),34/34 Turbo package type tasks successful;35 packages in scope |

Meaningful owner gates include actual DocumentSurface/editor handle lifecycle with production frame services; delayed initial grant, null/replacement and same handle return; registered lazy region provider origin after ambient Node change; initial shared opening selection/list/detail state; per-region held action while first/list retires; held saved/adhoc shared reads through surviving detail; warm model releasing bridges; equal IDs across distinct grants; 257 retired hash hints with a live legacy context surviving eviction;16-idle eviction/reactivation;512 admission release/failure/extra-slot reuse;1000 pre-ready prop replacements; late old-generation error/host request/timer; startup worker/channel/bridge/transfer failures and throwing cleanup; per-slot pending API/host waits, stale events and adopted-port closure; new SDK/old host warning.

The focused100-rotation test uses the production broker with a typed API-only recorder, not production frameServices. Actual composed owner probes and the editor test exercise production frameServices separately. Native termination cases use real Node Worker objects, delayed settlement and termination rejection. Native output fixture drains a real noisy thread.

### Commands

All commands use RTK. Set `ACORN_PERF_TAG` to a fresh name: evidence writers refuse overwrite (`wx`). These are the exact command shapes used; the evidence matrix below supplies the final environment values. Paths are relative to repository root unless shown absolute.

```sh
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/client-core exec vitest run src/host/frames src/host/tree src/host/plugins src/host/chrome/chromeRegister.test.ts
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/tui exec vitest run src/plugins
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/plugin-http exec vitest run src/tree
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/plugin-database exec vitest run src/tree
rtk proxy pnpm --config.verify-deps-before-run=false --filter @acorn/arch-tests test
rtk proxy pnpm --config.verify-deps-before-run=false exec turbo run lint --filter=@acorn/client-core --filter=@acorn/tui --filter=@acorn/plugin-http --filter=@acorn/plugin-database --filter=acorn-plugin-sdk --filter=@acorn/protocol --concurrency=4
rtk proxy pnpm --config.verify-deps-before-run=false lint
rtk proxy env ACORN_PERF_SDK=modern pnpm --config.verify-deps-before-run=false --filter acorn-plugin-sdk exec vite build --config ../../plans/performance/unit06-sdk.config.ts
rtk proxy env ACORN_PERF_SDK=legacy pnpm --config.verify-deps-before-run=false --filter acorn-plugin-sdk exec vite build --config ../../plans/performance/unit06-sdk.config.ts
rtk proxy env ACORN_PERF_SDK=legacy ACORN_PERF_DELAY=200 pnpm --config.verify-deps-before-run=false --filter acorn-plugin-sdk exec vite build --config ../../plans/performance/unit06-sdk.config.ts
rtk proxy env ACORN_PERF_OWNER=before ACORN_PERF_TAG=unit06-provider-final-before pnpm --config.verify-deps-before-run=false exec vitest run --config plans/performance/unit06-resource.config.ts
rtk proxy env ACORN_PERF_OWNER=after ACORN_PERF_TAG=unit06-provider-final-after pnpm --config.verify-deps-before-run=false exec vitest run --config plans/performance/unit06-resource.config.ts
rtk proxy env ACORN_PERF_REMOTE_ROOT=/tmp/acorn-perf-unit06-before/packages/client-core/src/host/frames/remoteRoot.ts node --expose-gc --import tsx plans/performance/bench-client-remote-handlers.mjs plans/performance/evidence/client-remote-handlers-unit06-final-before.json
rtk proxy node --expose-gc --import tsx plans/performance/bench-client-remote-handlers.mjs plans/performance/evidence/client-remote-handlers-unit06-final-after.json
rtk proxy env ACORN_PERF_OWNER=before pnpm --config.verify-deps-before-run=false exec vitest run --config plans/performance/unit06-noisy.config.ts
rtk proxy env ACORN_PERF_OWNER=after pnpm --config.verify-deps-before-run=false exec vitest run --config plans/performance/unit06-noisy.config.ts
```

For desktop owner matrix run `rtk proxy env <environment> pnpm --config.verify-deps-before-run=false exec vitest run --config plans/performance/unit06-owner.config.ts`. For TUI use `unit06-tui-owner.config.mts`. The original `.ts` attempt importing the TUI config failed during config evaluation (`import.meta.resolve` under CJS); no workload results came from that attempt.

| Final tag | Environment in addition to tag |
| --- | --- |
| before-legacy-ports-final | `ACORN_PERF_OWNER=before ACORN_PERF_SDK=legacy` (listening barrier defaults on) |
| desktop-modern-ports-final | `ACORN_PERF_OWNER=after ACORN_PERF_SDK=modern ACORN_PERF_BARRIER=0 ACORN_PERF_DOCUMENTS=both ACORN_PERF_HELD=1 ACORN_PERF_WARM=100` |
| legacy-distinct-ports-final | `ACORN_PERF_OWNER=after ACORN_PERF_SDK=legacy ACORN_PERF_BARRIER=0 ACORN_PERF_DOCUMENTS=both` |
| new-sdk-old-host-ports-final | `ACORN_PERF_OWNER=before ACORN_PERF_SDK=modern` (listening barrier defaults on) |
| tui-modern-ports-final | `ACORN_PERF_OWNER=after ACORN_PERF_SDK=modern ACORN_PERF_BARRIER=0 ACORN_PERF_DOCUMENTS=both ACORN_PERF_HELD=1 ACORN_PERF_WARM=5` |
| legacy-equivalent-await-final | `ACORN_PERF_OWNER=after ACORN_PERF_SDK=legacy ACORN_PERF_BARRIER=0 ACORN_PERF_EQUIVALENT=1 ACORN_PERF_WARM=3` |
| delayed-await-before-final | `ACORN_PERF_OWNER=before ACORN_PERF_SDK=legacy ACORN_PERF_DELAY=200 ACORN_PERF_BARRIER=0 ACORN_PERF_EXPECT_STARTUP_FAILURE=1` |
| delayed-await-after-final | `ACORN_PERF_OWNER=after ACORN_PERF_SDK=legacy ACORN_PERF_DELAY=200 ACORN_PERF_BARRIER=0` |

The before topology cases deliberately use a listening barrier to measure ownership after startup; they do not establish cold-start correctness. The no-barrier delayed reproduction and modern/legacy after cases establish startup separately. Root full suite, desktop stage and native gate were not run by this child agent.

## Excluded and superseded evidence

- Earlier area03/16 directory aliases selected Tanstack CJS plus a second Solid runtime. Those provider identity/construction claims are invalid; existing artifacts remain preserved. Fresh normal-provider explicit-ESM results above supersede them. Earlier useQueryClient stubs only reproduce resource ownership and do not prove production provider composition.
- Builtin Worker vi.mock interception failed to observe actual thread hello. Those failed runs do not justify the bootstrap shim or claim a speed gain. The independent preserved-byte/no-barrier delayed case does justify it.
- A Vite-transformed `new URL` output path wrote a frame result to `plans/performance/undefined`; it is preserved as `evidence/unit06-provider-excluded-vite-url-frame.json`. Fresh absolute fileURLToPath/resolve writers supersede it.
- Probe SDK prototype entries before the final true module-scope await merely scheduled a callback. Historical source-final artifacts are not paired with final bundle hashes and do not prove awaited top-level connect/API compatibility.
- Initial tightened SDK peer-close tests left a native receiving host endpoint unread. Node delayed closure notification behind unread messages. Consuming incoming ack/API fixed the fixture; no speculative production port change was made.
- Broad client tests initially used full workerHost mocks that omitted new pure key exports. Partial original mocks fixed17 fixture failures; the final416 tests pass.
- Architecture checks caught a private cross-package API mock and a type alias whose literal `context` tripped the plugin-name rule. The native rotation fixture now uses the public production broker with API recorder; Owner is an equivalent Omit type. No boundary exception was added.
- Initial full lint caught an unused unit03 probe binding. Root preserved pre-lint bytes/hash in `unit03-paired-probe-pre-unit06-lint-source.txt` and recorded the unchanged workload/import-binding removal in `unit03-paired-probe-unit06-lint-change.json`; no unit03 measured gains were changed. The next lint attempt caught two new rotation fixture type errors, corrected with complete typed recorder services and required failure callback.

## Trade-offs, future compatibility and remaining gates

Modern slots add one small bridge/channel per live tree while retaining one shared module worker. This trades a measured bounded per-slot owner for correct independently retireable authority and avoids first-view retention. Legacy independent contexts may use more workers and repeat module startup after last-lease retirement; explicit affinity and512 admission keep that compatibility cost finite. Modern idle16/30s is a chosen resource bound; heavier workloads may need telemetry-informed tuning, but active modules are preserved.

The host does not repair all concurrent cross-Node presentation events. Pending pane intents are taskId/paneId scoped, and pluginChannel subscriptions globally route selected-Node plugin frames without a Node parameter. Proof here covers captured API/cache/document/focus authority and retirement. Event-bus origin is a preexisting broader composition limitation.

HTTP draft/state sharing preserves current warm behaviour. Unit20 still owns ordered persistence, concurrent mutation and recovery. Editor save/recovery belongs the editor ownership unit16; this unit only fences the actual document handle grant and captures the correct initial composition origin. This avoids tying future document collaboration, tabs, workspaces or cross-Node designs to a globally rebound bridge. No future design under docs/future is treated as shipped or set in stone.

Coordinator remaining gates: review this source/evidence set; stage updated SDK and first-party bundles; cumulative desktop boot/Rust and full test/lint gates as needed; actual isolated Tauri HTTP/database/Notes/Shell surface verification; repeated day-style task/workspace/plugin/terminal cycles and long-lived CPU/RSS measurements. This unit establishes removed repeated work, bounded ownership, origin safety and specific startup/output repairs. It does not claim full-day plateau, overall application startup improvement or completion of the performance programme.

All owner probes stop component roots, tree pools, native workers and QueryClients in finally; native temporary module fixtures are removed. There are no intentionally running apps/workers. Immutable before source, legacy SDK and disposable proof bundles under `/tmp/acorn-perf-unit06-*` are retained as review/reproduction inputs, not running profiles. No branch, commit, paid provider or normal user profile was used.
