# Transport performance audit

Recorded October 1, 2026, against `f8e4b59c`. Application source remained read-only. The isolated
`perf-baseline` desktop session was neither inspected for private data nor changed. All measurements
below use synthetic records, ephemeral loopback servers, or the owning methods with synthetic state.

The immediate opportunities are a helper event-filter correctness fix and compatible reductions in
body encoding and copying. Cancellation needs two small ownership repairs. The helper's downstream
queue is demonstrably unbounded, but the paused-reader experiment does not establish its frequency
in the real WebKit renderer. Do not turn that experiment into an unsupported wire redesign.

## Scope and ownership

Read the audit contract, the documentation index, architecture and naming conventions, API transport,
shell, cache, terminal, and remote-client proposal. Read the Improve performance and finding format
sections. Inspected the following owners and adjacent consumers:

| Owner | Inspected implementation | Responsibility |
| --- | --- | --- |
| Custody broker | `packages/custody/src/broker/nodeBroker.ts`, `nodeRequest.ts`, and their tests | One agent and WebSocket per Node, pins, credentials, HTTP controllers, reconnects, and outbound frames. |
| Desktop helper | `apps/desktop/src/helper/helperServer.ts`, its tests, and `rendererWatchdog.ts` | Authenticated renderer sockets, request dispatch, body conversion, event filtering, and push fanout. |
| Desktop renderer bridge | `apps/desktop/src/shell/bridge.ts`, `wire.ts` | One helper socket, pending reply map, base64 bodies, binary pushes, and host seam projection. |
| Node transport | `packages/node-core/src/server/transport/listener.ts`, `wsHub.ts`, and hub tests | HTTPS listener, Host checks, device authentication, per-connection stream sinks, sequences, backpressure, and shutdown. |
| Shared client | `packages/client-core/src/infra/node/apiClient.ts`, `wsClient.ts`, `wsChannels.ts`, `fanout.ts`, `attachment.ts`, `fleet.ts`, `activeNode.ts`, `watchNodeEvents.ts`, and associated tests | API requests, explicit abort messages, active-Node filtering, channel dispatch, per-Node caches, and partial fleet results. |
| Visible consumers | Fleet Home, workspace picker, attention inbox, palette navigation, chrome badges and extension groups, Agent Center, desktop startup, and Terminal `wsChannel.ts` | Aggregate reads, active-Node selection, cache invalidation, and terminal attachment and output. |
| HTTP adapter | Installed `@hono/node-server` 2.0.11 `dist/index.mjs`, request listener and close handler | Converts a premature client close into the route `Request.signal` abort. |

### Source-to-consumer flows

An HTTP read starts in a pane, chrome source, or fleet aggregate. `readJson` names it and attaches
request and trace headers. `nodeTransport.fetch` reaches the desktop bridge, which base64-encodes
any body, sends a JSON helper request, and retains its resolver. The helper validates the request,
decodes its body, and calls the custody broker. The broker attaches its device bearer, uses the
Node's shared pinned keep-alive agent, and sets a 30-second deadline unless the route asks for
another deadline. `nodeRequest` buffers HTTP response chunks, concatenates them, and copies the
result into a `Uint8Array`. The helper base64-encodes it. The renderer parses the reply, decodes the
body, and parses JSON. TanStack Query stores the value in that Node's own cache. A fanout read uses
that same cache and shared in-flight query, with a five-second aggregate deadline and cached partial
results. The attachment settings read uses this path for every paired Node.

A terminal output starts in the PTY engine and reaches the hub through a session sink. The hub
encodes the message once into a UUID-tagged binary frame shared across its sinks. The broker forwards
the bytes. The helper adds the Node UUID and sends the nested frame to renderer sockets. The bridge
peels the Node UUID, `wsClient` filters by active Node, and Terminal's channel owner peels the session
UUID and delivers output to that session's subscribers and emulator. JSON invalidations follow the
same sockets, with an additional broker parse and helper stringify. The Node assigns JSON sequence
numbers. The broker detects gaps before the helper filter. The channel registry then dispatches by
prefix, and desktop watchers invalidate the active Node's query cache or emit client events.

### Resource lifetime and intentional bounds

