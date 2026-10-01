# Client plugin performance audit

The audit found two retained-lifetime defects and one source of repeated registration work. Fix frame cleanup first, then remote handler ownership, then unchanged loaded-plugin reconciliation.

The investigation uses checkout `f8e4b59c`. Application source stayed unchanged. The measurements use synthetic data and the shipped APIs. They do not measure visible Tauri latency or a full day of use.

## Ownership and data flow

The relevant flow has two entry paths:

1. The desktop composition imports `apps/desktop/src/client/plugins.ts`. `activate.ts` calls `initClientPlugins`, which initializes compiled contributions, records their disposables, and then runs activation callbacks. The host owns those callbacks' returned disposers. Per-Node disabled state comes from `refreshNodePlugins` through the platform broker.
2. A loaded plugin's Node roster advertises a manifest and bundle hash. `watchPluginChanges` runs distribution when a Node first becomes reachable and after `plugins:changed`. `distribution.ts` reads fleet rosters, asks custody to cache and locally hash missing bundles, resolves one winner per plugin, and reads device trust. `eligiblePlugins()` chooses the winning manifest and namespaces its contributions. `syncPluginContributions()` then registers code-bearing surfaces and descriptor chrome.

The device's custody owns cached bytes and trust records. `host/plugins/host.ts` is the client adapter to that boundary. The renderer neither downloads bundles directly nor accepts a Node's claimed hash as proof of trusted bytes. Permission disclosure and acceptance remain keyed to the plugin and exact bundle hash.

Registry entries feed the pane host, settings, reference panels, overlays, source lists, and extension slots. A loaded region renders either through `PluginFrame` or `RemoteTree`. Frames own their documents behind a scoped MessagePort bridge. Trees acquire one worker per bundle hash, identify each mounted tree by slot, and draw host kit components. The plugin adapter keeps executable handlers in its worker and sends numeric references to the host.

Remote rendering follows `solidTree` -> universal renderer -> `remoteRoot` -> microtask mutation batch -> worker tree port -> protocol validation -> `treeState` preflight and frame coalescer -> `TreeHost` -> the closed kit. Host kit events return through that slot's transport to `RemoteRoot.dispatch`. `mountTree` drops a slot's renderer, pending host requests, and root when it receives `tree:unmount`.

The terminal host imports the same worker lifecycle and tree-state rules. `apps/tui/src/plugins/workerFactory.ts` supplies permission-scoped Node worker threads, and its `RemoteTree` and `TreeHost` supply terminal presentation. Frame documents and their leak are desktop/browser behavior. Handler ownership and loaded registration work affect both hosts.

Inspected owning modules and adjacent boundaries include:

| Area | Modules |
| --- | --- |
| Activation and reload | Desktop `activate.ts` and `plugins.ts`; `host/registries/extensionPoints/plugin.ts`; `host/plugins/{host,reload,distribution,contributions,syncContributions}.ts` |
| Registration and ownership | `kit/lib/registry.ts`; `host/frames/register.ts`; `host/chrome/{chromeRegister,chromeData}.ts`; pane and extension-point registries |
| Trees and workers | `host/tree/{workerHost,RemoteTree,TreeHost,treeState,kitEntry,Slot,arbitration,slotChoice}`; terminal equivalents and worker factory |
| Plugin adapter | `host/frames/{sdk,remoteRoot,remoteSolid}.ts`; `packages/plugin-sdk/src/remote/solid.ts`, which re-exports the facade |
| Frames and disposal | `host/frames/{PluginFrame,PluginWebview,InlineSlot,broker,frameServices,scopes,channels}`; client event bus and appearance observer |
| Retained pane models | `host/registries/panes/{panes,paneModels}.ts`; `features/tasks/TaskPaneHost.tsx`; agent, Changes, Context, and Notes model paths |
| Trust and future contracts | Bundle resolution and trust projection; plugin frame, descriptor, activation, frontend, device-provenance, host-custody, and remote-access documentation |

## Prior changes retained

The branch already contains the following work. These are not findings to implement again:

- `8af1d0f0` skips a compiled client-host pass when plugin objects, order, and the effective disabled set are unchanged. `activate.ts` also avoids a repeated applied-Node pass. This does not cover the loaded descriptor/frame passes below.
- `b169883f` edits child arrays once per tree batch. The host also simulates removals with a child index, avoiding repeated ancestor scans across the full tree.
- `77ed2ebd` gives heavy kit nodes loader entries. `kitEntry.ts` creates one stable lazy component per module-level entry, rather than one loader state per remote node.
- `f7e4fbbd` creates the slot preference query only when a replacement tie needs a user choice, under the slot's owner.
- `workerHost.ts` associates grace timers with their worker generation. A delayed release from a failed worker cannot terminate its replacement under the same hash. The existing focused suite covers this case.
- Retained pane models publish `shown`. Changes defers invalidations while hidden, and agents gates read/attention writes on visibility. Pane DOM is not retained per task. Loaded roots receive `tree:unmount`, which clears the whole root handler table.

