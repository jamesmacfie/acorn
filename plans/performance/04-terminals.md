# Terminal performance audit

Three changes are worth implementing: bound the raw ring's allocation count and head-removal cost, serialize run-target lifecycle operations, and publish every session roster mutation. The shipped attach, binary output, retained xterm, and WebGL work already removes the large costs of returning to a terminal. Preserve those behaviors.

This report covers baseline `f8e4b59c`. Measurements ran on September 30 and October 1, 2026, on Darwin arm64 with Node `v24.11.0`. Application source remained read-only. Area04 did not change the shared `perf-baseline` Tauri session. The window was reported hidden during reconnaissance, so this report makes no visible-latency claim.

## Ownership and data flow

The Node owns processes and sessions. The renderer owns the emulator that a reader has opened. Their lifetimes differ deliberately.

| Stage | Owner and inspected code | Contract and lifetime |
| --- | --- | --- |
| Request a shell or raw provider | `client/TerminalPanel.tsx:203`, `client/terminalClient.ts:39`, `server/routes/terminal.ts:85` | The client sends task/profile identity. The route validates the body and task scope. Core resolves the task and worktree before Terminal spawns anything. |
| Create the process | `server/terminal.ts:376`, `server/terminal.ts:390` | `spawnOne` resolves the profile, assembles the task environment, selects node-pty or tmux, and wires a Node-owned session. Metadata for tmux survives in the plugin's SQLite file. Raw output is runtime state. |
| Own process execution | `server/terminal.ts:192`, `server/terminal.ts:453`, `server/runChannel.ts:36` | PTYs are the documented direct-process exception. node-pty owns the interactive child, or a tmux attachment child. The detached tmux server/session is a separate durable owner. Short stop and URL scripts use `CoreServices.proc.runProcess`, with bounded output and process-group deadlines. |
| Capture and batch output | `server/terminal.ts:177`, `server/terminalUtils.ts:23` | Every PTY callback writes the raw byte ring immediately. `pendingOut` coalesces wire output for 16 ms. Batching therefore does not reduce the number of ring chunks. |
| Restore a screen | `server/terminalDisplay.ts:166`, `server/terminal.ts:772` | Attach resizes the PTY/display first, flushes output, builds a headless emulator from the 256 KiB ring, and installs a snapshot barrier. A sink receives ready, reset plus snapshot, queued output, then live output. The emulator disappears when no snapshot is pending, even if clients remain attached. |
| Transport output | `packages/node-core/src/server/transport/wsHub.ts:218`, `packages/custody/src/broker/nodeBroker.ts:363`, `apps/desktop/src/helper/helperServer.ts:120` | The hub encodes session-tagged binary output once per broadcast. Custody forwards the bytes. The helper wraps them with the Node identity and sends them to the renderer. JSON remains the carrier for ready, exit, and error. Binary output consumes no invalidation sequence number. Generic transport is area05's owner. |
| Apply socket backpressure | `packages/node-core/src/server/transport/wsHub.ts:117`, `server/terminal.ts:794` | The hub counts congested viewers and pauses the PTY while any viewer holds a pause. It resumes below half the socket mark, and releases holds when a socket closes. This observes the Node socket, not completion of renderer parsing. |
| Route and parse output | `packages/client-core/src/infra/node/wsClient.ts:97`, `client/wsChannel.ts:11`, `client/liveXterm.ts:150` | Client-core filters the selected Node and dispatches envelopes. Terminal validates JSON, decodes binary output, and fans it to per-session subscribers. xterm parses asynchronously. Its write callback decrements a pending-character counter. |
| Draw and retain terminals | `client/TerminalPanel.tsx:47`, `client/TerminalSurface.tsx:25`, `client/heldTerminals.ts:18`, `client/liveXterm.ts:192` | Surfaces are keyed by session ID. An unopened tab builds no xterm. An opened tab's xterm and attachment outlive drawer unmounts. Parked elements leave the document and release focus. Four recently shown terminals retain WebGL renderers in a page; other terminals retain their parsers and buffers. |
| Own the roster and prune | `client/sessionStore.ts:16`, `client/heldTerminals.ts:35` | A successful roster read replaces full rows and disposes unmounted terminals no longer listed. Failed reads preserve held terminals. Generation and Node checks discard late responses. Node switches clear rows, attachments, remembered selections, and all held terminals. |
| Own a declared run target | `server/runtime.ts:66`, `server/runChannel.ts:27`, `server/terminal.ts:547` | One service per Node maps task/target to a terminal session, with a reverse session index for authoritative exits. HTTP, palette, agent tools, and workflow steps reach this service through capabilities and routes. |