The broker holds one reusable agent per Node, rather than opening a pinned agent per request.
`remove` stops reconnect and heartbeat timers, terminates the Node socket, and destroys the agent.
`dispose` also aborts all tracked HTTP requests. Each HTTP completion clears its deadline and removes
its controller. `nodeRequest` removes its signal listener when the request closes.

The Node hub holds sinks per authenticated socket and reference counts producer pauses across
connections. Above 4 MiB of socket buffering it sends the terminal frame and pauses that producer.
Below 2 MiB, a 50 ms poll releases the holds. Disconnect releases holds before detaching sinks and
calling plugin channel cleanup. Non-producer frames are shed with one `ws:shed` marker per congestion
window, preserving sequence continuity. The listener disposes both event and tunnel upgrades before
closing HTTP connections and disposing storage and plugins.

The renderer bridge rejects every pending reply when the helper socket closes. Its frame and status
listeners, and `wsClient`'s subscriptions to the bridge, have renderer lifetime. Plugin channel and
terminal subscriber registrations have explicit disposal. Terminal reattachment sends one attach
per session with live subscribers; the Node treats a repeated attach on one connection as idempotent.

## Prior work retained

`449807fb` introduced binary terminal frames, one encode per broadcast, and retained terminal
surfaces. `28781ae6` reduced event amplification and introduced early helper filtering.
`7d62e3ec` retained the measured threshold for a future binary HTTP body wire and deferred a broader
interest model pending real fleet evidence. The September 25 change `ae1788dc` sends terminal size
with attach, and `702c03cf` moves run-target reads into the cache. `4ca96934` gates initial reads on
local broker readiness. The branch also retains stream resume/folding and bounded agent snapshots.

These changes are shipped. This audit does not propose JSON terminal output, a second HTTP
transport, repeated attach snapshots, wider invalidation, weaker pinning, or an offline HTTP write
replay queue. The response-buffer reuse in `66b545d0` belongs to synchronous plugin RPC. It does not
remove the copy in `nodeRequest` identified below.

## Measurements and replay

The host runs Node 24.11.0 on macOS arm64. The probes are bounded and retain no user content.
Baseline results are [transport before results](./05-transport-before.json),
[fanout before results](./05-fanout-before.json), and [outbox before results](./05-outbox-before.json).
Replay to separate files from the repository root:

```sh
rtk proxy node --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/05-transport-probe.mts > plans/performance/05-transport-replay.json
rtk proxy node --conditions=browser --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/05-fanout-probe.mts > plans/performance/05-fanout-replay.json
rtk proxy node --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/05-outbox-probe.mts > plans/performance/05-outbox-replay.json
```

The transport and outbox probes need permission to bind ephemeral loopback sockets. Sandbox execution failed with
`listen EPERM`; automatic escalation approved the synthetic server experiment. No credential from
a profile is read. The first attempts also exposed probe issues: `.ts` used CommonJS transformation
for top-level await, and short synthetic IDs selected the JSON fallback. The retained `.mts` probe
uses valid 36-byte UUIDs. The reported binary measurements come from the corrected run.

### Body costs

Seven rounds per size call the actual `wire.ts` encoder and decoder. The native comparator reads
the exact `Uint8Array` view with `Buffer.from(buffer, byteOffset, byteLength).toString('base64')` and
verifies identical wire characters. These are synchronous V8 CPU measurements, not end-to-end or
WebKit latency. JSON stringify, socket delivery, and application JSON parsing are excluded.

| Body | Base64 characters | Shared encoder median | Decoder median | Native Node encoder median |
| --- | ---: | ---: | ---: | ---: |
| 64 KiB | 87,384 | 1.41 ms | 0.096 ms | 0.011 ms |
| 2 MiB | 2,796,204 | 46.82 ms | 2.98 ms | 0.140 ms |
| 8 MiB | 11,184,812 | 184.19 ms | 12.79 ms | 0.796 ms |

Fifteen rounds compare the precise response-assembly expression with `Buffer.concat` alone for
128 chunks of 64 KiB. The medians are 0.880 ms and 0.446 ms. Removing the clone removes one 8 MiB
allocation per 8 MiB response. This expression benchmark excludes HTTP receiving and garbage
collection over a long session. It does not imply an 8 MiB live response exists in the fixture.

### Filtering, queue, and cancellation counts