## Findings

### [PERF03-01] Dispose frame resources from an owned lifecycle

- **Evidence**: `packages/client-core/src/host/frames/PluginFrame.tsx:243` invokes `onLoad` from a native `addEventListener` callback. `PluginFrame.tsx:116` explicitly recognizes that this callback runs outside the component's reactive owner. `PluginFrame.tsx:202` nevertheless registers the port, appearance, client-event, and webview cleanup through `onCleanup` inside that callback. `packages/client-core/src/host/frames/broker.ts:216` owns request abort and subscription detach, but it runs only when the component calls `bridge.dispose()` or the bridge kills itself.
- **Impact**: Every loaded frame that closes after its load event retains host event listeners and an appearance observer. Declared core-channel subscriptions and webview subscriptions also remain. Later messages still reach removed surfaces. Outstanding broker requests miss their intended abort on pane disposal. Component props, query client, binding, and frame references remain reachable through these subscriptions.
- **Effort**: S, several hours including lifecycle regression checks.
- **Risk**: LOW for normal cleanup, MED for failure paths. Cleanup must happen after iframe removal as well as when the containing component closes, and must tolerate partial initialization.
- **Confidence**: HIGH. The reproduction renders the actual component with the browser Solid build and dispatches native iframe load events.
- **Fix sketch**: Register one idempotent disposer while a component owner is present and store the load-created resources in that owned lifecycle. Dispose when the iframe's `Show` branch is removed, on component disposal, and on failed handshake or port transfer. Clear the frame and port references, cancel the deadline, detach appearance and event listeners, dispose the bridge, and remove an unconsumed load listener.

The harness supplies query/router hooks at their host boundary and counts MessagePort calls through a transport recorder. `PluginFrame`, `createFrameBridge`, services, client event subscriptions, and the appearance observer are the application implementations. Every frame subscribes to `runtime:task-archived`, then closes. The harness sends one surface action, one core event, and one appearance change afterward.

| Closed frame cycles | Closed host ports | Webview detaches | Messages sent to removed frames afterward |
| ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 3 |
| 10 | 0 | 0 | 30 |
| 40 | 0 | 0 | 120 |

The load callback had no Solid owner. Development Solid logged 40 cleanup warnings. These are semantic counts, not a retained-heap estimate. See [frame evidence](./evidence/client-frame-lifetime-before.json).

After the fix, the same 40-cycle probe should close 40 host ports, call 40 webview detachers, and send zero messages to removed frames. Add focused cases for disposal before load, closing before the first bridge message, the silent-frame fallback, misbehavior fallback, and a failed port transfer. An API request started before close must observe an aborted signal. Preserve exact origin targeting, permission checks, the initial selection's single consumption, and acknowledgment behavior.

The scoped broker already has correct explicit teardown semantics. A new bridge implementation or a larger subscription cache would bypass the owner that needs fixing. The repair should stay in frame lifecycle composition.

### [PERF03-02] Release remote event handlers when their live references disappear

- **Evidence**: `packages/client-core/src/host/frames/remoteRoot.ts:207` holds handlers in a strong Map. `remoteRoot.ts:235` gives each function a stable ID and inserts it into that Map. `remoteRoot.ts:153` replaces node properties without releasing their previous handler. `remoteRoot.ts:186` detaches removed subtrees without releasing handlers. Only whole-root disposal at `remoteRoot.ts:256` clears the Map.
- **Impact**: A long-lived tree retains every historical event closure and whatever each closure captures. The host's live-node ceiling does not bound historical handlers. Both a list repeatedly removing rows and a single node receiving replacement handlers grow retained memory. IDs for removed or replaced handlers continue to dispatch until the entire root closes.
- **Effort**: M, about a day including shared-reference and detach/reattach coverage.
- **Risk**: MED. One function can serve multiple props and multiple nodes under the same ID. Removing one reference must keep the others callable.
- **Confidence**: HIGH. Forced garbage collection with actual `createRemoteRoot`, `setProperty`, `insertNode`, and `removeNode` retains every synthetic captured payload until root disposal.
- **Fix sketch**: Track handler ownership per attached node and event property, with root-local reference counts for IDs shared by the same function. Release the previous reference on property replacement or unset, and release each reference when a subtree detaches. Restore references on reattachment, preserve them during a live move within the same root, and ignore stale events for IDs with no live owners.

The probe performs 10,000 changes with each closure capturing a synthetic array of 512 numbers. It yields between updates so batches flush, keeps only WeakRefs to payloads, and forces garbage collection before each checkpoint.

