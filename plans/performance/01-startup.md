# Startup performance audit

Date: September 30, 2026. Baseline: `f8e4b59c`. Status: audit complete, fixes deferred until every performance area has been audited.

Two disk-write changes merit implementation. Unchanged bundled Node packages incur eight fsyncs per launch, about 35 ms on this host. Bundled client trust initialization incurs fourteen fsyncs before the window opens on a fresh custody root. Batching that initialization can remove most of its measured 61 ms of fsync time. The second change needs careful custody tests because its files hold trust decisions.

No application source changed during this audit. Measurements used disposable directories under `/tmp` and build artifacts staged by the coordinating agent. This report is the only authored repository file.

## Scope and evidence

The audit covered the Rust shell's startup, scheme handlers, helper process, custody construction, service supervision, compile-cache handling, Node entries and composition, startup dependency graphs, and their regression checks. Worker internals and plugin initialization belong to area 02. Renderer behavior beyond initial composition belongs to the renderer audit. Terminal-client startup belongs to area 15.

Read the engineering instructions, `/Users/jamesmacfie/.codex/RTK.md`, the improve skill, and its readable audit playbook. Applied the playbook's Performance and Finding format sections. Applied the readable skill to this report.

Read `docs/README.md`, `docs/architecture-overview.md`, `docs/conventions.md`, `docs/local-development.md`, `docs/shell.md`, `docs/node-distribution.md`, and the future index. Relevant proposals reviewed were `docs/future/bundle.md`, `docs/future/compiled-tier.md`, `docs/future/remote.md`, and the client-plugins programme's README and refusals. The future index records the retirement of both previous performance programmes. Their shipped changes were checked in the owning docs, commit messages, and source.

## Startup ownership and data flow

| Stage | Owner and contract | Work on the critical path |
| --- | --- | --- |
| Native launch | `apps/desktop/src-tauri/src/lib.rs:267` resolves separate Node and custody roots, obtains the data key, and starts the helper. | Directory creation, key access, resource checks, helper spawn. A debug build uses a private file instead of the OS keychain. |
| Helper readiness | `apps/desktop/src/helper/helperMain.ts:94` builds custody, binds the authenticated loopback WebSocket, then emits the ready line. Rust waits in `apps/desktop/src-tauri/src/helper.rs:212`. | Cache sweep, bundled client cache and trust reconciliation, WebSocket bind. Rust opens the window after the ready line. |
| Local service | `packages/custody/src/supervision/serviceHost.ts:54` spawns staged `service.js` under the pinned runtime with a build-scoped compile cache. | Spawn and static module evaluation precede the Node boot timer. Node startup runs alongside window loading. |
| Node composition | `apps/node/src/composition/runtime.ts:73` locks the data root, reconciles bundled packages, opens core storage, assembles plugins, initializes their declared contracts, and binds TLS. | Bundled reconciliation, migrations/runtime creation, worker discovery, plugin init/ready, TLS and listener setup, scheduler registration. Durable reconciliation continues after the listener. |
| Broker adoption | `packages/custody/src/index.ts:193` receives the lifecycle protocol's endpoint, certificate identity, and device token, persists custody, and upserts the broker. | Fleet/token writes and pinned Node connection setup. Product requests remain on the broker and `/v1`, not the lifecycle protocol. |
| Renderer arrival | `apps/desktop/src/client/index.tsx:90` starts fleet selection without awaiting it. The per-Node query provider restores that Node's cache. First usable status releases `nodeReady`. | Entry evaluation, tree construction, cache hydration, and the status handoff. Paint depends on the window's visibility. |

The Node service remains shell-free and shares composition with the standalone entry. Each Node owns its data independently. The helper owns fleet membership, pins, tokens, bundle cache, and trust decisions. These proposed changes belong within those owners and require no protocol, renderer, contribution, or capability changes.

## Measured baseline

Host: macOS, arm64, pinned Node `v24.11.0`. Measurements are dated evidence, not universal budgets. Builds were coordinated to avoid duplicate staging.