Paths without a package prefix in this report are under `plugins/terminal/src/`.

Inspected source also includes client activation, appearance/theme, terminal settings/preferences, agent sending, completion snapshots, plugin activation/disposal, the terminal and run routes, and the relevant focused tests. Core process, Node drain, plugin host, custody, helper, and socket code were read far enough to identify custody and teardown boundaries. Docker exec and `$EDITOR` use separate throwaway `attachPty` channels; they do not own this ring or retained drawer map. The TUI's own painter and headless rectangles belong to area15.

## Prior work that must be preserved

Relevant history was read against this branch:

- `449807fb`, September 3: chunked ring, binary output, lazy Node emulation, stable session ID keys, and inactive tab retention. Its historical three-viewer probe reduced 1,017 encodes to 339. The stated 15% wire reduction is historical evidence, not a measurement repeated here.
- `28781ae6`, September 3: output backpressure pauses the producer, and terminal roster events no longer trigger unrelated chrome and Git sweeps. The old reconnect-on-sequence-gap behavior was removed.
- `ae1788dc`, September 25: terminal size travels on initial attach. The ready-size comparison supports a Node that ignores those fields.
- `dad25c8d`, September 25: the profile list uses a five-minute query cache, avoiding synchronous executable probes on each drawer return.
- `671ba52b`, September 26: xterms outlive drawers and task returns, four recently shown terminals retain WebGL, and headless emulation lasts only until attach snapshots settle. The commit measured zero additional attaches, contexts, or xterm elements on nine returning visits. It also explicitly identified hidden-window counts as counts, not visible timings.

Run-target query caching is also present in `packages/client-core/src/infra/queries.ts:42`, with `run:changed` invalidation and the shell's 30-second stale time. Recommending any of these changes again would duplicate shipped work.

## Measurements and replay

The probes load the actual source owners. The Node probe uses real `OutputRing`, `TerminalDisplay`, `HeadlessTerminalScreen`, and `RuntimeService`; process behavior is injected only where the service declares that seam. The PTY probe uses real node-pty children with synthetic text. The engine probe uses the actual terminal engine with a fake process/API boundary, recording its calls and listeners.

Durable artifacts are:

- `plans/performance/04-node-probe.mjs` and `04-node-results-before.json`.
- `plans/performance/04-node-results-256-before.json`, the separate 256-byte ring sample.
- `plans/performance/04-pty-chunks.mjs` and `04-pty-results-before.json`.
- `plans/performance/04-engine-probe.test.ts`, `04-probe.config.ts`, and `04-engine-results-before.json`.
- `plans/performance/04-verification-before.txt`, the commands and test outcomes.

Replay from the repository root with distinct output tags:

```bash
rtk proxy node --expose-gc --import tsx plans/performance/04-node-probe.mjs --ring-only --chunks=4096,256,64,8,1 --tag=after-ring
rtk proxy node --import tsx plans/performance/04-node-probe.mjs --tag=after-lifecycle
rtk proxy node --import tsx plans/performance/04-pty-chunks.mjs --tag=after-pty
rtk proxy env ACORN_TERMINAL_PROBE_TAG=after pnpm exec vitest run --config plans/performance/04-probe.config.ts
```

The ring replay reports public byte count, exact tail validity, CPU time, heap, and ArrayBuffer retention. Private chunk count is optional, so a changed representation can still run the probe. The parser safety-limit experiment runs only with `--parser-burst`; its baseline result is saved, and it need not be repeated to verify the recommended fixes. The initial before run preceded the optional ArrayBuffer field, so before heap figures exclude external Buffer backing storage.

