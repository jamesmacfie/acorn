# Area 16: shared owners, telemetry, and sustained resource lifetimes

Baseline: `f8e4b59caadfe846a9e2c6491ac42b91ec3cf66f`. Application source remains unchanged.
Measurements use Node `24.11.0` on the coordinator's macOS host. All input is synthetic.

## Findings to carry into implementation

| ID | Finding | Impact and confidence | Effort | Risk |
| --- | --- | --- | --- | --- |
| 16.1 | A cached UI worker's bridge retains its first tree's document, Node, query cache, and focus owner. | High correctness impact, demonstrated on desktop and TUI. Blocks safe warm worker reuse. Retains one retired first owner per live bundle, rather than one owner per remount. | L | High. Change the tree bridge contract and SDK together. |
| 16.2 | Two renderer viewers share one upstream subscription identity. One detach stops the other's stream; final renderer disconnect leaves streams running. | High confidence. Actual authenticated helper sockets, NodeBroker, wsHub, and Docker channel reproduce missing terminal restore, lost output, and output with zero renderer sockets. | L | High. Preserve generic plugin channels, credentials, binary output, sequence rules, and reconnect semantics. |
| 16.3 | TUI worker stdout and stderr are captured but never consumed. | High confidence. Actual permission sandbox stalls a 256 KiB write at 64 KiB until the host drains stdout. | S | Low to medium. Discard output without drawing it or retaining strings. Validate noisy workers' host cost. |
| 16.4 | Failed UI worker bridge setup leaves spawned workers and ports outside the pool's cleanup. | High confidence for the injected setup exception. Ten starts leave ten workers and 40 port endpoints, even after pool teardown. Frequency in ordinary use is unmeasured. | S | Low to medium. Make startup ownership transactional. |
| 16.5 | A late helper telemetry preference read reactivates collection after disposal. | High confidence for a held preference request. Shutdown usually exits the helper, so day-long impact is unmeasured. | S | Low. Fence lifecycle and adoption generations. |

The returned telemetry span and measure visitor test extends area 02's RPC lifetime finding. Treat it as a verification case for that fix, not another implementation unit.

## Runtime and data flow

Desktop and TUI `RemoteTree` components acquire a worker by bundle hash. `workerHost.ts` creates two message channels and invokes the first acquisition's `connect` callback once. That callback creates a permission-bound frame bridge and host services. The SDK's `mountTree` passes the same bridge into every tree renderer. Tree mutations and owner actions are slot-addressed; general bridge operations are bundle-addressed.

The bridge routes API calls through the captured Node, reads plugin state through the captured query client, and lends the captured document accessor. A tree's cleanup removes that slot and releases its worker reference. The worker survives another slot's ownership or a 30-second grace period. Its first bridge survives both.

Each desktop renderer connects to the custody helper with the helper secret. The helper sends all renderer frames through one `NodeBroker` socket per Node. The Node hub authenticates that socket and keys terminal sinks and plugin connection tokens by its physical connection. Docker keys streams by that opaque token and `kind:container`. Renderer identity disappears before either subscription owner receives the frame.

Telemetry has three in-memory owners. The Node collector aggregates records and durations, the shared client emitter posts bounded batches, and the helper uses the Node collector plus its own retry queue. The Sentry exporter converts batches and delivers envelopes on separate bounded chains. None of these records are canonical task, draft, transcript, or execution state.

Inspected owners include:

- `packages/client-core/src/host/tree/{RemoteTree,workerHost,TreeHost}.ts*`, `host/frames/{sdk,broker,frameServices,frameTelemetry}.ts`, and contribution resolution.
- `apps/tui/src/plugins/{RemoteTree,workerFactory,custody}.ts*`, `pluginWorker.js`, and the actual `renderCells` host.
- `apps/desktop/src/helper/{helperServer,rendererWatchdog}.ts`, `packages/custody/src/broker/nodeBroker.ts`, and `packages/node-core/src/server/transport/wsHub.ts`.
- Docker server channel, stream service, CLI environment, and the terminal stream handler contract.
- Node collector, context, scrubber, runtime pressure sampler, client emitter, queue, interaction work, responsiveness monitor, poster, helper telemetry, and Sentry exporter, envelope, transport, and redaction owners.