### Real debug app

The coordinating agent launched an isolated `perf-baseline` session. Its log is `.acorn/agent-dev/perf-baseline/logs/desktop.log`. This is a seeded automation profile, not a packaged OS-keychain launch or a repeat established-profile launch.

| Mark or slice | Measured value |
| --- | ---: |
| Helper handshake | +26 ms |
| Helper cache sweep | 2 ms |
| Helper bundled client trust | 100 ms |
| Helper WebSocket bind | 4 ms |
| Helper ready line | +134 ms |
| Helper ready to `service.start` | 598 ms |
| Node bundled packages | 89 ms |
| Node runtime creation under `migrate` | 66 ms |
| Node `graph` | 116 ms |
| Node graph to `install` | 117 ms |
| Node listener up | +412 ms from the Node boot timer |
| Node scheduler | 5 ms |
| Helper `service.start` | +732 ms |
| Helper node adoption | 10 ms |

The Node timer starts inside `startServiceRuntime`, after spawn and module evaluation. Subtracting its listener timestamp from a helper timestamp does not produce a precise import time because the clocks have different origins and service reporting includes scheduler and device-token work.

The coordinating agent reported renderer marks at script 161 ms, tree 171 ms, first paint 185 ms, and `nodeReady` 220 ms on its navigation clock. The document was hidden and unfocused. These marks cannot establish visible-window latency. WebKit suppresses animation frames and throttles timers when a window is occluded or the screen is locked.

### Startup dependency graphs

The artifact checks passed without rebuilding:

- `rtk proxy node apps/node/scripts/check-service-budget.mjs`: 2,786,892 bytes across `service.js` and seven static chunks. Static externals are `node-pty` and `@vscode/ripgrep`. `playwright-core` remains lazy.
- `rtk proxy node apps/desktop/scripts/check-renderer-budget.mjs`: 740,822 startup script bytes, 100,352 stylesheet bytes, 101 assets, and one preload hop. Another 151 chunks and 2,278,208 bytes are reachable through dynamic imports and excluded from startup.

### Production telemetry supplied by the coordinating agent

Sentry project `acorn-u3/acorn-development`, September 26-30: `renderer.boot` has 28 samples, median 654.5 ms and p95 2,162.9 ms. `helper.boot` has five samples, median 3,582 ms and p95 4,688 ms. Release identifiers are null. These cannot be assigned to this checkout or used as before metrics. `helper.boot` includes marks through Node adoption, rather than only Rust's wait for the ready line (`packages/custody/src/bootMarks.ts:52`). Suspended-window tails need separate treatment.

## Findings

| ID | Finding | Impact | Effort | Fix risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| STARTUP-01 | Skip unchanged bundled ownership writes | About 35 ms of measured fsync time on every launch with eight app-owned packages | S, 2-4 hours including tests | Low | High |
| STARTUP-02 | Batch bundled client cache and trust commits | About 50 ms estimated saving before the first window on a fresh custody root, and about 25 ms on a version-only update | M, about one day including custody tests | Medium | High for waste, medium for saved wall time |

### STARTUP-01: Skip unchanged bundled ownership writes