### Ring costs

Each sample fills the ring to 262,144 bytes, runs an overflow batch, and validates its entire public tail. Heap delta follows explicit garbage collection. These are single-run synthetic measurements, not a day-long profile.

| Input chunk | Retained chunks | Heap delta | Fill elapsed | Overflow input | Overflow elapsed | Overflow CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4,096 B | 64 | 18,976 B | 0.368 ms | 8 chunks, 32 KiB | 0.063 ms | 0.109 ms |
| 256 B | 1,024 | 151,408 B | 0.724 ms | 128 chunks, 32 KiB | 0.115 ms | 0.116 ms |
| 64 B | 4,096 | 496,736 B | 1.382 ms | 512 chunks, 32 KiB | 0.158 ms | 0.260 ms |
| 8 B | 32,768 | 3,210,832 B | 4.703 ms | 4,096 chunks, 32 KiB | 106.931 ms | 108.858 ms |
| 1 B | 262,144 | 26,449,088 B | 26.485 ms | 8,192 chunks, 8 KiB | 1,707.420 ms | 1,707.391 ms |

Tiny callbacks are reachable through the process owner. Four synthetic PTYs each wrote 250 chunks at 2 ms intervals. The 8-, 64-, and 256-byte programs each produced 250 callbacks of exactly that size. The 4,096-byte program produced 1,000 callbacks of 1,024 bytes. Every child exited with code zero. This characterizes the installed macOS node-pty path; it does not claim provider CLI chunk distributions. The raw ring receives those callbacks before the engine's 16 ms wire batch.

For scale, an 8-byte update at 50 Hz fills the 256 KiB ring in about 11 minutes. That is an arithmetic scenario, not an observed provider workload. Ordinary kilobyte build chunks stay cheap in the measured implementation.

### Lifecycle and queue results

| Probe | Result | Interpretation |
| --- | --- | --- |
| Eight overlapping starts of the same task/target | Eight session IDs returned; Stop kills only `s8`; seven sessions survive without a declared instance | A deterministic service race, independent of UI timing. |
| 1,000 distinct tasks with naturally exited targets | Zero live instances; 1,000 retained last-exit entries; one exit listener; dispose clears both | Exit history grows by distinct task/target. Its payload is small; this is not the main retention cost. |
| Direct terminal create | Zero roster notifications | Only the creating client receives its returned session unless another edge prompts a roster read. |
| Remove, followed by eventual PTY exit | Zero roster notifications | The removed session fails the exit callback's map-identity guard, so it does not invalidate other clients. |
| Engine disposal | One data listener and one exit listener remain on the fake PTY; zero kills; zero timers at that point | Disposal clears registry state but does not stop the PTY attachment or unsubscribe its callbacks. |
| Old PTY output after disposal or a second boot | Schedules a 16 ms flush; second boot roster still contains only its own session | The exit callback has an identity guard; the data callback does not. Work can continue in a forgotten session object. |
| Rebuild a full ANSI ring at 120 by 40 | 262,144 replay bytes, 16,633 snapshot bytes, 22.44 ms elapsed, 52.13 ms process CPU | One cold rebuild sample, including allocation and parser work. This supports keeping the attach-only design. CPU can include GC and other Node work. |
| Hold a snapshot unresolved and publish 1,000 4 KiB frames | 4,096,000 pending characters; only ready delivered before resolution; 1,002 frames delivered afterward; emulator disposed | The attach queue has no byte bound, but ordering and release work. The deferred emulator is synthetic. |
| Real xterm headless parser, synchronous 64 KiB burst writes | Accepts 50,003,968 characters, then throws `write data discarded, use flow control to avoid losing data` | Characterizes the actual xterm 5.5 parser safety limit. It is not live incidence or a proposed normal workload. |

Focused verification passed: six source test files, 66 tests, in 3.60 seconds. These cover ring byte/Unicode behavior, screen restoration, target exits, channel disposal and reconnect, stale roster responses, retained surfaces, and the four-context policy. The separate engine observation probe also passed. The coordinator supplied passing baseline `pnpm lint` and bounded `pnpm test`; source was not changed, so this audit did not rerun the whole workspace.