| Workload | Changes | Retained captured arrays | Heap growth after collection |
| --- | ---: | ---: | ---: |
| Insert then remove a node | 1,000 | 1,000 | 4,599,512 bytes |
| Insert then remove a node | 5,000 | 5,000 | 22,685,680 bytes |
| Insert then remove a node | 10,000 | 10,000 | 45,091,040 bytes |
| Replace one node's handler | 1,000 | 1,000 | 4,473,856 bytes |
| Replace one node's handler | 5,000 | 5,000 | 22,587,992 bytes |
| Replace one node's handler | 10,000 | 10,000 | 44,941,768 bytes |

After root disposal, both workloads retained zero captured arrays. Dispatching the first historical ID before disposal still called its closure. The payload size is deliberate stress data. The measurements establish linear retention; they do not predict 45 MB growth for a particular product pane. See [handler evidence](./evidence/client-remote-handlers-before.json).

Do not delete an ID whenever one node disappears. The existing shared-function behavior is intentional. Verify one function used on multiple nodes and props, replacing one reference while another remains, subtree removal, unset props, detach then reattach, removal then insertion in one batch, live same-root moves, and queued stale events after release. A detached node may retain its authored function for later reattachment; the root must stop retaining it independently. The wire carries the same numeric handler shape, so no protocol widening is needed.

This applies to desktop workers and terminal worker threads because both execute the same bundled adapter. Rebuild affected client bundles during implementation so the repaired adapter reaches their workers. Do not repeat the already completed SDK build during investigation.

### [PERF03-03] Preserve unchanged loaded contributions during reconciliation

- **Evidence**: `packages/client-core/src/host/plugins/syncContributions.ts:14` runs both registration passes without an enclosing Solid batch. `packages/client-core/src/host/frames/register.ts:572` disposes every registered surface on each pass, then constructs replacements. `packages/client-core/src/host/chrome/chromeRegister.ts:453` does the same for descriptor chrome. `packages/client-core/src/host/plugins/reload.ts:30` triggers this for any plugin change. `packages/client-core/src/features/tasks/TaskPaneHost.tsx:94` renders registry entries through an identity-based `For`.
- **Impact**: An unchanged loaded manifest loses all contribution identities. Mounted list consumers unmount and remount their entries, and registry observers run once per removal and insertion. Accepting one plugin bundle or reloading one Node plugin can recreate unrelated loaded surfaces. This also multiplies frame retention from PERF03-01 until that defect is fixed.
- **Effort**: M, about a day for semantic comparison, atomic registration, and change cases.
- **Risk**: MED. A bundle hash identifies executable bytes but does not alone identify a manifest, trust state, or the winning roster row. Collision handling, failed registrations, and dependency arbitration must remain deterministic.
- **Confidence**: HIGH for repeated work. The actual paired pass, actual pane registry, and browser Solid list consumer reproduce it. Real pane fetch or frame boot cost is unmeasured.
- **Fix sketch**: Compare a semantic registration snapshot and return without writing registries when it is unchanged. Retain entries for unchanged plugins during a changed pass, and batch related frame/chrome updates so consumers do not observe partial removal. Include manifest declarations, selected bundle, trust state, and eligibility in the comparison; preserve failure reporting and retry semantics.

The probe seeds 20 accepted loaded plugins, each declaring one frame pane. It calls `syncPluginContributions()` ten times without changing the distribution state. A Solid list consumes the actual pane registry and counts mounts and cleanup. A separate render observer counts published roster changes.

Every identical pass caused 40 registry observer runs, 20 list unmounts, and 20 list mounts. The observer also received an empty pane roster between the two halves of the replacement. The ten measured synchronous pass times ranged from 0.985 to 9.572 ms. These timings include lightweight string consumers, not pane bodies, workers, API requests, or native window layout. Counts are the stronger evidence. See [registration evidence](./evidence/client-registration-before.json).

A fixed unchanged pass should produce zero registry updates and zero mounts or unmounts. When one manifest changes, verify that unrelated entries retain identity. Exercise changed bytes with unchanged declarations, permission changes, acceptance and revocation, descriptor-only packages, removal, failure followed by a genuine retry, and fleet resolution choosing another manifest. Preserve contribution IDs used by layouts and chords, the per-Node render gates, provider ownership, and replacement arbitration.

Adding only a Solid batch removes intermediate observer runs, but all fresh contribution objects still remount after the batch. The fix needs identity preservation as well.

## Measurements and replay

The preserved files are investigation harnesses outside application source. They write counts and allow another output name after implementation:

```bash
rtk proxy env ACORN_PERF_TAG=after pnpm exec vitest run --config plans/performance/area03-bench.config.ts
rtk proxy node --expose-gc --import tsx plans/performance/bench-client-remote-handlers.mjs plans/performance/evidence/client-remote-handlers-after.json
```