- **Evidence**: `packages/node-core/src/server/plugins/bundled.ts:147` calls `markBundledPluginInstalled` even when the installed package fingerprint equals the bundled package fingerprint. `packages/node-core/src/server/plugins/bundledState.ts:51` rereads the state and unconditionally writes the entire file. `packages/node-core/src/server/storage/dataRoot.ts:30` fsyncs each atomic write. `apps/node/src/composition/runtime.ts:112` runs this before runtime creation and the listener.
- **Impact**: Every unchanged app-owned package causes a durable rewrite of identical ownership bytes. An actual eight-package artifact required eight writes and eight fsyncs on each unchanged reconciliation pass. This delays Node availability even on repeat launches.
- **Before metric**: Ten runs against the staged eight-package roster, seeded once into a disposable root, took 48.07-59.09 ms, median 51.90 ms. Every run performed 102 file reads totaling 7,666,257 bytes, eight writes, and eight fsyncs. Fsync time was 34.37-42.06 ms, median 35.50 ms. All ten runs reported zero installs, zero updates, and zero failures. Instrumentation overhead is included in total time. Module loading and fixture creation are excluded.
- **Effort**: S, 2-4 hours.
- **Risk**: LOW. An exact entry comparison can preserve the ownership and crash-recovery rules. Comparing only version or fingerprint would miss a changed status or timestamp and is insufficient.
- **Confidence**: HIGH. Both the code path and redundant fsync count were measured.
- **Fix sketch**: In `setEntry`, return when the stored entry exactly equals the proposed entry. Include `status`, `version`, `fingerprint`, and `installedAt` in the comparison. Preserve the source and target fingerprint checks, sticky removal, owner overrides, development markers, and interrupted-placement recovery.
- **Expected result**: Unchanged reconciliation performs zero ownership writes and zero fsyncs. The roughly 35 ms saving is an estimate from observed fsync time. No after metric exists because implementation is deferred.
- **Validation**: Extend the colocated bundled-state or bundled reconciliation tests with the unchanged repeat case and file-write observation. Keep the cases for missing ownership state after placement, modified targets, dev builds, owner-installed rows, and removed rows. Run `rtk pnpm --filter @acorn/node-core test`, `rtk pnpm --filter @acorn/node test`, and `rtk pnpm lint`. Repeat the benchmark and an established-profile desktop launch after all audits.
- **Future plans**: The change belongs to Node-owned package reconciliation. It supports bundled-package distribution without affecting `bundle.md`, loaded-tier migration, or browser/device custody. Do not cache fingerprints solely by application version, because developer builds and owner-edited targets can change without it.

### STARTUP-02: Batch bundled client cache and trust commits

- **Evidence**: `packages/custody/src/plugins/bundledPluginTrust.ts:51` loops over bundled packages. Each client invokes `cache.putBundled` at line 58 and `trust.record` at line 59. `packages/custody/src/plugins/pluginCache.ts:88` persists the index for each uncached bundle. `packages/custody/src/plugins/pluginTrustStore.ts:218` skips identical decisions, but a version change alters the bundled provenance at `bundledPluginTrust.ts:62`. `packages/custody/src/index.ts:160` performs the pass before the helper's WebSocket and ready line.
- **Impact**: A fresh custody root seeds seven client bundles with seven index fsyncs and seven trust fsyncs. An application-version-only change causes seven trust fsyncs even when client bundle bytes and disclosures are identical. Both costs precede window creation. Unchanged repeat launches already perform zero fsyncs here.
- **Before metric**: The actual staged roster accepted seven clients. Fresh custody took 90.93 ms, with fourteen fsyncs consuming 61.40 ms, and 21 low-level writes. Unchanged repeats took 5.83 ms and 3.87 ms with zero writes. Changing only the supplied application version took 38.56 ms, with seven fsyncs consuming 31.13 ms. Its unchanged repeat took 3.51 ms. Each pass read fifteen files totaling 774,480 bytes. These are single cold/update samples, not medians. The real app's first bundled trust slice was 100 ms.
- **Effort**: M, about one day.
- **Risk**: MEDIUM. These stores protect per-hash decisions and startup distribution. A batch must preserve validation, first-decision timestamps, rejection semantics, provenance, and partial failure behavior.
- **Confidence**: HIGH for the redundant durability operations. MEDIUM for a saving estimated from one cold and one version-update sample.
- **Fix sketch**: Add narrowly scoped batch operations inside `PluginCache` and `PluginTrustStore`, then let the trusted application-resource pass commit each changed file once. Write and hash bundle bytes before committing their index. Validate acknowledgements before the trust commit. Retain atomic fsynced writes for both files and preserve successful packages when a sibling fails. Keep remote bundle claims and user decisions on their normal paths.
- **Expected result**: A fresh pass performs at most one index fsync and one trust fsync. A version-only update performs at most one trust fsync. An unchanged pass remains write-free. At the measured fsync cost, removing twelve cold fsyncs suggests about 50 ms before the first window. This is a hypothesis until measured after implementation.
- **Validation**: Add tests beside `bundledPluginTrust.test.ts`, `pluginCache.test.ts`, and `pluginTrustStore.test.ts` for cold batches, unchanged repeats, version-only provenance updates, a malformed sibling, missing cache files, a preexisting rejected decision, and opt-out behavior. Assert the persisted final rows and bounded durable-write counts. Run `rtk pnpm --filter @acorn/custody test`, `rtk pnpm --filter @acorn/desktop test`, and `rtk pnpm lint`. Verify a real Tauri launch with a fresh isolated custody root and another launch after changing only test application provenance.
- **Future plans**: Keep batching in custody, behind the portable store interfaces considered by `docs/future/client-plugins/`. Do not pass filesystem paths to the renderer or move trust decisions into the Node. Browser storage may provide its own transaction implementation. This optimization must not become automatic trust for remote nodes or device-installed plugins.

