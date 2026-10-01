# 07 — Navigation, pane lifetime, and shell reactivity

## Scope and conclusion

### Coordinator correction during unit 05

The original DOM probe configuration aliases `@tanstack/solid-query` to its package directory.
That resolves its CommonJS entry and introduces a second Solid runtime alongside the browser ESM
runtime. Preserve the original artifacts as historical evidence; use the corrected unit 05
configuration and cumulative baseline for implementation comparisons. The corrected configuration
selects the explicit ESM entry and mounts the ordinary QueryClientProvider and actual TabRail.
`05-rail-host-unit05-cumulative-before-esm.json` records one component construction throughout
mount, selection, same-value preference, unrelated preference, and pin-change phases, with retained
row DOM. At 1,000 tasks, mount parses the order 2,001 times; the two unchanged-order preference
phases each parse it 1,001 times; pin changes parse it 2,001 times. These are synthetic owner counts.

`05-node-lifetime-unit05-cumulative-before-esm.json` and
`05-switch-order-unit05-cumulative-before-esm.json` reproduce the model collision, outgoing observer,
ambient-fetch contamination, final detached observer, and incoming-construction-before-eviction
failures under the corrected provider. `05-notes-retirement-unit05-cumulative-before-esm.json`
also reproduces pending body and delayed title writes targeting the replacement Node.
`unit05-probe-cumulative-before-hashes.json` identifies that harness. These cumulative artifacts
supersede the affected original DOM-owner proof; the pure hierarchy and transport probes remain
separate. No native latency gain follows from these fixtures.

Audit of baseline `f8e4b59c`, completed 2026-10-01. Application source is unchanged. This report covers
desktop task/workspace/Node navigation, compiled pane models and region mounting, task rail projection,
topbar and slot composition, command/keybinding ownership, and scroll/focus lifetime. Loaded frame
handlers and registration churn belong to area 03; cache persistence and originating-Node preference
queues belong to area 06. Terminal sink teardown is included because selecting another Node leaves
work attached to an inactive Node.

Three changes have concrete evidence and an implementation handoff:

| Finding | Priority | Impact | Effort | Risk | Confidence |
| --- | --- | --- | --- | --- | --- |
| F07-1: make compiled pane lifetime and Node transitions scope-safe | P1 | Old models and query observers cross Node boundaries; incoming models can be cleared by late eviction | Medium | Medium | High: actual owners and Solid provider order |
| F07-2: detach terminal sinks through their originating Node | P1 | Inactive output continues through retained broker sockets; returning to the Node can miss screen restoration | Small–medium | Medium | High: actual client channel, broker, hub, display |
| F07-3: parse rail order once per changed preference and share pin membership | P2 | Removes repeated JSON parsing on rail mounts and pin changes | Small | Low | High: actual TabRail counts, source-owner CPU |

The flat/broad rail workload is otherwise inexpensive in the measured owner. A deep task lineage has
quadratic ancestry work, but the evidence does not justify a broad hierarchy rewrite as an immediate
performance task. Retaining all task DOM, adding generic query caches, or virtualizing the rail is
also unsupported by these measurements.

## Ownership and source-to-UI flow

The Node owns each independent task/project/workspace namespace. The custody broker keeps a socket
per paired Node. The desktop selects which Node's data to consume; selection is not broker connection
removal. The client has a QueryClient per Node, while several session stores are module-level signals
that are explicitly cleared on a Node switch. See `docs/architecture-overview.md`, `docs/state-ownership.md`,
`docs/frontend.md`, `docs/panes.md`, and `docs/command-palette-and-shortcuts.md` for the owning contracts.