## Recommended candidates

| Priority | Finding | Impact | Effort | Risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | PERF04-01: Bound raw ring blocks and remove heads in constant time | Small PTY updates can retain megabytes of Buffer objects and make the Node spend 109 ms per 32 KiB overflow batch | M | Low | High mechanism; medium product frequency |
| 2 | PERF04-02: Serialize run-target lifecycle operations | Overlapping starts create extra processes that target Stop cannot reach | M | Medium | High |
| 3 | PERF04-03: Publish structural roster mutations | Other clients retain removed terminals and stale session summaries without a refresh trigger | S to M | Low | High |

### [PERF04-01] Bound raw ring blocks and remove heads in constant time

- **Evidence:** `server/terminalUtils.ts:24` retains one Buffer for every callback, and `server/terminalUtils.ts:41` shifts the whole array when dropping a full head. `server/terminal.ts:177` pushes each callback before output batching. `server/terminalUtils.ts:46` retains the backing allocation of a partially trimmed Buffer through `subarray`.
- **Impact:** The 256 KiB logical limit is not an allocation-count limit. An 8-byte saturated ring retains 32,768 Buffer objects and roughly 3.21 MB of heap, before backing-store memory. Its measured overflow batch spends 108.858 ms of Node CPU on 32 KiB of data. This is synchronous work on the Node that also serves queries and agent traffic. A one-byte workload is a stronger stress case, not the primary justification.
- **Effort:** M, about one day including byte-boundary tests and before/after probes.
- **Risk:** Low if the public byte-tail contract remains unchanged. A cursor or head calculation error would truncate, duplicate, or reorder output used for restoration and prompt detection.
- **Confidence:** High for the algorithm and measured cost. Medium for how often real provider programs saturate the ring with tiny updates; the PTY probe proves reachability but does not sample provider workloads.
- **Fix sketch:** Keep output in lazily allocated byte blocks with a bounded block count and head/tail cursors. A segmented ring of approximately 4 KiB blocks can copy only incoming bytes and drop head bytes in constant time. Avoid allocating the entire 256 KiB when a quiet shell produces its first prompt.

A head index over the present array removes repeated shifts but leaves tens of thousands of retained Buffer objects. Use that only as an intermediate implementation if measurements show the allocation problem is also handled. Coalescing small data into fixed blocks addresses both costs. It also prevents an oversized API input from retaining a much larger backing Buffer through a small tail slice. Large single callbacks beyond the ring cap were not observed in the PTY probe, so that backing-store case is an API robustness benefit rather than a separately ranked live finding.

Keep `push(string)`, `bytes`, and `tail(bytes)` unchanged. Encode an input string once. Decode joined requested tail bytes once, including the behavior when the cap cuts the head of a UTF-8 character. Do not rebuild or copy the full ring on every push. Keep the zero-byte and empty-input behavior.

Verification must compare public tails against concatenated UTF-8 bytes with a 256 KiB suffix, including mixed Unicode, tails cutting chunk/block boundaries, a large single push, and repeated wraparound. Reuse `terminalUtils.test.ts` as the characterization suite. Run the ring replay with the same 8/64/256/4,096-byte inputs before and after; compare heap and CPU on the same host. Retained storage must be bounded by block capacity, and small-chunk overflow cost must no longer grow with the number of retained callbacks. Kilobyte output must remain cheap. The count and algorithm assertions are the gate; single submillisecond samples are too noisy for a strict percentage threshold.

### [PERF04-02] Serialize run-target lifecycle operations