## Reproduce the measurements

The report retains [the reconciliation benchmark](./bench-startup-reconcile.mjs) and [the trust benchmark](./bench-startup-trust.mjs). Both instrument `node:fs` before importing the source modules with `syncBuiltinESMExports`, time only the public operation with `performance.now`, and remove their disposable roots. They wrap `readFileSync`, `writeSync`, and `fsyncSync`. The fsync wrapper separately times the underlying call. The coordinator independently repeated them and saved [reconciliation results](./evidence/startup-reconcile-before.json) and [trust results](./evidence/startup-trust-before.json).

Run from the checkout root after coordinating artifact staging:

```sh
rtk proxy node --import tsx plans/performance/bench-startup-reconcile.mjs /ABSOLUTE/CHECKOUT/apps/desktop/dist/bundled-plugins
rtk proxy node --import tsx plans/performance/bench-startup-trust.mjs /ABSOLUTE/CHECKOUT/apps/desktop/dist/bundled-plugins
```

Use an absolute bundled root. The package path-containment check does not accept a relative resource root. An earlier relative-root invocation failed all eight package checks and is excluded from the metrics.

To recreate the scripts after `/tmp` cleanup:

1. Wrap the three `node:fs` calls and call `syncBuiltinESMExports()` before dynamic imports. Count calls and read bytes, and time each original `fsyncSync`.
2. For reconciliation, import `reconcileBundledPlugins` from `packages/node-core/src/server/plugins/bundled.ts`. Make a private temporary data root, seed it once with the staged absolute bundled root, reset counters, and time ten repeat calls. Confirm empty `installed`, `updated`, and `failures` arrays before accepting the measurement.
3. For client trust, import `PluginCache`, `PluginTrustStore`, and `trustBundledClientPlugins` from their custody modules. Use a temporary custody root and a fetcher that throws if called. Time the pass with version `1`, repeat version `1` twice, run version `2`, then repeat version `2`. Record accepted-client counts and counters for each pass.
4. Keep module import, data-root creation, and cleanup outside the timed operation. Run the after benchmark with the same pinned runtime and artifact roster. Use interleaved repeats for the cold and version-update cases before quoting an after saving.

For end-to-end verification, use `rtk pnpm dev:agent -- --session startup-after`, inspect the boot marks, then stop with `rtk pnpm dev:agent:ui -- --session startup-after stop`. Repeat with `--reuse` for an established profile. Keep the window visible and the screen unlocked if measuring paint. Prefer a direct launch of the already-built binary for repeated timing so staging and compilation remain outside the measurement.

## Considered and rejected