| Path | Inputs and transformations | Consumer and lifetime |
| --- | --- | --- |
| Node selection | `infra/node/activeNode.ts:25` sets the signal, writes the device's remembered Node, then emits `runtime:node-switched` | `apps/desktop/src/client/index.tsx:150` keys the PersistQueryClientProvider and Router by `activeCacheId()`; the full Node shell is recreated |
| Scope teardown | `apps/desktop/src/client/scopedEviction.ts` translates runtime events into `scopeEviction` callbacks | Each state owner clears its own state. `features/tasks/tasks.ts:236` resets layout/focus/maximize/terminal/workspace session state; active task and source selection have separate navigation ownership |
| Task selection | `features/tasks/activate.ts` starts `nav.change`, clears source selection, selects the task, acknowledges notice state, and seeds a missing layout | `App.tsx:300` finds the active cached task; `:306` holds the last row for safe callback disposal; `:565` keys TaskView by task ID |
| Workspace selection | `features/workspaces/fleetWorkspaces.ts` selects the owning Node before navigating to a project; `workspaceViewTransition.ts` computes restore/remember decisions | `App.tsx:323` holds the last known workspace during cache loading; restore and remember effects preserve membership/path guards |
| Task panes | TaskView reads cached prefs/tasks/workspaces/run targets and registers task commands; TaskPaneHost applies the persisted layout reducer, availability, pinning, and maximize | `TaskPaneHost.tsx:96` uses `For` over stable contribution objects. Removing or maximizing a pane removes its DOM and its drawn mark; it retains its compiled model |
| Compiled model | `panes.ts:173` calls `paneModel(paneId, taskId, build)`; the detached `createRoot` inherits its constructing provider context | `paneModels.ts:30` holds **one task per pane ID**, replacing the prior model when that pane is used for another task. Regions of one task share it; task eviction disposes it. Node-switch disposal is missing |
| Region work | Host layouts and pane regions remain lazy; each region has Suspense and contribution isolation | `panes.ts:175` gives models a memoized `shown` accessor backed by reference-counted drawn marks. Hidden models remain alive, so owners use `shown` to defer expensive reads/effects |
| Task rail | Cached Node rosters + selected workspace + device rail order → ordered tasks → workflow hierarchy → visible task rows/depths/groups | `TabRail.tsx:143` recomputes the pipeline on selection. `For` keeps unchanged task objects' row DOM. Per-row status/markers update reactively |
| Rail annotations | Visible task IDs are passed to `requestTaskAnnotations` | `host/annotations/annotations.ts` already compares semantic request lists and cancels superseded work. Fresh row arrays are not evidence of duplicate requests |
| Chrome contributions | Registry objects → capability/`when` gates → ordered slot contributions → `Dynamic` component | `uiSlots.tsx:20` scans/sorts small registries; its `For` retains contribution identity. Fresh `App.slotContext()` objects propagate props without proving component remounts |
| Keys/palette/tips | Task and model owners register contributions; shell key installer reconciles the registry into a global keymap | TaskView cleanup disposes commands/bindings (`TaskView.tsx:190`). Palette sessions capture execution scope and abort/close on external navigation. Delegated tooltip listeners clean up with the shell |
| Terminal transport | Client `wsAttach` captures a Node, but attach/detach send through ambient active-Node `wsSend` | The server hub tracks a sink per stream per socket; `TerminalDisplay.publish` sends to every live sink. Renderer filtering inactive Nodes does not detach server sinks |

### Cold launch, warm task navigation, and Node navigation

Cold launch initializes plugin contributions, transport subscriptions, the per-Node cache provider,
shell queries, and shell chrome. The local Node readiness gate prevents pane-owned reads before local
routes are available. Remote/offline caches can still be rendered. Heavy pane/editor/ACP imports stay
behind their existing lazy entrypoints; this audit introduces no eager replacement import.

A same-Node task switch retains App and TabRail. It recreates TaskView DOM, its task command/binding
roster, and pane regions for the selected task. Cached queries can answer immediately, while regions
keep their own suspension/ready spans. A compiled pane model is reused only while that pane still
holds the same task. Visiting another task through the same pane replaces it. This is bounded by pane
contributions, not an unlimited cache of visited tasks.

A pane close or maximize recreates region DOM when it returns, while model-owned drafts/resources
survive. Layout tab and split posture are host session state. The rail row DOM survives a selection
change in the measured fixture. Metadata refreshes do not intentionally key TaskView by row-object
identity. These distinct lifetimes are necessary to preserve drafts and focus semantics.