The documentation index, architecture, conventions, security, plugin map, activation, frame, telemetry, shell, TUI, and relevant future proposal documents informed the boundaries. Areas 02, 03, 05, 07, 13, and 15 supply preceding findings and dependencies.

## Measurement provenance and replay

All scripts default to `sample`. A `before*` tag refuses to overwrite its output. Preserve the named baseline artifacts.

| Probe | Authoritative output | What it exercises |
| --- | --- | --- |
| `16-pool-probe.test.tsx` | `16-pool-before-v3.json`, `16-pool-start-before-v3.json` | Actual desktop RemoteTree, workerHost, broker, and host services. Fake Worker and MessageChannel delivery, synthetic API seam. |
| `16-tui-pool-probe.test.tsx` | `16-tui-pool-before-v2.json` | Actual TUI RemoteTree and cell host with the same production worker and bridge owners. Fake transport and API seam. |
| `16-shared-viewers-probe.mts` | `16-shared-viewers-before-v3.json` | Real loopback renderer sockets, helper server, broker, Node hub, Docker channel, and Docker service. Synthetic device authentication and executable; terminal engine represented by sink counters. |
| `16-stdout-probe.test.ts` | `16-stdout-before.json` | Actual TUI worker factory, Node worker, permission bootstrap, and worker host. A temporary synthetic bundle honors stream backpressure. |
| `16-helper-telemetry-probe.test.ts` | `16-helper-telemetry-before.json` | Actual helper telemetry and collector, with one held synthetic preference GET. |
| `16-telemetry-probe.mts` | `16-telemetry-before.json` | Actual emitters, queue, and RPC endpoints. Forced garbage collection measures heap after completed calls. |

Initial desktop pool output used a wrongly spelled synthetic preference key, so its `state.get` result is not evidence. The corrected authoritative run uses `plugin:audit:value`. An initial TUI config inherited area 15's include array and replayed those fixtures; the corrected config runs this area alone. A broad desktop include also attempted to compile the TUI fixture with the desktop JSX host and failed. That failure is a probe configuration error, not an application defect. Desktop `before-v3` and TUI `before-v2` pass with separate host configurations.

Earlier shared viewer output opened both sockets before the first restore. `before-v3` opens the second socket after that restore and counts upstream Docker frames after the last socket closes. Those are distinct workloads; retain the earlier files as provenance.

Run the focused probes with these commands:

```bash
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/16-renderer-probe.config.ts
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/16-tui-probe.config.mts
rtk proxy env ACORN_PERF_TAG=sample pnpm exec vitest run --config plans/performance/16-node-probe.config.ts
rtk proxy env ACORN_PERF_TAG=sample node --import tsx plans/performance/16-shared-viewers-probe.mts
rtk proxy env ACORN_PERF_TAG=sample node --expose-gc --import tsx plans/performance/16-telemetry-probe.mts
```

Loopback sockets require the coordinator's automatic sandbox escalation. The fixture's synthetic `docker` is the only executable on its temporary PATH. Its Node process generates lines without a daemon, shell grandchildren, provider calls, or private data. Every renderer, Node socket, server, worker, synthetic child, and temporary directory is disposed.

The authoritative desktop run passes two cases, the TUI run passes one, and the Node run passes two. Existing custody telemetry tests pass seven cases. Existing client worker host, host requests, queue, and emitter tests pass 52 cases. Probe oxlint passes. The coordinator owns cumulative `pnpm lint`, relevant package tests, full bounded `pnpm test`, and staged native checks after implementation.

These probes deliberately expose baseline failures. After implementation, change the probe to call the production owner that replaced each seam and assert the intended behavior. An unchanged assertion that a retired A document was written, a worker stalled, or collection reactivated must fail after the fix. A helper probe must not wait unconditionally for a subscription count to reach zero when a second viewer should retain it.

