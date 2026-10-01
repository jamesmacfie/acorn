# Unit 03: Transport ownership and byte work

Implemented October 1, 2026 in the cumulative performance worktree. Units 01 and 02 remain intact.
This record covers transport findings T01–T06, the transport portion of navigation finding 07, and
the shared-viewer finding 16.2. It does not mark the overall performance programme complete.

## Architecture and compatibility

The path is renderer selection/channel owner → host-neutral transport seam → authenticated helper
renderer socket → custody Node broker → one authenticated physical Node socket → Node viewer
dispatcher → terminal or plugin owner. HTTP follows the same renderer/helper custody boundary, with
request ownership independent of event ownership. Credentials, certificate pins, device revocation,
internal claims, heartbeat, JSON sequence and producer backpressure remain physical-connection state.

The coordinator reviewed the protocol sketch before broad wire edits and approved these refinements:

- Protocol major 1 and baseline `acorn-1` remain. Optional `eventTransport: { viewers: 1 }` uses the
  existing pinned pre-authentication `GET /v1/node` on every connect. There is no added round trip.
- Only explicitly opted-in hosts send `x-acorn-viewers: 1` after a recognized advertisement. Default
  `NodeBroker` callers, including the TUI, retain raw JSON and the 36-byte session-UUID binary layout.
  Missing, malformed optional advertisement, unknown-version or unsuccessful probes retain the
  established legacy transport. Only the feature field falls back; identity contracts remain intact.
- Opted-in JSON and binary viewer envelopes route opaque UUID ownership. The broker's stable default
  viewer also uses the declared codec, counts toward capacity, and retires normally. Physical JSON
  sequence validation happens before viewer routing; binary output consumes no sequence number.
- The physical parent's claims authorize every logical dispatch. A logical token does not become an
  unconfined synthetic connection. A task-scoped credential cannot acquire plugin channels or another
  task's terminal through nesting.
- Capacity is 128 live viewers, including the default. `viewer_limit` and `viewers_unsupported` are
  observable targeted transport errors, including before lazy client subscription and while the Node
  sheds invalidations. They do not mark the Node offline or prevent a sibling from operating.
- Selected Node interest opens a generic event lease, independently of plugin payloads. Selection
  A→B releases A; a cached return opens a fresh lease. Fetch-only modern observers declare null and
  acquire none. Old helper clients without an interest declaration retain wildcard forwarding.
- Legacy Nodes allow one event lease. Their output targets that owner; refused B cannot receive A's
  canonical restore. Closing A reconnects only the physical events socket because an old Node has no
  generic logical close. This changes shared event status/custody subscriptions; independent HTTP
  reads remain usable. The explicit handoff test verifies B can acquire after release.
- A channel owner supplies typed subscription intent outside its opaque frame. Compaction respects
  command barriers and multiple streams, and replay seeds surviving desired state before queued
  commands. Only the latest first-segment attach requests a restore. Inputs/actions/unknown frames
  retain FIFO for live ownership. Disposal drops the retired viewer's queued commands and intent;
  delivery across disposal is not guaranteed. No arbitrary input queue cap was added.

## Changed owners

Paths below are relative to the repository root. New modules keep ownership out of entrypoints.

| Owner | Changed files | Reason |
| --- | --- | --- |
| Protocol | `packages/protocol/src/{ws,node,broker}.ts`; `packages/node-core/src/server/routes/pairing.ts` | Central optional advertisement, strict viewer codec, intent and generic error contracts. |
| Custody | `packages/custody/src/broker/{nodeBroker,nodeRequest,brokerFetch,eventViewers,subscriptionOutbox}.ts`; `packages/custody/src/index.ts` | Physical auth/sequence/socket owner, isolated HTTP handles, disposable viewer admission and desired replay. |
| Node transport | `packages/node-core/src/server/transport/{wsHub,wsViewers,wsViewerDispatch}.ts` | Viewer-specific sinks/plugin tokens, authorization from physical claims, final resource retirement and critical admission replies. |
| Helper | `apps/desktop/src/helper/{helperMain,helperServer,rendererConnection,bodyCodec}.ts` | Socket-specific interests, UUID request namespaces, owned close/abort, exact native byte views, lazy shared push encoding. |
| Renderer bridge | `apps/desktop/src/shell/{bridge,wire}.ts` | Remembered interest on helper reopen, intent/cleanup forwarding and queued generic transport errors. Browser codec stays portable. |
| Client and hosts | `packages/client-core/src/infra/node/{activeNode,apiClient,wsChannels,wsClient}.ts`; `packages/client-core/src/infra/platform/{index,contract}.ts`; `packages/plugin-api/src/client.ts`; `apps/tui/src/platform.ts` | Authoritative selection, owner-provided hints, pre-abort, error display and captured-Node send seam without Node imports in browser modules. |
| Terminal | `plugins/terminal/src/client/{wsChannel,terminalClient}.ts` | Current desired size, idempotent live size-intent update and latest-size reconnect. Retired/foreign local slots cannot reopen on resize. |
| Docker | `plugins/docker/src/server/{wsChannel,sharedStreams,logReplay}.ts`; `plugins/docker/src/client/wsChannel.ts` | One producer per kind/container, targeted bounded joining replay/latest stats, independent exec, synchronous construction/end unwind and desired hints. |