A Node switch recreates App, rail, task view, and Node query observers under the new provider. Existing
module state listeners must finish clearing outgoing scope before incoming region/model construction
can register new scope-owned state. This ordering is currently violated outside a batch, as F07-1 shows.

`features/tasks/pageChange.ts` ends navigation after two animation frames; a suspended pane region has
its own span. The supplied Sentry lead is `nav.change` n=479, median 94.3 ms, p95 328.5 ms, and
`sidebar` n=482, median 106.9 ms, p95 3225.6 ms. Release IDs were absent and tails can include
suspension. These values do not identify this checkout's CPU owner. The running `perf-baseline`
Tauri fixture was hidden/unfocused, so this report makes **no visible paint latency claim** and did
not mutate that live fixture.

## Measurement evidence

All saved results use `before` tags. Probes default to `sample`, so replay does not overwrite them.
Node v24.11.0, macOS arm64. Source-owner CPU is process CPU measured in synthetic fixtures; it is not
WebKit CPU, user-perceived navigation latency, fleet idle CPU, or a full day of use.

### Reproduction

Run from the repository root without competing builds or heavy tasks:

```sh
rtk proxy env ACORN_PERF_TAG=sample pnpm --filter @acorn/desktop exec vitest run --config ../../plans/performance/07-probe.config.ts
rtk proxy env ACORN_PERF_TAG=sample node --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/07-rail-probe.mts
rtk proxy env ACORN_PERF_TAG=sample node --import ./apps/desktop/node_modules/tsx/dist/loader.mjs plans/performance/07-terminal-sink-probe.mts
```

The four source/DOM probes passed together with no errors (~2.7 s). They load actual Solid browser
owners through Vite, with a real QueryClient and jsdom. Router accessors for the rail match the owning
TabRail test's static boundary. The pane query is a synthetic compiled model, not an entire real
plugin. Persist hydration, native preview webviews, Rust helper fanout, PTY execution, xterm drawing,
and visible browser geometry are outside these probes. The terminal socket probe uses ephemeral
loopback and required automatic sandbox escalation for listen; it passed after approval.

An earlier unrelated-preference rail branch produced an invalid harness duplicate command
registration. That branch and its sample artifact were removed; it is neither a product finding nor
a baseline. Only the clean mount/selection rail run below is retained.

### Actual TabRail counts

`07-rail-host-before.json` mounts actual TabRail with synthetic cached rows. Counts are getter/parse
operations, not inferred network activity. Tasks are flat; 100/300-task fixtures have 20 projects.

| Tasks | Mount order parses | Mount project-ID reads | Selection order parses | Selection project-ID reads | Selection parent reads | First row DOM retained |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 6 | 13 | 20 | 1 | 18 | 19 | Yes |
| 100 | 201 | 2120 | 1 | 2100 | 301 | Yes |
| 300 | 601 | 6320 | 1 | 6300 | 901 | Yes |

The initial `2N + 1` parsing comes from the shared order projection plus row menu/marker pin lookups.
Warm selection does not rerun every pin consumer in this fixture. A Node change remounts the rail and
repays the mount work. Selection nevertheless repeats structural hierarchy and project filtering.

### Owner CPU and realistic versus deep lineage

`07-rail-before.json` measures the actual `workflowTaskHierarchy` and `parseRailOrder` owners, with
warmup and repeated rounds. For the small flat/broad workloads, timer noise and process background
work make CPU less informative than counts; median elapsed times are included only as synthetic owner
costs. The pure full rail expression is ~0.135 ms at 300 flat tasks/20 projects.

| Hierarchy | Tasks | Median elapsed per projection | Median process CPU | Parent getter reads |
| --- | ---: | ---: | ---: | ---: |
| Flat | 300 | 0.082 ms | 0.154 ms | 901 |
| Broad siblings | 300 | 0.251 ms | 0.459 ms | 3295 |
| Flat | 1000 | 0.237 ms | 0.236 ms | 3001 |
| Broad siblings | 1000 | 1.374 ms | 1.395 ms | 10995 |
| Deep chain | 300 | 3.819 ms | 3.818 ms | 92993 |
| Deep chain | 1000 | 41.995 ms | 42.154 ms | 1009993 |
| Deep chain | 2000 | 180.397 ms | 180.976 ms | 4019993 |