## 16.1: scope general tree bridge operations to the mounted tree

Evidence: `workerHost.ts:124` reuses by hash, `workerHost.ts:203` retains the first connection, desktop `RemoteTree.tsx:135-176` closes over its first host context, and `RemoteTree.tsx:288-298` unmounts only its slot. TUI `RemoteTree.tsx:97-146` has the same closure. `sdk.ts:714-719` and `sdk.ts:806` pass a shared bridge to every renderer. `frameServices.ts:95` pins API Node identity, `:144-151` reads the captured query client, and `:201-209` lends the captured document.

Measured desktop behavior:

- A mounts with document A on Node A. B mounts the same bundle on Node B without a document region.
- B's bundle bridge reads `document-a`, reads `cache-a`, and sends its own namespace API call to Node A.
- After A unmounts, the same bridge remains open and still reads A. A document write changes retired document A; B remains unchanged.
- Focusing B's host button still fails `openUrl` because the captured container belongs to A.
- After 100 warm remounts, one worker remains and the retired A document remains callable. Pool teardown terminates that worker.

The TUI fixture reproduces A's document, A's plugin state, and Node A API targeting after A's first slot disposes. This is not a desktop DOM issue.

This finding matters before any longer grace period or broader retained plugin panes. It proves stale authority and retained ownership, rather than a native latency improvement. The 100-remount result shows bounded first-owner retention for this single bundle; it does not prove a heap leak proportional to 100 mounts.

Fix sketch:

1. Prefer retaining the accepted bundle's shared worker while giving each mounted slot a host-selected bridge context and bridge owner. Use per-slot bridge ports or a typed slot-addressed bridge protocol, with all context-dependent operations routed through that owner. Preserve ownership through asynchronous callbacks, rather than selecting a slot from the synchronous event stack.
2. Give each `TreeRender` the bridge for its mount. A bundle-global `connect()` must not provide ambient document or task authority to arbitrary slots. Define the compatibility/version rule explicitly and rebuild shipped SDK bundles.
3. Capture Node identity, query client, contribution permissions, structural document grant, navigation/focus owner, and initial selection in the slot owner. Do not retarget an earlier asynchronous call to whichever tree is active later.
4. On slot retirement, close its bridge, detach events, abort its requests, settle pending calls, and drop document and container closures. Preserve the worker and siblings. Scope `postSelect`, `postSurfaceAction`, and event subscriptions consistently.

There is a second concrete option if the bundle-global SDK bridge cannot acquire an independent asynchronous slot owner without a larger SDK change: pool workers by an explicit authority context. That key includes Node, project/task, document identity, and effective grants, with composed regions sharing their declared context. It does not include an arbitrary tree ID. This changes the documented one-worker-per-bundle model and increases live worker cost, so compare startup count and retained heap before choosing it. Bound idle contexts, preserve a finite grace policy, and release failed/retired generations. A Node/task key alone does not fix a retired first container or document accessor. The pooled context must own its binding independently and derive focus/navigation and document access only from surviving authorized slot leases. Do not reconnect a global bridge to whichever slot mounted last while earlier requests remain in flight.

After gates: concurrent A/B scopes, same task ID across Nodes, two documents within one Node, a document-free slot following a composed pane, first-slot disposal with an authorized sibling surviving, 100 remounts, stale callbacks, permission revocation, SDK compatibility, overlay/owner actions, and focused navigation. An unmounted slot cannot read or write A, B cannot inherit A's structural document grant, and each API/state call retains its origin. Worker startup count remains one for compatible same-context mounts; record any measured increase for distinct authority contexts. Validate idle pool bounds, grace expiry, failed setup ports, and actual desktop and TUI hosts, plus first-party Database document read/write/Execute and HTTP initial request selection.