The real helper server first addresses Node A, then receives concurrent synthetic fleet reads for
A and B. Before fanout it forwards A's JSON and binary frames and both status rows. After fanout it
forwards B's JSON and binary frames and drops A's. A rejected malformed B fetch has the same effect.
A second renderer addressing B also changes the first renderer's filter. Both Nodes' status rows
remain delivered in every case.

The actual hub-to-broker-to-helper chain sends 256 binary frames with 64 KiB payloads while a
synthetic renderer socket is paused. In 676 ms, 16 MiB of payload leaves the hub. The helper's
maximum `bufferedAmount` reaches 16,010,792 bytes, the hub's maximum is zero, and the producer gets
zero pause calls. All 256 frames arrive after the reader resumes. Socket send interception records
buffer counts without changing production source. The synthetic producer calls the owning sink;
it is not a real process executing in a PTY. This establishes queue ownership and missing propagation.

A helper request with a synthetic unresolved broker fetch is active after its renderer closes:
one active request and zero broker abort calls. It finishes only when the probe manually resolves
the fake fetch. A direct `nodeRequest` control against the real Hono adapter yields `AbortError`
and aborts the route signal in 2.26 ms after cancellation. In the separate API probe, passing an
already-aborted signal still performs one transport fetch, sends zero abort messages, and returns
success.

The fanout probe starts one real TanStack query with one subscribed `QueryObserver`, then joins it
through `fetchFleet`. Its 25 ms aggregate deadline settles after 26.31 ms with an unavailable row.
The query still has one observer, one request, and zero aborts. Completing that request updates both
the observer and its cache. Cancelling it at the aggregate deadline would cancel another consumer's
work.

The offline outbox probe first invokes the real `NodeBroker.send` method with a synthetic disconnected
connection. One thousand attach/detach cycles retain 2,000 JSON frames, 138,000 UTF-8 bytes, and both
ends of each obsolete subscription. It then queues those frames before the first open of a real
broker/hub connection. The hub and real `TerminalDisplay` invoke 1,000 attaches, snapshots, ring
replay writes, screen factory calls, and screen disposals, even though final active sinks are zero.
The factory uses a synthetic screen, so the 48.32 ms run measures transport and lifecycle dispatch,
not real headless emulator CPU. This is neither an observed user workload nor a heap-size measurement.

## Actionable findings

| ID | Finding | Priority | Impact | Effort | Fix risk | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Make event selection explicit per renderer | P1 | Fleet reads and another renderer suppress active output and invalidations without recovery. | M | Medium | High |
| T02 | Use native base64 for helper replies | P2 | Removes about 46.7 ms of synchronous helper CPU for a synthetic 2 MiB response. | S | Low | High for mechanism and measured cost |
| T03 | Remove the second HTTP response allocation | P2 | Removes one body-sized allocation on every broker response. | S | Low | High |
| T04 | Reject a request whose signal is already aborted | P2 | Avoids sending and decoding a request its caller has cancelled. | S | Low | High |
| T05 | Cancel helper fetches owned by a disconnected renderer | P2 | Avoids route work and reply conversion after its consumer disappears. | M | Medium | High |
| T06 | Coalesce obsolete subscription frames before reconnect | P2 | Replaying 1,000 completed attach/detach pairs schedules 1,000 unnecessary display restores. | M | Medium | High for amplification |

### T01: Make event selection explicit per renderer

- Evidence: `apps/desktop/src/helper/helperServer.ts:109` holds one global `addressed` value.
  Lines 114 and 123 drop JSON and binary frames against it before iterating renderer sockets.
  Lines 147 and 165 overwrite it for any named request, before full validation.
- Evidence: `packages/client-core/src/infra/node/fanout.ts:145` calls every target concurrently.
  `packages/client-core/src/features/workspaces/fleetWorkspaces.ts:26` and
  `packages/client-core/src/features/notifications/attentionInbox.ts:65` use that behavior.
  The workspace picker mounts in `apps/desktop/src/client/App.tsx:359`, so the conflict is not limited
  to opening the Fleet page.
- Evidence: `packages/client-core/src/infra/node/activeNode.ts:28` changes the actual active Node
  without notifying the transport. `wsClient.ts:102` drops other Nodes again on receipt.