The pure twice-per-row pin parse expression costs ~7.22 ms CPU at 300 tasks (3531-character order
JSON) versus ~0.044 ms for one parse plus membership checks. At 100 tasks it costs ~0.88 ms versus
~0.009 ms; at 1000 it costs ~95.21 ms versus ~0.476 ms. The comparator is an opportunity estimate:
**after proof must count/time changed production TabRail**, not merely run the hypothetical parse-once
expression again.

### Pane/Node and terminal results

`07-node-lifetime-before.json` proves that switching A→B with colliding task IDs yields B shell DOM
with A's model (`node-b:node-a`). Only one model was built. A retains one query observer and B has
zero. Invalidating the actual outgoing A QueryClient invokes the model's ambient `readJson` against
B and stores `{node: "node-b"}` in A's cache. A later switch to C with another task disposes the A
model while active Node is C. After shell removal, C's detached model still has an observer until
explicit test cleanup. These are lifetime/ownership facts, not a claim that every plugin has a
background polling loop.

`07-switch-order-before.json` compares actual `setActiveNode` and scope mapping with a synthetic
all-model eviction callback. Plain ordering is `build B → event eviction → dispose B`; batching the
signal update and event is `event (active=B, DOM=A) → dispose A → build B`. The listener reads the new
Node in both cases. The current setter comment claiming provider remount happens next tick is
incorrect for this Solid composition.

`07-terminal-switch-before.json` records actual terminal channel frames. After A→B and old subscriber
disposal, A has an attach and **no detach**. B can attach the same session ID and detach normally.
`07-terminal-sink-before.json` feeds the recorded sequence through actual NodeBroker, wsHub, and
TerminalDisplay:

| Checkpoint | Observation |
| --- | --- |
| First attach | One ready, one canonical snapshot; one live sink |
| Inactive A publishes 128 × 4096 bytes | All 128 binary frames and 528896 encoded bytes reach the retained broker; ~4.366 ms combined process CPU |
| Return A with repeated attach | Zero handler attaches, ready messages, or snapshots; old sink still registered |
| Explicit A detach, then attach | One handler attach, one ready, one snapshot |

`emulating=false` throughout the inactive output phase. The finding is retained sink/encoding/socket
work for inactive output and missing return restoration, **not permanent server terminal-parser CPU**.
An idle PTY with no output incurs no per-output cost from this test.

The sink probe currently reads `07-terminal-switch-before.json` and waits for 128 forwarded frames.
It cannot serve as an unchanged after benchmark. Before replay after F07-2, feed frames from the new
production channel result and change the bounded wait/assertions to accept zero inactive forwarding,
or join the channel/broker/hub in one test. Preserve the old input only for explicit before behavior.

## Findings and implementation handoffs

### F07-1 — Scope held pane models by Node and make the transition atomic

**Evidence.** `paneModels.ts:24–48` keys only by pane ID and compares bare task ID. Its detached root
inherits the constructing context; the task-only eviction listener at `:91` ignores Node switches.
`activeNode.ts:28–37` publishes the new signal before emitting teardown. `index.tsx:150–177` keys a
provider directly on that signal. The saved collision and order probes establish both reuse of A in B
and synchronous incoming construction before the event. This violates
`docs/state-ownership.md:275`, which promises Node-scoped remounting prevents old effects/query
clients retaining prior assumptions.

**Impact.** Retained observers/listeners/resources can continue work against the wrong scope, and
IDs legitimately collide across independent Nodes. Hidden `shown=false` limits several expensive
effects but does not sever captured QueryClient/resource ownership. Evicting every model on the
existing event alone is unsafe: newly constructed B models can be disposed after becoming visible.
Other scope listeners can similarly clear registrations created during B's construction.

**Fix sketch.** Keep the one-task-per-pane bound. Record the constructing Node/cache scope in each
held entry and include it in reuse checks and drawn identity where relevant. Enclose the authoritative
Node signal update, remembered-device write, and switch event in one Solid batch so teardown listeners
read the new Node before incoming provider construction runs. Dispose outgoing models by owner, or
dispose all held entries only under the proven batched transition; explicit owner matching makes
the contract robust to later mounting changes. Do not introduce a permanent model cache for every
Node/task pair.