Regression tests live beside these owners: helper body/connection/server; shell bridge transport;
client API/selection/socket; custody request/viewer/outbox; Node hub; Terminal channel; Docker shared
stream and channel tests. Docker tests use the plugin facade rather than importing core internals.

Owning documents updated: `docs/api-reference.md` (deliberate versioning extension and wire/lifecycle),
`docs/shell.md` (interest/request/codec custody), `docs/terminal.md` (viewer restore, size and switch
lifetime), `docs/docker.md` (producer/replay), `docs/security.md` (physical authority), and
`docs/plugin-authoring/the-node-half.md` (opaque channel lifetime token). No persisted schema changed.

## Correctness gates and fail-before cases

| Gate | Result |
| --- | --- |
| Two helper renderer sockets with fleet reads, malformed calls, cached/equivalent selection, origin cleanup, binary/JSON filtering and all-Node statuses | Passed; interests remain per renderer. Inactive/missing-target payloads are not serialized/tagged; eligible recipients reuse one encoding. |
| Equal renderer request IDs, close/abort isolation, unchanged HTTP trace/request headers, success/error/close registry retirement and late body getter | Passed; A cannot cancel B, and closed A performs no late encoding. |
| Pre-aborted client and `nodeRequest` body | Passed; zero transport calls/body encoding and zero body getter access, respectively. Normal body computation happens once. |
| Native codec exact offset/empty/all-byte/UTF-8/large views; zero/single/fragmented retained HTTP responses | Passed; exact bytes, plain `Uint8Array` and retained response validity. |
| Default broker raw compatibility; opted-in default UUID codec and retirement; old/unknown/unreachable Nodes and explicit second-viewer refusal/handoff | Passed. Existing ordinary single-viewer operation remains usable. |
| 1,000 initial attach/detach cycles, final detached or attached | Passed through actual broker sockets: detached sends zero terminal attaches; attached sends one latest-size attach. |
| Reconnect compaction with live desired seed, latest dimensions, command barriers, multiple streams, unknown FIFO and viewer retirement | Passed. The authenticated helper/broker/hub/PTY/display chain restores once at 144×44 after resize plus renderer online reattach. |
| Independent A/B terminal restore, A detach/close, final close and scoped internal tokens | Passed; B gets a fresh targeted restore, A is not reset, B survives and final resources retire. |
| Congested capacity refusal | Passed; explicit error survives shedding with contiguous physical JSON sequence. |
| Docker sharing, joining exact tail/latest stats, final stop, end once, synchronous throw/end and independent exec IDs | Passed. Distinct opaque connection tokens share one log producer and retain separate exec PTYs. |
| Actual `initSessions` scope callback → `clearSessions` → `releaseAllTerminals` with channel eviction on A→B→A | Passed; held terminals dispose and return attaches freshly without requiring physical online status. |

The preserved baseline demonstrates these failures directly: B receives zero ready frames after A's
restore; A detach removes the sole shared sink and stops B's Docker logs; last renderer close leaves
one terminal sink on the retained Node socket; a fleet read retargets forwarding and admits 128
inactive-Node invalidations. The original audit artifacts also preserve 1,000 obsolete snapshots from
2,000 queued frames, a helper fetch left active after close, and one transport call for pre-abort.
The new acceptance assertions deliberately require independent viewer/zero-retired-resource outcomes.
Before evidence files were not overwritten.

### Exact focused commands

All commands were run from this worktree with Node 24.11.0. Socket suites required automatically
approved escalation for owned ephemeral loopback listeners after sandbox `listen EPERM`.