Dependencies: area 06 preference custody and area 07 model ownership must preserve origin during retirement. Area 03 frame and handler cleanup remains separate. Device-held plugin and replaceable chrome proposals require this distinction between a shared module and a mounted context; they must not inherit the first Node-backed pane's authority.

## 16.2: preserve viewer ownership across the custody socket

Evidence: `helperServer.ts:163-170` forwards `node-send` without renderer identity and `:365` removes only renderer bookkeeping on socket close. `nodeBroker.ts:273-279` sends through one Node connection. `wsHub.ts:373-385` deduplicates terminal attaches and detaches by physical connection. `wsHub.ts:397` hands that same connection identity to plugins. Docker `wsChannel.ts:24`, `:49-56`, and `:113` own subscriptions by connection and release on its disconnect.

Measured with actual socket owners:

- A attaches a terminal and a Docker log stream. B connects after A's screen restore and attaches the same resources.
- The Node creates one terminal sink and one Docker reader. B receives no terminal ready or screen restore on its attach. It does receive subsequent live bytes.
- A detaches. Both upstream resources stop. B receives zero additional terminal or Docker frames during the subsequent 80 ms despite retaining its view.
- After both reattach, A's socket close preserves B's stream accidentally because renderer disconnect has no upstream effect.
- B's final socket close also leaves one terminal sink and one Docker reader alive. The broker continues receiving Docker output with zero renderer sockets for the measured 50 ms.
- Closing the broker's physical Node socket detaches both resources. The fixture confirms zero retained terminal sinks and both Docker reader handles stopped.

This supplies the missing multi-viewer evidence for areas 05, 07, and 13. The helper's per-renderer active Node filter is a different finding. Fixing that filter alone leaves subscription ownership wrong.

Fix sketch: introduce a generic logical viewer identity and cleanup seam through the custody protocol while retaining one authenticated physical Node socket. The Node must receive an independent opaque viewer owner for attach, detach, disconnect, and plugin channel resources. Preserve physical socket sequence/authentication/revocation and bounded logical viewer maps. Define reconnect replay as the union of surviving viewer interests, not raw historical attach/detach frames. Logical IDs are transport ownership, never bearer credentials or a new plugin namespace.

An architectural checkpoint is required before implementation: logical viewers cannot multiply Docker processes or duplicate output delivery. Keep one Docker producer per appropriate `kind:container` resource and fan out to subscribers. A joining terminal viewer still needs a fresh canonical screen before live output. Preserve the efficient binary path and distinguish physical socket loss from one viewer's retirement. The coordinator must choose a typed multiplexing shape that satisfies all four requirements together.

Do not add Docker channel names to the helper, introduce renderer-held Node credentials, or open a second direct authenticated Node socket per renderer. Do not infer logical detach from arbitrary channel strings. Put generic identities in the protocol and custody owner, and plugin-specific stream sharing in the owning plugin.

After gates: two real authenticated renderer sockets and one authenticated Node socket, B joining after A's restore, A detach, A disconnect, final detach/disconnect, independent resources/Nodes, shared Docker log and stats streams, Docker exec lifecycle, duplicate attach, reconnect, broker removal, revocation, malformed IDs, task-confined internal credentials, physical sequence gaps, and binary payload equality. Last-viewer retirement reaches zero producers and sinks within a bounded wait. One viewer's retirement leaves the other receiving output. Track process/attach/restore counts as well as frame bytes so a correctness fix does not add steady CPU work.

Future web, mobile, and relay proposals benefit from explicit transport viewers. They still authenticate to the owning Node, and a relay continues carrying opaque routing metadata. Per-task execution isolation remains inside the Node.

## 16.3: consume or bound discarded TUI worker output

Evidence: `apps/tui/src/plugins/workerFactory.ts:56-66` captures stdout/stderr, then returns its adapter at `:81-82` without consuming either stream.

A real permission-constrained worker writes 256 KiB in 4 KiB chunks and honors `write()` backpressure. It stops at 65,536 bytes, with `stdout.readableLength === 65,536`, and does not reach its finish message during an 80 ms observation. The fixture then consumes stdout and stderr without printing them. All 262,144 bytes finish. This establishes a stalled producer, not an unbounded memory leak or measured CPU reduction.