- Impact: The renderer's active Node A can receive neither terminal bytes nor task/chrome changes
  after a fleet read addresses B. The broker has already processed A's sequence, so its gap detector
  cannot detect helper loss. A cached Node switch need not make an immediate request, leaving the
  inferred selection behind the actual selection. The two-renderer probe confirms interference.
- Effort: M, about a day including seam, compatibility, and multi-client characterization tests.
- Risk: Medium. Startup, optional host seams, cache-driven Node switches, and plugin streams need
  consistent ordering. Preserve the early compatibility behavior and all-Node status delivery.
- Confidence: High. The request-to-filter mismatch is reproduced through the real helper socket.
- Fix sketch: Add a host-neutral transport operation for declaring event Node subscriptions, and
  implement it on the helper wire. Store validated subscriptions per renderer socket. Have the
  authoritative active-Node path declare selection even when no read occurs. A selected subscription
  must not change because a read targets another Node. Preserve an explicit pre-selection/older-peer
  fallback, keep the renderer's second filter, and remove socket state on disconnect. A subscription
  set leaves room for a future fleet live surface without importing desktop state into client-core.
  Keep steady inactive-Node forwarding reduced.
- Verification: Add cases to `helperServer.test.ts` and the shared platform/active-Node tests for
  two sockets, fleet reads, a cached switch with no API call, malformed calls, JSON and binary
  filtering, all-Node statuses, and disconnect. Count A's frame deliveries before and after a B
  aggregate read. They must remain equal after A declares its subscription.

### T02: Use native base64 for helper replies

- Evidence: `apps/desktop/src/helper/helperServer.ts:151` runs the shared `encodeBytes` synchronously
  after every broker response. `apps/desktop/src/shell/wire.ts:86` spreads byte chunks into JavaScript
  strings before calling `btoa`.
- Impact: A 2 MiB body occupies the helper event loop for a median 46.82 ms in this probe. Concurrent
  replies serialize this work and delay other requests, status pushes, and cancellation. The 8 MiB
  example costs 184.19 ms. The body wire still has 33% size overhead; this change removes encoder
  work, not that overhead. The historical 2 MiB agent page in `wire.ts` is not evidence of present
  response frequency or a before latency for the bounded snapshot implementation.
- Effort: S, several hours including byte-offset and wire compatibility tests.
- Risk: Low. Keep the exact base64 spelling and browser-portable shared encoder. Do not import
  `node:buffer` into the renderer's shared `wire.ts` graph.
- Confidence: High for measured helper CPU and the compatible alternative. Product frequency of
  multi-megabyte bodies is unmeasured.
- Fix sketch: Use a Node-only helper codec or local helper function that encodes the exact view with
  `Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')`. Keep the helper
  reply shape and the browser decoder. The native encode comparator is 0.140 ms at 2 MiB and
  0.796 ms at 8 MiB. Treat helper-native request decoding as a separate, lower-cost optional change.
- Verification: Compare both codecs for empty bytes, all byte values, Unicode represented as UTF-8,
  a subarray with nonzero offset, large data, and the binary download route. Replay the body probe
  and the helper fetch test with a multi-megabyte synthetic response. Report CPU separately from
  bridge latency. Retain Node identity, pinning, and authentication tests.

### T03: Remove the second HTTP response allocation

- Evidence: `packages/custody/src/broker/nodeRequest.ts:51` retains response chunks.
  Line 61 calls `Buffer.concat` and then `new Uint8Array` with the Buffer value, which copies it.
- Impact: Response assembly temporarily holds the chunks and two whole body allocations. The clone
  costs one extra N-byte allocation and N-byte copy for a response of N bytes. At 8 MiB, the
  expression probe saves about 0.43 ms median by keeping only the concatenation. Allocation reduction
  is the stronger reason to take this small fix.
- Effort: S, several hours including empty-body, offset, binary, and abort regression checks.
- Risk: Low. The concatenated response is owned by this request and is not reused. Returning a
  `Uint8Array` view must preserve its precise byte range and the contract's `Uint8Array` brand.
- Confidence: High for the redundant allocation. No long-session garbage-collection reduction is
  claimed from the expression benchmark.