```sh
rtk pnpm --filter @acorn/desktop exec vitest run src/helper/helperServer.test.ts src/helper/rendererConnection.test.ts src/helper/bodyCodec.test.ts src/shell/bridge.test.ts src/shell/bridgeTransport.test.ts
# 5 files / 18 tests passed; final targeted helper addition then passed 6/6 in rendererConnection.test.ts.
rtk pnpm --filter @acorn/node-core exec vitest run src/server/transport/wsHub.test.ts
# 36 tests passed.
rtk pnpm --filter @acorn/custody exec vitest run src/broker/nodeBroker.test.ts src/broker/nodeRequest.test.ts src/broker/subscriptionOutbox.test.ts src/broker/nodeViewers.test.ts
# 4 files / 46 tests passed.
rtk pnpm --filter @acorn/custody exec vitest run src/broker/nodeBroker.test.ts src/broker/nodeViewers.test.ts
# Final malformed optional-advertisement addition: 2 files / 46 tests passed.
rtk pnpm --filter @acorn/client-core exec vitest run src/infra/node/apiClient.test.ts src/infra/node/activeNode.test.ts src/infra/node/wsClient.test.ts src/infra/node/wsChannels.test.ts src/infra/node/fanout.test.ts src/infra/node/fleet.test.ts
# 6 files / 66 tests passed.
rtk pnpm --filter @acorn/plugin-terminal exec vitest run src/client/wsChannel.test.ts
# 8 tests passed.
rtk pnpm --filter @acorn/plugin-docker exec vitest run src/server/sharedStreams.test.ts src/server/wsChannel.test.ts
# 2 files / 6 tests passed.
rtk pnpm --filter @acorn/protocol exec vitest run src/node.test.ts src/browserRules.test.ts
# Final optional-advertisement coverage: 2 files / 19 tests passed.
rtk pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts boundaries.test.ts
# 2 files / 58 tests passed after correcting the test-only core import.
rtk pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts
# Final owning-doc refinement: 3 tests passed.
```

Affected package type checks passed for protocol, custody, Node core, client core, Terminal, Docker,
desktop and TUI. The original eight-package invocation stopped on the new Docker test's facade type;
the corrected Docker/desktop/TUI invocation passed, and client-core was checked again after its last
error-display test. Protocol/custody type checks passed again after the optional advertisement fallback.
Focused oxlint exits 0 over the changed source owners, with existing iterable-spread warnings.
`git diff --check` passed, and implementation-record artifact links resolve. The coordinator owns final
whole-repository `pnpm lint`, bounded `pnpm test`, and coordinated desktop staging.

## Paired evidence

The probe dynamically imports every changed production owner from `ACORN_SOURCE_ROOT`; static imports
do not choose a baseline by changing cwd. The original source archive is
`/tmp/acorn-perf-original-f8e4b59c`, from `f8e4b59caadfe846a9e2c6491ac42b91ec3cf66f`, with verified
workspace links into that archive and shared external dependency storage. Before/after artifacts
contain SHA-256 hashes for entry and descendant owners, including the new helper native encoder.

- [Paired probe](./03-transport-paired-probe.mts).
- [Preserved paired before](./evidence/transport-before-unit03-paired.json).
- [Paired after](./evidence/transport-after-unit03-paired.json).
- [Coordinator correctness replay](./evidence/transport-after-unit03-coordinator.json).
- [Final reviewed owner hashes](./evidence/transport-unit03-final-source.json) (provenance only).
- Original audit evidence: [transport](./05-transport-before.json), [outbox](./05-outbox-before.json),
  and [shared viewers](./16-shared-viewers-before.json).

The paired fixture uses two separate authenticated Node child processes, real isolated node-pty `cat`
sessions, production xterm headless serialization, actual helper/broker/hub, and a disposable Docker
executable. The terminal engine adapter mirrors production attach/resize/display behavior; it does
not boot full plugin registration/database. It reads no private profile and calls no real daemon or
provider. Each captured Node, PTY and Docker PID was checked absent after cleanup. Initial interrupted
or invalid fixture runs produced no accepted evidence; the preserved pair completed successfully.

```sh
rtk proxy env ACORN_SOURCE_ROOT=/tmp/acorn-perf-original-f8e4b59c ACORN_PERF_MODE=before ACORN_PERF_TAG=before-unit03-paired pnpm exec tsx plans/performance/03-transport-paired-probe.mts
rtk proxy env ACORN_SOURCE_ROOT=/Users/jamesmacfie/Source/acorn/apps/node/.acorn/worktrees/jamesmacfie-acorn-performance ACORN_PERF_MODE=after ACORN_PERF_TAG=after-unit03-paired pnpm exec tsx plans/performance/03-transport-paired-probe.mts
```