Fix sketch: give captured stdout and stderr an explicit discard owner at creation. Drain bytes without converting to strings, keeping history, emitting one telemetry record per chunk, or piping them onto the TUI screen. Remove the discard handlers with worker termination. If the host needs an output budget, apply it to the worker owner and settle its normal failure path rather than accumulating a second queue.

After gates: write the same bounded 256 KiB without fixture-assisted drain and observe completion, exercise stderr, repeat workers and termination, and keep filesystem/network/child-process permission refusal intact. Validate noisy output under the real worker and monitor host memory after settlement. Draining permits a noisy plugin to continue producing; verify the host remains bounded instead of using an unread pipe as an accidental flow-control mechanism.

## 16.4: close UI worker resources when setup fails

Evidence: `workerHost.ts:196-203` spawns the worker and allocates both channels before invoking `input.connect`. The worker enters the map only at `:214`, so a thrown connection callback leaves no pool entry to stop.

The probe injects ten synchronous bridge setup failures. It records ten spawned workers, 20 message channels, zero terminations, and zero explicitly closed endpoints after `_stopAllTreeWorkers`. Only the transport is faked; the startup owner is production code. The fixture does not establish how often the shipped bridge throws.

Fix sketch: allocate into a local startup owner and dispose every allocated resource if connecting, installing handlers, transferring ports, or starting timers fails. Publish a usable worker only when startup succeeds. Cleanup must be idempotent and preserve the original error. Capture worker generation in error and heartbeat handlers so a late callback from an earlier worker cannot stop a replacement under the same hash. The existing grace callback already checks its generation; retain that guard.

After gates: exceptions at channel allocation, bridge creation, handshake transfer, and timer setup; healthy retry after failure; old-generation late error; repeated release; and pool teardown. Each failure terminates its spawned worker and closes both untransferred ends exactly once. No failure stops a serving replacement or sibling bundle. This can share a fix unit with 16.1's worker owner changes, but its resource counters remain a separate gate.

## 16.5: retire helper telemetry asynchronous work

Evidence: `packages/custody/src/telemetry.ts:154-157` awaits preferences and calls `apply` without a lifecycle fence. `:132-144` can re-register the collector sink. Disposal at `:219-226` does not mark the owner retired. `drain` at `:105-118` can also restore failed records after retirement or consent changes.

The actual owner fixture holds one preference GET, disposes the helper telemetry owner, then resolves the GET with consent enabled. The summary changes from no sinks and `collecting:false` to a `core` sink and `collecting:true` after disposal. The late request rearms the collector and pressure/flush lifecycle.

Fix sketch: use a permanent retired flag and an adoption/request generation. Capture the target Node for each operation; ignore a preference answer from another adoption or a retired owner. Prevent failed posting from restoring an earlier generation's queue after consent revocation. Keep the intended final flush, and bound or cancel owned requests without changing the Node preference authority. Avoid double-registering subscriptions after overlapping polls.

After gates: the measured late preference answer, A/B adoption ordering, overlapping polls, pending post success/failure during disposal, revoke then re-enable consent, repeated disposal, and final flush. After retirement, no sink or timer reappears and no failed batch resurrects. Keep crash-file redaction and bounded queues. Impact is strongest for lifecycle reuse/tests; actual helper shutdown normally terminates the process shortly afterward.

## Telemetry measurements and conditional follow-ups

The stable-seam fixture performs 100,000 trivial measured operations. Node telemetry consumes about 45.8 CPU ms when on versus 5.4 ms off; the client consumes 52.8 ms versus 3.7 ms. Node histogram flush costs 3.3 CPU ms. Both histograms report exactly 100,000 calls. These are aggregate fixture CPU values, including loop/JIT costs, not native navigation timings or a recommendation to remove instrumentation.