- Fix sketch: Concatenate once, then return
  `new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength)`. Keep fully buffered response
  semantics. Avoid returning a Buffer merely because it passes `instanceof Uint8Array`; preserve
  callers that expect the plain view. The same small API-owner pass can compute
  `asNodeBody(options.body)` once at `apiClient.ts:193`, where string bodies are encoded twice.
  That duplicate encoding is evident in source but its material CPU cost was not measured here.
- Verification: Cover zero chunks, one chunk, fragmented binary data, and retained responses after
  a second request. Verify the response bytes and plain `Uint8Array` constructor. Replay response
  assembly with the view variant and compare allocations, not just elapsed medians.

### T04: Reject a request whose signal is already aborted

- Evidence: `packages/client-core/src/infra/node/apiClient.ts:185` only registers a future abort
  listener, then calls `transport.fetch` at line 188. It never checks `signal.aborted` in this path.
  The same-origin browser branch does pass the signal directly to `fetch`.
- Impact: A pre-cancelled broker call still leaves the renderer, consumes route work, returns a body,
  and decodes it. The probe records one fetch, zero abort calls, and success. This makes broker and
  browser cancellation behavior differ.
- Effort: S, several hours including pre-abort and ordinary in-flight abort tests.
- Risk: Low. Preserve the named abort result and remove signal listeners in the existing `finally`.
- Confidence: High. The real `readJson` and platform seam reproduce the behavior.
- Fix sketch: Check or throw for an already-aborted signal before sending or encoding the body,
  then install the listener and start the request. Keep in-flight cancellation explicit across the
  helper boundary. `nodeRequest.ts:25` also encodes before its own pre-abort check; move that check
  before encoding when touching that owner.
- Verification: Add an `apiClient.test.ts` case that asserts zero transport fetches and a named abort
  rejection for a pre-aborted signal. Retain normal abort propagation and the invariant that a
  cancelled or timed-out route does not make a healthy Node offline.

### T05: Cancel helper fetches owned by a disconnected renderer

- Evidence: `apps/desktop/src/helper/helperServer.ts:324` dispatches asynchronous work without a
  socket-owned request registry. Line 365 removes only the socket and watchdog. The fetch handler
  at line 150 can continue after that cleanup.
- Evidence: `apps/desktop/src/shell/bridge.ts:80` rejects pending calls on helper close. The
  `apiClient.ts:198` finalizer then removes their renderer signal listeners. The broker has a working
  abort method at `packages/custody/src/broker/nodeBroker.ts:267`.
- Impact: A closed/reloaded renderer loses its reply, but route and helper work persists until it
  finishes or the broker's 30-second deadline expires. A route override can extend that period.
  A successful late response also incurs unnecessary base64 conversion and a send to a closed
  socket. The synthetic helper request remains active with zero abort calls after disconnect.
- Effort: M, about a day including socket request ownership and concurrent-client tests.
- Risk: Medium. Cancel only requests owned by that connection. Cancellation is not transaction
  rollback or cancellation of a durable agent/task. Other renderers, custody-internal fetches, and
  shared per-Node queries retain independent ownership.
- Confidence: High for missing helper cleanup. Frequency during normal use is unmeasured.
- Fix sketch: Track valid `node-fetch` requests in per-socket context. Abort that context's broker
  requests on socket close and remove each entry in `finally`. Namespace the broker request handle
  by connection so identical renderer request IDs cannot affect another renderer; preserve the
  original HTTP request/trace headers for correlation. Avoid encoding or sending replies to a closed
  socket. Apply this at the helper request seam, where renderer lifetime is known.
- Verification: Close one renderer during a slow synthetic HTTP request while another renderer has
  a request in flight. Only the first must abort, and the registry must empty on success, error, and
  close. Verify ordinary HTTP route signal cancellation. Worker-route propagation is owned by area 02
  and needs its own downstream fix and tests; do not duplicate it here.

### T06: Coalesce obsolete subscription frames before reconnect

- Evidence: `packages/custody/src/broker/nodeBroker.ts:278` appends every disconnected frame and
  line 297 flushes the queue before reporting online. No subscription compaction occurs.