The browser harness writes `client-frame-lifetime-after.json` and `client-registration-after.json`. `ACORN_PERF_TAG` defaults to `sample`, leaving the preserved `before` files intact. The handler script accepts an output path and also defaults to a separate sample file. The harnesses report behavior without asserting that defects persist, so they remain usable after fixes.

The browser harness uses `vite-plugin-solid` and explicit browser Solid builds for consistent ownership semantics. Query and router hooks are supplied, and MessagePorts are recorded rather than transferred to real plugin documents. The handler script runs under Node 24.11.0 with the unchanged source adapter and forced collection.

No live `perf-baseline` changes, plugin package rebuilds, or large builds were needed. The coordinator's baseline lint and bounded suite passed. This audit ran two focused browser investigation cases and the forced-collection source probe. Run the repository's required lint and relevant tests when implementing the fixes, then test the frame behavior in the real graphical Tauri window.

## Lifetime review and decisions

Workers use reference counts, remove per-slot listeners on tree disposal, and keep an empty worker for 30 seconds. The heartbeat terminates an unresponsive worker after missed answers. The warm grace period prevents repeated bundle startup while cards leave and return to the viewport. Its generation check is already correct. Shortening grace without measuring worker restart cost is not recommended.

The bridge attached by `acquireTreeWorker` belongs to the worker and is created by the first tree's `connect` callback. It therefore outlives that tree. The callback captures that tree's binding, container, and optional document accessor. This is a scope and ownership risk when the same warm worker serves another task, Node, or composed document. The inspected baseline does not stop all workers on a Node switch. This pass did not reproduce the resulting scope behavior, and does not claim a measured performance gain from changing the sharing model. If worker caching changes during implementation, explicitly check first-tree disposal followed by warm reuse, Node pinning, document access, and focus checks. Do not extend grace until those ownership questions are resolved.

Tree mutation batching already avoids the previously shipped child-list amplification. Validation still builds a projected parent map and child index for every batch, including property-only batches. The host queues batches until its scheduler runs, and the aggregate queue has no explicit count bound before flush. Sustained hidden-window animation or a hostile sender could expose queue growth. This audit did not measure that workload. It is a stress-test gap, not a measured optimization recommendation. Preserve whole-batch validation and subtree/cycle limits when investigating it.

Frame scope enforcement already uses one allowlist and abortable broker requests. The broker deduplicates each channel subscription for the bridge lifetime, and its explicit disposal detaches subscriptions and closes the port. Those mechanics are sound when called. Fix PERF03-01 at the component owner rather than caching more subscriptions or weakening scope checks.

Retained compiled pane models are bounded to one task per pane ID. They outlive the DOM to keep shared region state and pending saves, then dispose when another task requests that pane or task eviction runs. Changes and agents use the supplied visibility accessor to suppress hidden work and read acknowledgments. No evidence supports reintroducing per-task hidden DOM or disposing all retained models on a pane close. That would change drafts and save behavior.

Distribution reads the active roster during `refreshNodePlugins`, then reads fleet rosters during distribution, and reads custody state before caching and again before trust projection. Overlapping watcher and reload passes have no shared-flight owner. These are potential duplicated I/O paths. Startup trust and Node reload costs belong to area 01 and area 02, and this report does not duplicate those findings or propose caching trust snapshots across mutations.

## Future contracts and coverage gaps

The proposed device-held plugin path adds provenance and device-scoped preferences behind the same custody contract. Registration comparison must include those facts when they arrive, and must not assume that every eligible bundle has a Node half. Frame cleanup and remote handler reference ownership remain local lifetimes and do not require host-specific cache storage.

The PWA proposal changes bundle storage and iframe origin policy but keeps the scheme-independent MessageChannel bridge. Keep origin construction outside broker and SDK logic. A frame cleanup repair must continue to work for an opaque-origin web frame. Remote handler repair must keep shared kit events portable to cells.

Exclusive chrome replacement remains a user choice. Preserve the owner's default, stack limits, overflow disclosure, failure fallback, and per-host form-factor gate. Faster registration must not let registration order select a provider or retain an untrusted replacement.

The measured frame leak uses synthetic frame surfaces. The inspected loaded first-party panes chiefly use remote trees. A real packaged iframe, native child-webview resource footprint, remote fleet churn, a long-running TUI session, and worker realm garbage collection were not measured. The live Tauri renderer was hidden and unfocused, so this report makes no claim about visible interaction latency. The operation counts and adapter retention establish the defects without that timing.

Implement the three findings after the coordinated audit completes, preserving the `before` evidence and replaying these probes with separate `after` outputs.