- **Evidence:** `server/runtime.ts:116` reads an instance before any await. Configuration, trust, hooks, and spawning are awaited at lines 118, 122, 127, and 134. `server/runtime.ts:137` then overwrites the same instance key without a second ownership check or shared pending operation. `server/runtime.ts:146` stops only the instance that won that overwrite. The HTTP start route, agent tool at `server/agentTools.ts:52`, and workflow step at `server/workflowSteps.ts:160` independently call this service.
- **Impact:** Eight concurrent calls produce eight processes and seven survivors after target Stop in the replay. Those sessions remain in the terminal engine and consume process resources and rings. They are visible in the raw roster, but the run-target reverse index and Stop action cannot reach them. Even two callers create the failure. A UI busy flag cannot serialize another client, agent, or workflow.
- **Effort:** M, about one day for a service-owned operation guard and lifecycle characterization.
- **Risk:** Medium. Trust and hook ordering, Stop during Start, explicit restart scripts, natural exits, and disposal must continue to agree on the authoritative session.
- **Confidence:** High. The overlap is deterministic with the service's declared injected dependencies; the coordinator also corroborated it by source review.
- **Fix sketch:** Own an operation state per task/target inside `RuntimeService`. Coalesce overlapping Start calls into the same in-flight promise, and order Stop/Restart against pending work for that key. Keep unrelated tasks and targets concurrent. Release a failed or settled pending entry in a `finally` path guarded by operation identity.

Install the operation guard before the first asynchronous configuration read. Sharing must cover config resolution, the repo trust gate, hook verdict, and spawn, so the hook runs once for one actual process. Each HTTP or capability caller still passes its normal authorization boundary. Preserve per-Node ownership and the task/target key; do not create a global cross-Node lock.

Define Stop during an in-flight Start to wait for that operation and then stop its result, rather than reporting no instance and allowing a process to appear afterward. Avoid nested lock acquisition when Restart uses Stop then Start. Characterize immediate natural exit during spawn and reject stale completion after disposal. Clear pending entries after a hook veto, configuration failure, spawn failure, and success, so retries work and promises do not become another retained cache. Disposal behavior must preserve the engine's deliberate durable-tmux policy.

Verification: the eight-start probe must return one session ID and invoke `startSession` once; Stop must leave no running fixture session. Add owner-level deferred tests beside `runtime.test.ts` for two different keys progressing concurrently, failed Start then retry, Stop during Start, Restart during Start, natural exit before operation completion, and dispose while a dependency is unresolved. Keep the trust gate and veto before spawn, and preserve one natural-exit change event and no duplicate explicit-stop event.

### [PERF04-03] Publish structural roster mutations

- **Evidence:** `server/terminal.ts:659` routes direct creation to `create`, which reaches `spawnOne` without a creation notification. `server/terminal.ts:678` removes and deletes a session without `statusBroadcast`. `server/terminal.ts:314` makes the later exit callback return after deletion. `server/routes/terminal.ts:85` and `server/routes/terminal.ts:96` add no notification. `client/sessionStore.ts:72` refreshes on terminal roster events, and `client/heldTerminals.ts:35` requires a successful authoritative roster to release missing terminals.
- **Impact:** The creating drawer immediately adds its returned row and the closing drawer explicitly refreshes, so a single-client click can look correct. Another client receives neither structural edge. After a removal, that client can indefinitely retain a parked xterm, attachment slot, appearance listener, and its scrollback, along with stale session summaries, until another terminal event, drawer visit, or reconnect causes a read. The real engine probe records zero notifications for direct creation and for removal followed by PTY exit.
- **Effort:** S to M, several hours including a two-reader lifecycle test.
- **Risk:** Low. Extra full-roster reads are the main risk if notifications are added at both the owner and its wrappers.
- **Confidence:** High. The event gap and consumer dependency are directly read and measured. No private multi-client app data was used.
- **Fix sketch:** Publish `terminal:sessions-changed` at the session engine's successful structural mutations, including creation, removal, and batched task-session drop. Centralize creation publication and remove duplicate wrapper publications from setup, run-target, and teardown paths. Keep the late-exit identity guard.

Emit no change for an unknown remove. Publish a removal only after the in-memory roster has changed, and ensure a persistence failure cannot hide an already changed authoritative roster. Task archive should send one event for a batch of dropped sessions. Reconciliation may send one event after its batch. Keep working/idle events scoped to Terminal and worktree events on their human-rate edges.