- Evidence: `plugins/terminal/src/client/wsChannel.ts:41` and line 48 emit attach and detach for
  a subscription that may end during an outage. `packages/node-core/src/server/transport/wsHub.ts:375`
  creates a sink on each attach and removes it on detach. Repeated attach is idempotent only while
  that sink remains attached, so a following detach allows the next obsolete attach to run again.
- Evidence: `plugins/terminal/src/server/terminal.ts:781` calls `TerminalDisplay.attach`, which
  initializes a screen and requests a snapshot at `terminalDisplay.ts:180`. Detach releases that
  screen at line 203. `packages/client-core/src/infra/node/wsChannels.ts:47` already rebuilds the
  subscriptions that actually remain live after a reconnect.
- Impact: Offline pane churn becomes a reconnect burst of restore requests for viewers that have
  disappeared. The real owner probe produces 1,000 snapshot, replay, and screen creation calls for
  a final detached stream. A real emulator can make those calls much more expensive than the
  synthetic factory, but this audit does not assign a CPU estimate to that difference. The same
  unbounded outbox can retain terminal input, so blanket dropping is unsafe.
- Effort: M, about a day including replay policy, ordering, initial-open, and plugin compatibility tests.
- Risk: Medium. Preserve ordinary input and action order, initial connection behavior, and the
  owner's distinction between replayable desired state and non-replayable commands.
- Confidence: High for count amplification. Normal outage churn and its resulting CPU are unmeasured.
- Fix sketch: Represent subscription intent by stream and retain only the desired subscription state
  for a fresh connection. Supply the coalescing policy from the owning channel or a typed transport
  hint, rather than interpreting arbitrary plugin payloads in custody. Preserve opaque input/actions
  in order, and use them as barriers if compaction could change their meaning. Preserve initial-open
  behavior separately from reconnect reattachment. A final detached subscription with no intervening
  command must produce no restore. Avoid arbitrary limits that discard PTY input or generic actions.
- Verification: Drive the real broker/hub/display owners with alternating subscription frames. The
  final detached case must invoke zero snapshots, and a final attached case must attach once with
  the final size. Include initial open, reconnect, shared session subscribers, interleaved streams,
  input/action order, removed panes, and unknown plugin channels. Then measure a small real emulator
  replay against a disposable session. Do not extrapolate a thousand-cycle stress fixture to a day
  of user activity.

## Characterized risks requiring incidence or design evidence

### Downstream helper buffering does not reach the Node's PTY backpressure

Evidence is `helperServer.ts:116` and `helperServer.ts:126`, which send to every eligible renderer
without a buffer check, paired with `nodeBroker.ts:305`, which drains Node messages immediately.
`wsHub.ts:243` measures only its own socket. The corrected experiment retains about 15.3 MiB at the
helper while the Node sees zero buffering and never pauses. Confidence is high for the ownership
gap. Confidence is medium for a material normal-workload problem because the native browser socket
can receive data independently of the JavaScript consumer.

A renderer whose socket stops reading and a renderer whose main thread processes output slowly are
different cases. If the native socket continues draining, helper `bufferedAmount` can stay low while
the browser's message queue or Terminal parser grows. This audit did not reproduce that case in a
visible Tauri window. The separate terminal report owns parser pressure and oversized snapshots.

The fix requires a connection and Node ownership design, with high correctness risk. Pausing the
broker's underlying Node socket also stops pong processing. Its 15-second heartbeat can then mark
a responsive Node unreachable, and the Node's own sweep can terminate that paused connection.
One broker connection feeds several renderer sockets, so per-renderer holds must compose and release
on disconnect, Node removal, and helper shutdown. Discarding binary frames would corrupt a terminal.
Closing only the helper socket is also insufficient: the renderer bridge reconnects lazily, while
`wsClient` only reattaches and invalidates on a Node status reconnect. Recovery must restore terminal
snapshots and queries explicitly.

Before implementing a wire change, collect helper socket buffer counts during a visible heavy-output
Tauri workload and intentional renderer stalls. If sustained queues reproduce, design a bounded
per-renderer congestion policy with a finite timeout, complete hold release, and recovery. Preserve
pongs and the existing Node flow control. An additive producer control/credit capability would need
peer compatibility and an older-Node fallback, rather than indefinite TCP pause. Do not implement
that protocol based only on the synthetic paused receiver.

## Considered and rejected