Cleanup can write or schedule writes: e.g. `plugins/notes/src/client/notesModel.ts` flushes a pending
save and its current NotesApi calls ambient routes. A teardown after the signal changes must therefore
retain the originating Node/API ownership, rather than rely on the ambient active Node during cleanup.
Area 06 owns original-QueryClient preference queues; reuse its ownership contract for preferences.
The pane owner must characterize and bind model resource mutations separately. Do not delay the
public switch event until after rendering or make existing listeners read the old active Node.

**Executor checklist and exit evidence.**

1. Add a regression in the pane-model owner for A/B equal task IDs, A/B different IDs, same-Node
   region close/reopen, task eviction, and final host disposal. Assert model construction/disposal
   counts and QueryClient identity, not just text.
2. Add an activeNode/scoped-eviction integration test with the keyed provider. Assert event listeners
   observe B while incoming B model construction occurs after outgoing teardown. Assert B's model,
   terminal attachment, focus state, and scoped registrations survive the switch.
3. Include a pending model save during A→B. The save must target A; B's cache/model must remain clean.
   Check async resource callbacks/generation guards cannot apply A data to B.
4. Replay `07-navigation-probe.test.tsx` with an `after` tag. Expected A observers are zero after
   teardown; B builds its own model; invalidating inactive A cannot cause a model-owned ambient B read.
   The synthetic `_resetPaneModels` comparator needs updating to the chosen production eviction path.
5. Run focused pane/scope/task/workspace tests and final lint; use a visible Tauri window for task,
   pane maximize, Node return, focus, and unsaved-draft behavior. Update `docs/panes.md` and
   `docs/state-ownership.md` with exact scope/disposal ownership.

**Invariants and proposal compatibility.** Preserve shared models across independently mounted
regions, model-owned drafts, lazy imports, task archive disposal, and `shown` gating. Preserve
same-Node command execution and area 06 pending-save origin ownership. The future client-plugin
chrome provider must consume the same atomic navigation contract. Node-qualified reading/view state
must remain independent of this single-current-task model cache.

### F07-2 — Detach outgoing terminal sinks using the captured Node

**Evidence.** `plugins/terminal/src/client/wsChannel.ts:20` clears all local attachments on a switch;
the disposer at `:43–48` either finds no slot or refuses to send if the captured Node is inactive.
`infra/node/wsClient.ts:81–85` can send only to active Node through its current public send door.
The custody broker's `nodeBroker.ts:99,180,273` keeps connection ownership independent of renderer
selection. `wsHub.ts:374` treats an already attached stream as idempotent, while `terminalDisplay.ts:160`
continues sending live output. Source probes demonstrate the combined effect.

**Impact.** A long-running build on another Node continues encoding and transporting output to this
client even after its xterm is released. Returning to A creates a fresh client emulator, but the
server socket still knows the old attachment; its duplicate guard omits ready/canonical snapshot.
This is also a display correctness problem. Socket disconnect eventually detaches; a selection
change on a retained connection does not.

**Fix sketch.** Add/use a narrowly typed transport send that can address a captured Node, exposed
through the existing client/plugin seam. Detach each outgoing attached session on its captured Node
before removing the local attachment roster; the callback must remain safe if the current Node has
already changed. Ensure subscriber disposal is idempotent and cannot detach B's colliding ID. Retain
same-Node hidden-task xterms and their server attachment lifetime. Preserve ordinary duplicate attach
idempotency in wsHub; do not force every repeated attach to rebuild the screen to mask missing detach.
Do not close all broker sockets on selection changes: fleet queries and independent Node custody
are intentional. Coordinate transport outbox behavior with area 05's obsolete attach/detach handling.

**Executor checklist and exit evidence.**

1. Extend channel tests for A attach → B switch → originating A detach, then B equal-ID attach.
   Dispose the old A subscriber twice and confirm B remains attached. Test reconnect and channel
   disposal as separate teardown paths.