Verification: the engine probe's direct create and remove must produce structural notifications without relying on exit. Build a two-reader test where reader B has parked a terminal, reader A removes it, B receives the invalidation, successfully refreshes, and disposes the held terminal and subscriber. Also retain the existing failed-read behavior: a network error is not proof that a session vanished. Run the surface tests to verify a renamed or otherwise identical roster does not build another xterm. Check setup/run-target creation does not double-publish at owner and wrapper.

## Lower-priority issues and boundaries

### [PERF04-04] Complete PTY attachment teardown on in-process engine shutdown

- **Evidence:** `server/terminal.ts:303` and `server/terminal.ts:312` ignore the disposable handles returned by node-pty. The exit callback checks engine membership; the data callback does not. `server/terminal.ts:595` clears displays, queued agent sends, and the session map, but does not clear each flush timer, remove either listener, or close attachment PTYs. `packages/node-core/src/server/core/proc.ts:118` is a separate short-lived process broker, not a registry that reaps these PTYs.
- **Impact:** A stopped engine in a still-running Node can keep parsing-free but allocation-producing ring work from old attachment output. The injected probe confirms a late data callback schedules a flush after disposal and after a second boot. It does not prove a normal task-switch leak. The compiled Terminal plugin is required, and `packages/node-core/src/server/pluginHost/host.ts:570` rejects built-in hot reload. Active reachability is Node drain, failed boot cleanup, or an in-process stop/start, not ordinary plugin disable/reload.
- **Effort:** M for a carefully defined attachment lifecycle; smaller if limited to listeners and timers.
- **Risk:** Medium. Killing a durable tmux server session during shutdown would violate the product contract.
- **Confidence:** High for callback/timer ownership; medium for material cost during the shipped shutdown path, because normal process exit releases Node memory and closes descriptors.
- **Fix sketch:** Store callback disposables on the session, cancel pending flush timers, and guard `onData` with session/engine identity. Close the Node-owned tmux attachment child when stopping the engine while preserving its detached tmux server/session. Treat ephemeral child shutdown separately, according to the Node lifecycle contract.

`apps/node/src/composition/runtime.ts:132` drains the listener, reconciliation, scheduler, plugin state, plugins, SQLite, then the data-root lock. It does not call a later generic PTY reaper. `packages/node-core/src/server/pluginHost/host.ts:766` explicitly supports stop/start in one process. That is why the missing attachment cleanup is a robustness candidate, but it ranks below normal-use findings. A removed PTY that has been killed can deliver late output before its socket closes; ignored callback disposables alone do not establish a permanent leak after ordinary removal. Do not describe them that way.

### Parser and attach queues need end-to-end measurement before a transport change

`client/liveXterm.ts:139` measures pending output but sends no completion or credit to the producer. The counter uses JavaScript string length, so it measures UTF-16 code units rather than UTF-8 wire bytes. xterm's installed `src/common/input/WriteBuffer.ts:104` throws after its approximately 50-million-character safety watermark. `TerminalDisplay.publish` at `server/terminalDisplay.ts:160` also retains every live frame while a snapshot waits; those frames have not reached the socket whose backlog drives pause/resume.

The probes prove both queue mechanisms and the xterm failure boundary. They do not prove that a provider/build in the live app exceeds renderer drain capacity. The Node socket can drain into the helper before a hidden renderer parses output, so a clear socket backlog cannot establish that the parser is caught up. The helper forwarding and transport custody part belongs to area05. Coordinate any future credit or acknowledgment protocol with that area rather than treating the socket's 4 MiB threshold as a renderer guarantee.

If follow-up is selected, measure aggregate and per-session parser pending characters, actual output bytes, write completion, socket backlog, and CPU during one synthetic producer at a declared rate, then during several opened parked terminals. Use operation counts and retention while the window is hidden. A fix needs independent holds for socket congestion, attach restoration, and parser backlog, released on detach/disconnect and reconciled across multiple viewers. An additive capability/version negotiation is necessary for older clients and Nodes. Do not silently drop output, reset sequence numbers, use a stale replay tail as full screen history, or pause all sessions for one slow tab. No protocol change is recommended from the 50 MiB synthetic burst alone.

## Retention, fitting, and races checked