| Idea | Decision and evidence |
| --- | --- |
| Bundle pure JavaScript service dependencies | Shipped in `aa86a93c`. Both service and helper share `apps/node/externals.ts`. The artifact check confirms only the intended native/binary-resolved packages remain static. |
| Add service compile caching | Shipped in `e75f7d0e`. Its commit records warm service import savings of about 25 ms. Rust/helper plumbing for another cache is unwarranted by the measured helper evaluation cost in that history. |
| Defer ACP, Shiki, diff, editor, or unused kit components | Shipped in the recent performance history, including `b59f530b` and `a9802473`. The renderer module denylist and size check protect these splits. |
| Start loaded workers or plugin lifecycle passes together | Shipped in `d40f09dd` and `facd8288`. Remaining worker initialization belongs to area 02. |
| Move the login-shell PATH probe or durable reconciliation behind startup | Shipped in `facd8288`; source confirms the asynchronous PATH gate and post-listener reconciliation. |
| Remove the Node-ready gate or bind before plugin initialization | Rejected. Requests must not race plugin migrations and capability installation. Remote/offline cache behavior requires the broker's usable-status contract. A readiness protocol redesign is disproportionate to these measured disk-write savings. |
| Skip source or target hashing by remembered fingerprint alone | Rejected. Hashing distinguishes interrupted placement, modified targets, unknown owner packages, and development builds. Keep integrity checks while eliminating identical durable writes. |
| Remove fsync from trust or ownership storage | Rejected. These are durable decisions. Avoid redundant writes or batch them while retaining atomic fsynced commits. |
| Lazy-load `node-pty` across its five import owners | Deferred. A first require took 188 ms while staging was active; ten separate subsequent processes took 4.18-6.78 ms, median about 5.1 ms. The cold outlier is insufficient evidence for a cross-plugin async API change. |
| Move compile-cache pruning behind the ready line | Confirmed ordering discrepancy, deferred for impact. `helperMain.ts:144` invokes `startInBackground()` before line 179 emits ready. `ServiceHost.start` synchronously prunes the cache before its first await, despite a comment claiming this occurs after readiness. The baseline `ws bound` to `ready line` gap is only 2 ms, so this is not a material measured bottleneck. Revisit if cache volume makes that gap large. |
| Add a generic scheme-response cache or a thread pool | Deferred. Hashed renderer assets already receive immutable caching, index HTML remains uncached, and app-scheme reads already leave the UI thread. No measured request queue establishes a remaining startup problem. Preserve CSP and origin policies. |
| Shrink the compiled tier to speed startup | Rejected as a startup fix. The standing compiled-tier plan requires a product or contribution-seam reason for migration. Moving the same eagerly initialized code into workers can add work. |

## Validation gaps and follow-up order

The coordinating agent's `pnpm lint` baseline passed, including 34 package typechecks. This audit ran both artifact-budget checks and the focused measurements. It did not run the complete test suite because it changed no source and baseline staging/testing was coordinated separately.

Fresh-checkout automation needed the plugin SDK's ignored build artifact before staging could resolve `acorn-plugin-sdk`. The coordinating agent built that artifact. Sandboxed `tsx` seeding then failed with an IPC-listener permission error and the coordinator relaunched through automatic escalation. These are measurement prerequisites, not Node startup latency findings.

`apps/desktop/test/boot.test.ts:113` supplies no bundled-plugin directory and uses a fresh data root. Its 1,500 ms assertion therefore guards the empty loaded-package graph, not the established bundled roster. Keep that fast test and add a deterministic write-count check for these fixes. An established-profile real-window measurement remains necessary before claiming an end-to-end saving.

Packaged keychain access, installed-app first launch, non-macOS startup, a fleet with unreachable remote nodes, and visible paint on an unlocked foreground window were not measured. Production telemetry has no release identifier. Those limits do not weaken the observed duplicate file writes, but they limit claims about total launch time.

After every area audit is complete, implement STARTUP-01 first. Its smaller change and repeat-launch metric make it the cleaner first comparison. Then implement STARTUP-02 if first-launch/update latency remains a priority. Keep the two commits or diffs independently reviewable and repeat the same isolated metrics before broadening startup work.