The 200-series cap is not a hard bound. `collector.ts:370` and client `emitter.ts:520` apply fallback only when labels are nonempty. One thousand distinct unlabeled seam names create 1,000 histograms in both actual emitters. Distinct fallback seam names can also create distinct entries after label stripping. This is a demonstrated API capacity gap; no first-party variable-seam workload was found. If selected, enforce a total series budget, preserve admitted series' exact aggregates, count refused new series, define the overflow vocabulary, and update the owning telemetry contract. Do not combine unlike units or silently attribute another operation's samples to a chosen seam. Test stable series, overflow names, owners, units, labels, totals, flush/retry, and consent.

The client queue remains bounded at 1,000 records after 100,000 pushes and reports 99,000 drops. Its full-queue trimming copies a 1,000-element array on each push (`queue.ts:30-34`), costing about 96 CPU ms in this synthetic burst. An index-based ring would remove that copying, but this workload has no demonstrated production frequency. Keep it below the measured ownership fixes. Preserve chronological `take`, retry prepend, keep-newest truncation, dropped counts, and independent queue instances if selected.

The RPC API fixture runs with collection off. Each of 10,000 rounds calls a returned span's `end` and passes the same visitor function to `measure`. After forced collection, heap grows from 18.1 MB at 1,000 rounds to 29.3 MB at 10,000 rounds, then drops to 17.0 MB after endpoint close. The host encodes 10,006 functions and the peer encodes 10,000. Compiled agents/workflows call Node telemetry directly; no first-party loaded Node plugin exercising these APIs across RPC was found. Carry these returned-handle and repeat-visitor cases into area's 02 explicit function lifetime and stable-identity fix. A returned span can remain open beyond its initiating call; releasing every returned function on RPC return would break that contract.

Sentry's exporter already caps both pending conversion batches and delivery envelopes at 200, isolates conversion from network retry, aborts on disposal, rechecks target/consent, and uses bounded exponential backoff. No network/Sentry ingest test was run here. Counts are not byte budgets; test large permitted batches only if field evidence points to exporter memory. Renderer responsiveness is focused/visible and consent-gated, runtime pressure aggregates over five seconds, and interaction work is capped at 20 interactions and 50 operation names per interaction. A broad new polling or tracing system is unnecessary.

## Prior work, rejected changes, and limits

Relevant history includes `3933f1a5` protecting replacement workers from retired grace timers, `64582440` adding UI freeze diagnostics with less agent rendering work, `bd64c0bf` introducing the collector/Sentry sink, and `ae1788dc` sending terminal size with attach. These improvements are present on the baseline. The investigation does not propose reversing their ownership, aggregation, binary transport, or restore ordering.

Keep compatible mounts' module state shared. Restarting a worker for every tree or remount trades its startup cost for the scope bug and changes plugin module semantics. Explicit authority-context pooling is a different option with measured startup/memory and documentation gates described above. Extending grace alone prolongs stale document authority. Weak references cannot substitute for a live remote callback lease. Scope worker context explicitly before tuning grace or adding retained plugin regions.

Do not call development User Timing entries an all-day production leak. `apps/desktop/src/client/boot.ts` records a finite boot account. Every span enters the browser performance timeline only after the explicit local `acorn.perf` switch enables it. That deliberate profiler history can grow during a measurement session; its retention is separate from normal consent-enabled telemetry.

The repeated worker remount, 10,000 RPC rounds, queue overflow, and socket disconnect fixtures are owner stress tests. They are not a day of real multi-project use. Native visible plugin latency, WebKit heap, Sentry live delivery, long-running user workflows, Docker daemon load, and Rust child-webview retention remain outside this area's measurements. The coordinator's native control attempts did not run a scripted workload during these probes. Reproduce the corrected owners in the staged real window, then run sustained navigation/terminal/plugin cycles and sample CPU/RSS after settled intervals.

No canonical drafts, execution records, terminal sessions, plugin databases, or offline caches were deleted to obtain the results. Future client plugins, replaceable chrome, web/relay clients, and task isolation retain their owning boundaries.