Held xterms are intentionally unbounded by count and bounded by session lifetime. The four-context limit controls GPU renderers, not terminal buffers, attachments, or appearance observers. An exited session remains in the Node roster until it is removed or its task is dropped. Killing a session is therefore not itself a held-terminal eviction. Repeated run-target restarts can leave historical session rows and output for the task; deleting that history as a performance shortcut would change product behavior.

The focused tests verify seven visited task terminals remain held while four retain WebGL, no extra attach on a drawer return, output still written to parked terminals, and successful roster pruning of closed sessions. The audit did not measure long-run WebKit heap per terminal or claim a day-long plateau. `lastExitCodes` retained 1,000 entries after 1,000 completed task/target keys in the source probe; the map clears on service dispose. A task-eviction cleanup could be considered when that lifecycle changes, but small scalar entries do not justify a separate cache project.

The hidden renderer still pays for output parsing. Installed xterm `src/browser/services/RenderService.ts:110` uses IntersectionObserver to pause rendering outside the viewport; hiding does not pause the parser. This supports the documented retained behavior but does not make offscreen terminals free. Disposing them automatically would lose emulator scrollback and reintroduce cold restores. Fix structural roster invalidation before attributing removed-session retention to the retain-and-reuse policy.

Fitting and appearance ownership are explicit. `liveXterm.ts:188` has one ResizeObserver per built xterm. It follows the mounted host, disconnects when parked, and reconnects on a move. `show` fits and focuses; font-size updates fit without calling `show`, so they do not intentionally steal the caret. Parked elements have no parent, and the installed FitAddon returns without dimensions. Hidden mounted tabs can still receive appearance changes, but FitAddon only resizes on a changed valid proposal. Applying a theme waits for Shiki and checks disposal before writing options. Appearance listeners and WebGL addons are released when the held terminal is disposed.

No resize batching change is justified by this audit. A drag can issue many fit/resize operations, but no visible drag or transport-arrival probe was run. Preserve immediate fit on reveal, optional size-on-attach, dimensions clamped to 1-2,000 by the Node, and ready-size fallback. Reconnect currently emits attach without size from `client/wsChannel.ts:25`; ready mismatch supplies the corrective HTTP resize. Avoid caching initial geometry as reconnect truth if layout or appearance can change while parked.

Attach ordering has direct tests for erased cursor history, alternate screen, Unicode, two pending viewers sharing a screen, snapshot barriers, detach during restore, and emulator release after the final snapshot. The deferred-frame probe confirms every post-barrier frame arrives after the reset/snapshot. Do not replace that barrier with a replay of arbitrary raw output or use batching to reorder exit before buffered output.

The client Node-switch path clears attachment slots and all held terminals. Node filtering happens before plugin dispatch. Attachment disposal compares slot identity so a stale detach cannot erase a replacement slot. Roster generation checks protect late reads and late created rows from a previous Node. Surface unmount checks the host identity before removing an element, which protects a terminal moved into a replacement surface before the old surface cleans up. RequestAnimationFrame reveal callbacks check component cleanup and hidden state. These are existing safeguards, not new candidates.

The one page-wide `syncScrollArea` error guard is installed once and intentionally persists with the renderer. Terminal custom input handlers and xterm listeners are owned by xterm; term disposal removes them. Focus/keybinding registrations and presentation listeners owned by `TerminalPanel` have cleanup. The Node idle watcher is one interval per engine, unrefed and cleared on dispose; agent sends and review snapshots have their own cleanup and bounds. No stacked idle timer or per-output appearance listener was found.

## Invariants and future compatibility

Any implementation must retain these contracts:

- Nodes own their independent sessions, data, and execution environments. Clients do not kill a process merely by detaching or unmounting a drawer.
- Core resolves task identity, checkout/worktree confinement, and configuration trust. A run target passes trust and the veto hook before one actual spawn. Preserve contribution and capability seams.
- A tmux server session survives ordinary Node shutdown. Its attachment child is a different resource. Ephemeral PTYs and short process-broker scripts have different lifetimes.
- The raw ring retains the exact last 256 KiB of UTF-8 bytes. Tail decoding happens after joining bytes. Output stays runtime data, and an attach cannot recover history older than that ring.
- Snapshot barriers, reset, pending live frames, and exit ordering remain intact. Binary output preserves the session identity and uses no invalidation sequence number.
- A retained xterm parses its attached output, maintains scrollback, and returns without a new attach. Hidden or removed DOM does not imply the session has died.
- Failed roster reads keep held terminals. Successful missing-session reads release them. Node-switch and stale-response checks remain authoritative.
- The four-context policy remains per renderer page, and context loss falls back to DOM. Do not widen it to fix parser or ring memory.