2. Join actual production channel output with broker/hub/display, or adapt the existing sink probe
   as described above. After switch: A sinks=0 and 128 inactive output frames produce zero terminal
   bytes for this socket. Returning A creates exactly one ready/snapshot; repeated same-Node attach
   still creates neither duplicate sink nor duplicate snapshot.
3. Exercise pending snapshot detach and disconnected outgoing Node/outbox semantics. Avoid adding
   a resubscribe loop or reconnect-only workaround.
4. Run focused terminal channel/display and custody/hub tests, then a visible Tauri A→B→A check with
   continuous terminal output. Preserve xterm reuse within A and max-four WebGL context behavior.
   Update `docs/terminal.md` with Node-switch teardown ownership.

**Risk.** Changing the send seam affects compiled and loaded client boundaries; the implementation
must remain capability/transport-owned rather than importing custody internals into a plugin. Node
removal and disconnected/outbox behavior need focused coverage, not an assumption that every detach
is delivered immediately.

### F07-3 — Memoize the rail order and pin membership in the rail owner

**Evidence.** `TabRail.tsx:69` is a plain getter calling `parseRailOrder`; per-task context menu and
marker consumers at `:186` and `:398` parse again. Mounting actual 300-row rail parses 601 times.
The imported owner CPU probe shows meaningful avoidable work at 300 rows. `isPinned` itself scans
the pinned array; the device preference already supplies a stable string dependency.

**Fix sketch.** Create a memo keyed by `prefs.data?.[PrefKeys.railOrder]`, parse once, and derive a
shared pinned-ID Set from that memo. Use the Set in row menu targets and core marker construction,
and the parsed object in drag/pin/order actions. Keep the parsed persisted representation unchanged;
Sets are session projections, not serialized preferences. Do not wrap rail marker contributions in
a cache that hides their signal reads. Memo dependency should be the rail-order value, so unrelated
preference changes do not trigger parsing.

**Executor checklist and exit evidence.**

1. Extend owning TabRail tests for pin/unpin, drag/drop with unrelated workspace IDs, malformed/missing
   stored order, and active selection. Verify row DOM remains stable.
2. Replay the actual TabRail fixture under `ACORN_PERF_TAG=after`; mount parses should be constant
   per rail-order value instead of `2N+1`. A same-value unrelated preference update must not parse.
   Make any added harness branch match Solid `createComponent`/untracking semantics rather than
   directly invoking a component in a tracking memo.
3. Profile changed production rail owner at 6/100/300 flat tasks and realistic pin counts, plus one
   1000-row stress fixture. Compare owner CPU and parse/lookup counts; preserve `before` files.
   The pure comparator alone cannot prove this implementation ran.
4. Keep `requestTaskAnnotations` semantic-list guards and rail marker sorted-registry identity;
   no annotation-network reduction is expected from this fix. Run focused rail/order tests and lint.

**Scope.** A project map or separately memoized workspace/order projection could remove selection
rescans measured above, but the current full flat projection is ~0.135 ms at 300 tasks. Include it only
if the same change needs that dependency boundary or a representative profile establishes a cost.
This recommendation does not require virtualization or a new shared cache.

## Covered paths with no immediate fix