- Cancelling the shared query at every fanout deadline is incorrect. The observer probe demonstrates
  one in-flight query serving another live reader. Preserve per-Node cache warming and partial
  results. An owner-exclusive query could have a separately defined execution deadline, but a blind
  `cancelQueries` call is not an acceptable optimization.
- Replacing broker HTTP with unpinned global `fetch` would remove the custom CA and fingerprint
  verifier shared with `ws`. Retain the pinned keep-alive agent, protocol probe, device bearer, and
  hard stop on an identity mismatch.
- Raising the broker timeout or marking slow routes offline does not repair cancellation. Preserve
  explicit long-route exceptions and heartbeat-owned connection health.
- Moving all HTTP bodies to binary frames is not justified by these measurements. Native helper
  encoding removes the dominant measured encoder CPU while retaining the wire. Live present-day
  body sizes and response frequency are unmeasured.
- Restoring all-Node helper forwarding indefinitely would hide T01 while losing the shipped fleet
  bandwidth optimization. Declare subscriptions and filter per renderer instead.
- Removing the renderer's Node filter would permit colliding session IDs or cache invalidations
  from another Node to reach active consumers. Keep both boundaries.
- Adding another terminal attach/replay buffer would duplicate the shipped canonical snapshots,
  idempotent attachment, and reconnect behavior. Retain the Node's 4 MiB pause policy and shed marker.
- Imposing one fleet-wide request failure or serializing all targets would weaken offline partial
  results and make fast Nodes wait for slow ones. No measured fleet saturation justifies that change.
- The hub's singleton connection set assumes one listener per Node process. Production respects that
  runtime ownership. Cross-listener teardown behavior is not presented as a performance defect.

## Implementation order and verification gates

T02, T03, and T04 are small independent compatible changes. T01 needs a coordinated seam and helper
implementation. T05 can reuse the per-socket context introduced by T01. Keep worker cancellation
work coordinated with area 02. Any later queue policy depends on explicit per-socket subscriptions
and request ownership, with separate congestion and reconnect tests.

After source implementation, run `pnpm lint` and the changed owners' relevant tests. The focused
commands avoid rebuilding the desktop during every transport iteration:

```sh
rtk pnpm --filter @acorn/custody exec vitest run src/broker/nodeBroker.test.ts
rtk pnpm --filter @acorn/client-core exec vitest run src/infra/node/apiClient.test.ts src/infra/node/fanout.test.ts src/infra/node/fleet.test.ts src/infra/node/wsClient.test.ts
rtk pnpm --filter @acorn/node-core exec vitest run src/server/transport/wsHub.test.ts
rtk pnpm --filter @acorn/desktop exec vitest run src/helper/helperServer.test.ts
rtk pnpm lint
rtk pnpm test
```

Add the precise platform, active-Node, wire, and helper cleanup cases described under each finding.
Keep TLS pin mismatch, protocol incompatibility, revocation, heartbeat, binary byte preservation,
idempotent attach, cross-client pause release, shed recovery, and offline drafts covered. Any visible
desktop change requires a real isolated Tauri window using `pnpm dev:agent`, the UI driver, and
`stop`, coordinated with the session owner. A real two-Node fixture is necessary to verify T01 in
product navigation. Do not rely on hidden-window paint or navigation timings.

Update `docs/shell.md` for event subscriptions and helper request ownership, `docs/api-reference.md`
for any cancellation semantics that change, and `docs/terminal.md` only if a queue policy changes
terminal input or recovery. The future remote-client proposal keeps browser auth and custody
separate. The proposed fixes retain host-neutral transport operations and plugin-owned payloads.

## Validation limits

This area did not rerun the full lint/test baseline because application source did not change and
the coordinator recorded those checks as passing. It did not profile a visible renderer, seed
another live Node, or modify `perf-baseline`. It did not measure real body-size distributions,
normal disconnect frequency, day-long heap growth, WAN latency, or large fleet socket counts.

Sentry route tails in `baseline.md` identify server leads but have no release IDs and can include
suspension. They cannot attribute time to this helper encoder, this checkout, or a cancelled
request. The measured CPU, byte counts, frame counts, and ownership failures above stand separately
from that telemetry. The retained probes cover the concrete candidates; additional optional stress
runs are not needed to complete this audit.