Existing tags refuse overwrite. Use fresh tags for replay. The coordinator replay includes the final
narrow error-cleanup source refinement and confirms counts/cleanup; its timings overlapped focused
gates, so they are not comparative performance evidence.
The final malformed-advertisement fallback was added afterward and verified by its narrow protocol
and broker suites. It leaves the supported version-1 path used by the recorded pair unchanged; no
additional timing run or modification of measured provenance was made.

| Work or resource | Before | After |
| --- | ---: | ---: |
| B targeted ready after A already restored | 0 | 1 |
| A extra reset on B join | 0 | 0 |
| Terminal sinks after join / A detach / final close | 1 / 0 / 1 | 2 / 1 / 0 |
| B terminal frames after A detach, 16 published | 0 | 16 |
| Docker producer count for two logical viewers | 1, incorrectly shared subscriber lifetime | 1, independent subscribers |
| Final Docker producers / stops after reconnect | 1 / 1 | 2 / 2 |
| Inactive Node invalidations after fleet read | 128 | 0 |
| Resized reconnect fresh snapshots | 1 | 1, latest 144×44, no duplicate online restore |
| 64 KiB base64 median elapsed / process CPU | 3.366 / 2.216 ms | 0.056 / 0.062 ms |
| 2 MiB base64 median elapsed / process CPU | 68.610 / 59.628 ms | 0.634 / 0.577 ms |
| 8 MiB base64 median elapsed / process CPU | 221.198 / 207.621 ms | 1.310 / 1.332 ms |
| Fragmented 8 MiB HTTP median elapsed / process CPU | 8.758 / 21.481 ms | 12.824 / 22.407 ms |
| Body-sized response assembly allocations, source count | 2 | 1 |
| Retained response body bytes, seven replies | 58,720,256 | 58,720,256 |

Base64 still emits 87,384 / 2,796,204 / 11,184,812 characters for these sizes. The encoder measurement
invokes the actual selected helper encoder and verifies exact offset-view bytes. HTTP timing includes
receiving and assembly. It shows no measured latency or CPU gain; the improvement claimed there is
the structural removal of one body-sized clone. Retained body-byte counts are not retained-heap or
RSS measurements. No heap-profiler or visible UI timing was collected. Inactive forwarding CPU was
8.381→3.471 ms in the one fixed-wait burst, not a UI latency measurement.

Opted-in terminal routing adds a 36-byte viewer header upstream; the helper's existing 36-byte Node
header remains. Each admitted viewer intentionally pays its own canonical restore. Dimension changes
add one deduplicated idempotent attach control frame. Docker joining replay is bounded to the existing
512×1024 UTF-16-unit client display tail, with the first producer retaining `--tail 300`; stats joins
replay only the latest valid sample. There is no helper channel-specific parser.

## Remaining boundaries and verification

- Unit 05 still owns synchronous Node-switch batching, provider/model/query/drawn scope, and captured
  origin cleanup ordering. The transport closes A's lease, and the actual Terminal eviction callback
  sequence is tested; the new `wsSendToNode` and generic cleanup option are its narrow seams. Unit 03
  does not repair every view effect that can run before eviction or adopt broader navigation work.
- Unit 19 still owns general Docker spawn failure/error/close recovery, health sharing, client tail
  representation and Node-qualified client keys. This unit unwinds only the new sharing owner's
  synchronous construction/end paths and preserves existing `stream-end` desired subscription retry.
- Unit 06 owns client frame/worker lifetime work. Aggregate query deadlines still do not cancel a
  shared TanStack request with another observer. No credits or downstream backpressure redesign,
  offline mutation replay, broad cache eviction, or paid provider work was added.
- Final native checks require coordinated fresh asset staging and the real isolated Tauri main
  renderer driver. This unit did not stage assets or use normal profiles/CUA. Repeat Terminal and
  A→B→A functional transitions during final cumulative validation, including the unit 05 ordering
  repair. The preserved native notes describe the earlier baseline Terminal transition timeout and
  the test-only verified focus capability; hidden timings cannot establish visible latency.

The specialist leaves no probe processes or native sessions running. The coordinator reviews this
unit and continues the remaining sequential units and cumulative gates.

## Coordinator review

The coordinator reviewed the final owners, compatibility refinement, tests, documentation and
preserved paired evidence, then independently replayed the authenticated after fixture. All
correctness and resource counts passed and the captured descendants exited. That replay's timings
overlapped focused checks and are not compared with the baseline. Unit 03 is reviewed; cumulative,
navigation composition and fresh native acceptance remain open.