`docs/future/remote.md` keeps Node independence and the client platform adapter, with web/mobile clients that can lose background sockets. Ring and target-operation fixes are internal Node changes and need no desktop privilege. Roster events already have a host-neutral carrier and help every client. Any parser credit proposal must work through the transport seam for a browser client as well as the desktop helper, and must treat reconnect/disconnect as release paths.

`docs/future/compiled-tier.md` identifies Terminal as a permanent first-party stream owner. These changes belong in Terminal's helpers and services, with the generic transport portion left in core/custody. Do not expose its private session map, import core implementation into a loaded plugin, or put xterm in shared protocol code. Future task isolation must continue to receive the validated task/worktree and environment through the process seam; batching and keyed operation guards do not change that authority. `docs/future/rail-tab.md` consumes host-neutral accepted session/task facts, so structural events must keep the existing small invalidation vocabulary rather than inventing terminal-specific chrome payloads.

## Considered and rejected

| Idea | Verdict |
| --- | --- |
| Add a byte ring, binary output, or 16 ms batching | Already implemented. The remaining ring issue is object count and head removal before that batch. |
| Keep a headless screen for every attached client | Rejected. Retained tabs stay attached, so this would restore duplicate continuous parsing on the Node. |
| Dispose inactive xterms or cap them at four | Rejected. Four bounds GPU contexts, and automatic xterm eviction would lose scrollback and restore the measured attach/rebuild cost. |
| Cache terminal profiles or run-target lists | Already implemented. Do not remove their stale-time refresh, because PATH/configuration can change. |
| Drop terminal frames under congestion | Rejected. Cursor operations are not safely discardable, and sequence-gap reconnects previously amplified load. |
| Replace the ring with a single concatenated string | Rejected. That brings back ring-wide copies on each PTY callback. |
| Use only a head index for the present tiny-Buffer list | Insufficient as a final design. It removes shifts but leaves the measured retained-object overhead. |
| Share run Start only in the UI | Rejected. Other clients, agent tools, and workflow steps reach the same service. |
| Kill durable tmux sessions when disposing the engine | Rejected. Dispose the Node-owned attachment and callbacks without ending the durable process. |
| Add another exit-code cache or aggressive task history eviction | Not justified by scalar retention alone. Preserve historical terminal review and use the task lifecycle if future evidence warrants cleanup. |
| Cache a framebuffer across returns | The retained xterm already avoids that path. A reconnect must reflect live output, dimensions, and alternate-screen state. |
| Broaden a test or protocol redesign from a synthetic 50 MiB burst | Rejected as an implementation recommendation. The saved result is a limit characterization and a measurement lead for area05. |

## Implementation order and remaining gaps

Implement PERF04-01 first because it has an isolated pure-data contract and measured CPU/retention benefit. PERF04-02 and PERF04-03 can follow independently; both need lifecycle tests at their service owner. Each implementation must run `pnpm lint`, the focused Terminal suites above, and the relevant bounded `pnpm test` gate. For any client-surface change, use the real Tauri workflow documented in `docs/local-development.md`, with a visible window before making latency claims. Preserve and compare the saved before results with distinctly tagged after results.

The audit did not measure provider CLI chunk histograms, full-day memory, visible WebKit rendering, live aggregate parser overload, sleep/resume GPU behavior, or multi-device wall-clock latency. It did not modify the live Tauri fixture or inspect a normal development profile. Those gaps limit frequency and end-to-end sizing claims; they do not weaken the deterministic ring, overlapping-start, or missing-roster-edge findings. No application fix was made during this area audit.