| Surface | Observation and decision |
| --- | --- |
| Task hierarchy | `taskHierarchy.ts:20–32` re-walks ancestry for every task; deep-chain counts grow quadratically. Both child maps copy sibling arrays (`:45`, `:72`). Flat/broad day-sized workloads are inexpensive here. If real workflow lineage approaches hundreds of levels, separate structural tree construction from selection/disclosure projection and use cycle-safe linear visitation; preserve orphans, cycles, root/child order, workflow origins, active ancestry reveal, and the TUI consumer. Do not rewrite now solely for the 2000-deep stress result |
| Task layout | Reducer dispatch preserves same-object no-op guards. Maximize intentionally unmounts other regions. Split drag already coalesces in rAF. Pane registry sort/find scans are over a small roster, not the task count |
| Task commands | TaskView registers/disposes command and keybinding rosters per keyed task; dynamic titles and availability are inputs to the shell keymap. This is lifecycle work, but no measured bottleneck warrants retaining every task's command/DOM owner. The command-session graph observes registry changes even when closed; its providers/rows are gated by session state. No background command-query claim |
| Keys/focus | Global key installer and delegated tooltip manager clean up on shell removal. Element-bound key layers cancel pending MutationObservers when disposed. `paneFocus` listeners belong to collectible pane DOM. Focus-region state is session-owned and evicted; late model/Node cleanup must not clear incoming registrations (F07-1) |
| Rail status/markers | `taskStatus.ts` already preserves unchanged status summaries. `railMarkerFeed.ts` already caches sorted registry order. Contribution marker getters remain reactive and failure-isolated. Fresh array wrappers do not by themselves recreate Solid rows |
| Topbar/slots | Fleet workspace fanout is deliberate; project/workspace picker scans are modest. `SlotHost` ordered lists preserve contribution object identity, despite new context objects. Replacement `rail.taskList` gates fallback DOM, while some outer rail queries/projections exist outside the fallback; no measured expensive hidden replacement workload establishes a new finding |
| Hidden model work | Changes defers hidden refresh via `shown`/owed refresh; agent acknowledgment/read paths are visibility-gated; context/notes retain shared region state. There is no evidence here for a universal hidden-model polling problem. Unbound Node lifetime is F07-1; loaded handler leaks are area 03 |
| Terminal resources | Retained xterms and bounded WebGL contexts are already shipped. TerminalDisplay disposes its snapshot emulator once no attach is pending. Missing server detach does not revert that optimization |
| Workspace memory | Restore/remember uses explicit workspace-membership and route guards. Unchanged-view write suppression and preference serialization/queue ownership are area 06. No second persistence mechanism is proposed |
| Reader state | Anchored reading position, stable transcript row identity, one-shot reveal, and gesture-gated follow are shipped. View state is Node/session/surface-owned, not the pane's one-task cache. No hidden transcript DOM retention is proposed |

## Prior work and future compatibility

Relevant history inspected includes `a7d82d71` (2026-09-25, held-pane shown state) and `671ba52b`
(2026-09-26, retained terminal tabs), together with the current lazy pane layout implementation,
status-summary guard, marker feed, annotation roster guard, and bounded terminal display behavior.
The audit explicitly preserves those changes. Area 01 owns startup import/build work and area 04
owns terminal engine/parser behavior; neither is reopened by a navigation finding.

`docs/future/client-plugins/04-replaceable-surfaces.md` is a proposal with **rail.taskList already
shipped**. General replaceable rail/topbar/pane-switcher surfaces remain proposed. Fix projections in
their feature/host owners and keep data/verbs/contribution seams so a future provider can reuse them;
do not attach pin caches or navigation authority to core-specific DOM. The overlay stack and command
palette remain host-owned rather than replacement slots in that proposal.

`docs/future/scoll_fix.md` explicitly marks reading position, stable row identity, reveal and
gesture-gated following shipped. Filter/card-disclosure/reveal-token work is still proposed.
Navigation fixes must preserve independent surface reading positions and drafts, Node-qualified
identity, and bounded eviction; they must not expand the pane-model cache into a reader-state store.

## Validation limits and follow-up gates

Baseline lint and bounded full tests were already run by the coordinator. This read-only audit ran
focused owner probes, not another full build/test sweep. The coordinator replay also passed all four
DOM/source probes under `ACORN_PERF_TAG=coordinator-before`; its separate result files are preserved.
These probes establish ownership and operation counts; final
fixes still need their meaningful fail-before owner tests, focused suites, lint, and visible Tauri
checks. Native preview/editor child webviews and loaded frame lifetime are covered by other areas.

There is no measured before/after visible navigation latency, retained whole-process heap, or full-day
rail profile here. The terminal transfer probe uses synthetic screen/output and combines broker/hub
CPU in one process; it excludes helper IPC filtering and real xterm draw costs. It establishes a
specific unwanted sink and return-path invariant, without extrapolating to fleet CPU percentages.

Keep the baseline JSON and scripts with this report. Replay with changed production owners and a
new tag. Stop optional benchmark expansion once these exit conditions establish the intended fix.
