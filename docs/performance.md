# Performance: the decisions, the refusals, and the numbers

The record of the performance programme that ran from 2026-08-31 to 2026-09-03: eleven phases across
the desktop renderer, the terminal client, and the node. Behaviour lives in the owning docs, listed
below. This file holds the three things that have no other owner — what was decided about the shape of
the system, what was refused and on what exit condition, and every number the programme measured.

Read it the way you read [loaded-plugin-migration.md](./loaded-plugin-migration.md): a dated record
rather than a description of how the app works today. Where it disagrees with an owning doc, the owning
doc wins.

The programme's working papers — three reads of the app, an order of work, and eleven phase files —
lived in `docs/future/performance/` while it ran and were deleted when it closed. `git log` has them.

## Where each behaviour lives now

| What shipped | The doc that owns it |
| --- | --- |
| The icon split, and why an unmatched icon name still renders as itself | [ui-design.md](./ui-design.md) § Icons |
| The renderer's startup budget and its denylist | [frontend.md](./frontend.md) § Startup budget |
| The window opening before the node, and what the shell draws meanwhile | [frontend.md](./frontend.md) § Painting before the node, [shell.md](./shell.md) § The shell process |
| Boot marks, the request line, and the git and SQLite histograms | [local-development.md](./local-development.md) § Timing a cold start |
| The node's boot order, and the login-shell probe leaving it | [node-distribution.md](./node-distribution.md) § Boot order |
| Concurrent plugin `init`, and what a plugin may assume about its neighbours | [plugins.md](./plugins.md) § Activation |
| Bundled-plugin trust and the idempotent cache writes | [security.md](./security.md) § Third-party plugin bundles |
| Loaders in the kit's node table, and the tree contract's batch rules | [plugins.md](./plugins.md) § The tree contract |
| One grammar per file opened, and the editor's round trip to text | [editor.md](./editor.md) |
| The terminal client's host switch, attach-or-start, focus regions, key groups, viewports and footer | [tui.md](./tui.md) |
| One query client per node, and the file-backed cache the terminal client persists to | [caching.md](./caching.md) § Renderer query cache |
| Events that name what changed, and the WebSocket's shed marker | [api-reference.md](./api-reference.md) § WebSocket, [plugins.md](./plugins.md) § Hearing a core event |
| Coalesced worktree status reads, and the guard that still reads fresh | [workspaces-and-tasks.md](./workspaces-and-tasks.md) § Worktree status reads |
| Device-token caching and the transport's auth | [security.md](./security.md) § Transport and auth |
| The emulator that runs only while watched, the ring, and the binary `term:out` frame | [terminal.md](./terminal.md) § The screen, and who pays for it, [shell.md](./shell.md) § The renderer bridge |
| The transcript store, the usage fold, and the markdown that redraws its open block | [managed-agents.md](./managed-agents.md) § The transcript store, [ui-design.md](./ui-design.md) § How the kit is built |
| Pane models, hover prefetch, and the deletion of `keepAlive` | [panes.md](./panes.md) |
| Per-path diff hydration | [diff-rendering.md](./diff-rendering.md) § Parsing and highlighting |

## What was decided

Decided 2026-09-02, after a second read of the app that covered the terminal client and re-traced the
desktop paths the first two reads argued from. Three reads fed this: the desktop's surfaces measured
from the built renderer, the desktop's shapes traced along four paths end to end, and the terminal
client. All three are in git history. This section is the answer to the question they raised and did
not settle: which foundations stay, and which change. Each phase named the decision it served, and
§ What was refused holds the alternatives so nobody re-argues them from silence.

Nothing in the programme had shipped when this was written. The renderer budget check was red on
2026-08-31 at 1,317,605 bytes and red on 2026-09-02 at 1,324,279 bytes, so the tree drifted the wrong
way while the first reads sat unactioned. That drift is the argument for phase 0's denylist: a budget
that only counts bytes lets a heavy chunk in as long as something else shrank.

### What was measured this time

Read at `17a9acdf`. The first reads had one number; this one has seven, and none of them is a profile.

| Measurement | Value |
| --- | --- |
| Desktop startup scripts, budget 1,250,000 B | 1,324,279 B across 143 assets. `Icon` 371 KB, `shiki` 162 KB, `DiffPane` 46 KB, `prModel` 29 KB, `RemoteTree` 29 KB, all in the modulepreload list |
| Largest desktop chunk | `viewState-*.js`, 954,915 B: CodeMirror plus 19 grammars imported statically in `packages/client-core/src/features/editor/language.ts`. Lazy, but all or nothing |
| Terminal client's eager graph from its `App` chunk | 110 chunks, 1.06 MB of 2.05 MB built. `prModel` is in it |
| Node service bundle | one chunk, 1,093,602 B, 344 modules, all evaluated before `startServiceRuntime` runs |
| SQLite files opened and migrated per node boot | 10: `core.sqlite` plus nine plugin files |
| This machine's agents database | 160 MB, 66,264 events, 114 sessions. The largest sessions hold 2,700 events and 1.3 to 3.3 MB of event JSON. `usage` rows are 25% of all events, about 58 per turn |
| Streamed events reaching a client | about 25 a second per session. The node coalesces text deltas at 40 ms or 16 KB in `plugins/agents/src/server/sessions/durableEventBuffer.ts` |

### The seven decisions

#### 1. The process topology stays

The desktop stays three processes: the renderer, the helper that holds custody, and the node. The
terminal client stays one process with an optional node child. The reasons are trust facts rather
than performance ones, and each is checkable in source: the device bearer and the certificate pin
live in the helper and never in the renderer (`packages/client-core/src/infra/node/apiClient.ts`
says so in its header); WKWebView cannot pin a self-signed certificate, so a direct `fetch` to the
node would fail TLS (`packages/custody/src/broker/nodeRequest.ts` explains why even Node's `fetch`
cannot); and the renderer's Content-Security-Policy names exactly one loopback WebSocket, minted per
response in `apps/desktop/src-tauri/src/app_scheme.rs`.

What the topology costs is per-hop serialisation, and that cost is fixable in place. A request is
stringified once in the renderer, parsed and Zod-validated once in the helper, and its body is
base64-encoded on the way out and decoded on the way back. `apps/desktop/src/shell/wire.ts` names
the upgrade, an id-tagged binary frame beside the JSON reply, and phase 6 takes it for terminal
output, the one path measured in frames per second. Moving a boundary would buy nothing those frames
do not.

Refused: collapsing processes, moving custody into Rust, a renderer-held token.

#### 2. Every host draws first, then connects, then fills

Today both clients gate their first frame on a complete node. The desktop's Rust shell blocks on the
helper's ready line, which the helper prints only after the node has booted; the renderer then awaits
two node round trips before `render()`. The terminal client awaits its node's handshake when it
started that node, then imports a 1.06 MB module graph, then awaits a tasks request, then creates its
renderer. The node itself binds its listener only after every plugin's `init` and `ready` have run
in series.

The decision is to invert that order on every host. The window and the terminal open on the persisted
query cache. The helper or broker connects behind the first frame. The node binds as early as its own
boot allows, and plugins fill in through the status pushes the clients already handle
(`node-status`, `plugins:changed`, `tasks:changed`). Three phases carry it: phase 2 for the desktop
shell, phase 3 for the node's internals, phase 4 for the terminal client. The pieces exist already,
which is what makes this a decision about order rather than a build: `apps/desktop/src/client/activate.ts`
argues in its own comment that registering plugins and correcting later beats waiting, and then
`apps/desktop/src/client/index.tsx` awaits the node anyway.

#### 3. Registries hold loaders, not values

The first read found that `packages/client-core/src/kit/tokens/iconNodes.ts` imports 706 KB of icon
geometry because `Icon` resolves a name at render time and the bundler cannot see which names are
reachable. The second read found the same shape three more times:

- `packages/client-core/src/host/tree/components.ts` is an eager record from kit node name to
  component. It imports `DiffPane`, which imports `packages/client-core/src/infra/highlight/worker.ts`,
  which imports shiki. That is the import the first read did not trace, and it lands in the
  `RemoteTree` chunk, which is preloaded whether or not a loaded plugin exists.
- `packages/client-core/src/host/frames/remoteSolid.ts` holds a second copy of the same table for
  the iframe path.
- `apps/tui/src/kit/components.tsx` is the terminal client's copy, and it is why that host's eager
  graph is half its whole build.

A string-keyed table from a name to code is a registry, and a registry that holds values pulls every
value into whichever chunk holds the table. The rule from here on: such a table maps a name to a
loader, `lazy(() => import(...))` or a plain `() => import(...)`, and the heavy entries load on first
use. The CodeMirror language table in `packages/client-core/src/features/editor/language.ts` falls
under the same rule: one grammar per file opened, not nineteen per editor pane.

The rule needs a test, because the drift between the two builds shows that a byte budget alone does
not hold it. Phase 0 adds a denylist of chunk-name prefixes to both hosts' startup checks; phase 1
applies the rule to the four tables above.

#### 4. The node owns freshness and coalescing

Three things on the node are recomputed per request that could be computed per change:

- A status ping spawns `git status` and two `git diff` processes per active worktree
  (`plugins/changes/src/server/localDiff.ts`), and `packages/node-core/src/server/worktrees/worktrees.ts`
  spawns a second and third `git status` for the same worktree from a different caller. Every
  connected client asks, and nothing between them coalesces. `packages/node-core/src/server/core/git.ts`
  is a 64-line wrapper with no cache, and there is no filesystem watcher anywhere in the repo.
- Every authenticated request runs a synchronous SQLite `SELECT` and a sha256 in
  `packages/node-core/src/server/auth/deviceTokens.ts`, with no cache in front of it.
- The plugin-chrome sweep refetches every plugin's descriptors on a content-free ping, because
  `packages/client-core/src/host/chrome/chromeData.ts` is called with no plugin id.

The decision is that the node caches and deduplicates these with short time-to-live windows,
invalidated by its own writes, in the shape `packages/node-core/src/server/sync/engine.ts` already
uses for provider mirrors. The node is the one place that knows when its own state changed. A client
that decides how often the node spawns git is deciding something it cannot know.

One constraint is not negotiable: a cache serves reads, never a refusal. `worktrees.ts` guards
worktree removal on `worktreeDirty(path)`, and a stale "clean" would let a destructive removal past
it. Phase 5 writes the guard against a fresh read and tests it.

Refused for now: a filesystem watcher. The exit condition is written under § What was refused.

#### 5. Streaming surfaces render incrementally

The agent transcript pays per event on three layers, and the node has already done the coalescing
that would make one of them cheap. `durableEventBuffer.ts` flushes text deltas every 40 ms, so a
client sees about 25 events a second per streaming session. Each of those events copies and sorts the
whole event array in `plugins/agents/src/client/sessions/managedStore.ts`, rebuilds the whole
conversation projection in `plugins/agents/src/client/sessions/AgentTranscript.tsx`, and then
`packages/client-core/src/kit/components/content/Markdown.tsx` re-parses the whole message with a
regex pipeline, replaces its `innerHTML`, and re-runs the syntax highlighter over every code fence
in it. A message with three fences re-highlights three blocks 25 times a second while it streams.

The decision is that a streaming message re-renders only its open block. Closed blocks and closed
fences are immutable, so they render once and are cached by content. Bookkeeping events that the
client folds per turn, `usage` above all, are folded once on the node instead of 58 times on every
client. Phase 7 carries it, and the first read's per-event items (a `Set` for seen ids, a tail append,
a memoized turn map) fold into the same phase because they are the same surface.

#### 6. One query client per node, on every host

The desktop has one `QueryClient` and one persister per node, built by
`packages/client-core/src/infra/node/fleet.ts`, and every invalidation watcher writes into it. The
terminal client mints its own `QueryClient` in `apps/tui/src/App.tsx` with the comment "No
persister", renders the whole shell under it, and never calls `persistQueryClient`. So the client
that `watchTaskChanges` invalidates is not the client the shell reads, and every `acorn` start is
cold even though `apps/tui/src/node/cache.ts` installs a file-backed storage for a cache nobody
writes.

The decision is that the terminal client renders under `clientFor(nodeId).client` and persists it
through the storage it already installed. One client per node is the contract
[caching.md](./caching.md) § Renderer query cache states; the terminal client is the host
that did not keep it. Phase 4 carries it.

#### 7. The terminal client's key path is indexed, not scanned

`apps/tui/src/keys/regions.ts` keeps its regions, parents, and containers as plain arrays and scans
them linearly inside a recursive walk of the focused region's subtree, twice per key. The footer
recomputes its hints per render and asks the keymap engine for the active keys twice each time, and
`@opentui/keymap` 0.5.9 turns its own active-keys cache off process-wide the moment any layer
carries a runtime matcher, which this host installs on every stop and every command. The rail hands
Solid's `<For>` a fresh array on every task change, so every row renderable is recreated.

The decision is that per-keystroke work is bounded by the depth of the tree, not the number of nodes
in it: maps and weak maps for the indexes, one subtree walk per move, hints computed per focus change,
and the typing gate expressed as a layer that comes and goes rather than a matcher that runs per key.
Long lists in cells window their rows the way the rail already does. Phase 9 carries it, and it is
held to the five rules in [tui.md](./tui.md) § Keys and focus: no new settle step, no second
keymap.

### Corrections to the first reads

The dated reads stay as written, with one pointer line each to this section.

- **Rust never sees a request body.** The first read counts two JSON hops through Rust and asks
  whether Rust re-parses the payload. It does not. `apps/desktop/src/shell/bridge.ts` opens a
  loopback `ws://` straight to the helper after one `invoke('helper_endpoint')` to learn the port and
  secret, and `apps/desktop/src-tauri/src/lib.rs` registers no node-fetch command. The path is
  renderer to helper over that socket, helper to node over pinned HTTPS. Two JSON hops, two base64
  round trips, and one Zod parse of the whole decoded request in the helper.
- **`bumpChrome` already takes a plugin id.** The second read says it has none.
  `packages/client-core/src/host/chrome/chromeData.ts` declares `bumpChrome(pluginId?: string)` with
  a per-plugin revision map behind it. The one caller passing nothing is the `wsOnStatus` line above
  it, so the phase 5 fix is one argument at one call site.
- **The `term:status` consumer list is six.** The second read names five. The sixth is
  `plugins/github/src/client/pullDetail/prTabs.ts`, which invalidates two pull-request keys per ping.
- **The node has a boot timer.** The first read says four `console.log` marks.
  `apps/node/src/composition/runtime.ts` has `bootTimer()`, which prints `[service:boot] <label>
  +<ms>ms` for migrate, install, listener-up, and each reconcile step, unconditionally. Phase 0
  extends its labels rather than adding a second timer.
- **Reconciliation is already off the critical path.** The second read implies the window waits
  on it. `runtime.ts` returns `started` after `listening`, and the tmux, worktree, workflow, and
  agent reconcile steps run behind that.
- **Reconnect refetches active queries only.** The second read says the client invalidates the
  node's entire cache on reconnect. `apps/desktop/src/client/index.tsx` passes
  `refetchType: 'active'`, which bounds the refetch to mounted queries. The framebuffer replay per
  live session still happens.

### What the phases found wrong with these seven

Every phase re-took the measurement it was gated on, and four of the seven above moved. The service
bundle is 1,110,974 B rather than 1,093,602 B and evaluates in about 350 ms rather than being described
by its size at all. The terminal client's eager graph is 857,233 B rather than 1.06 MB. The desktop's
startup payload is 631,512 B rather than 1,324,279 B. The ten SQLite opens cost 30 ms together, which
is a non-issue. The three that held are the agents database, the event rate, and the shape of the
per-plugin init pass. All of them are in § The numbers with the phase that took them.

## What was refused

What the programme decided not to do, and why, so a later session argues with the reasoning rather
than with silence. Started 2026-08-31 and added to as each phase shipped. Every entry carries an exit
condition, and an entry with a bold dated paragraph under it was revisited on a number.

### Row patching instead of coarse `<noun>:changed` invalidation

The content-free event with a whole-route refetch is a deliberate design: a payload is a second
projection to keep in step, and `watchConnectionChanges` documents a concrete case where a patch
would leave the rest of the projection stale (the list route synthesizes rows the event cannot
carry). The observed pain is not the coarseness, it is the `term:status` amplifier, which phase 2
fixes without touching the model. Revisit only if instrumented refetch volume stays high after that.

### A general topic or subscription model on `/v2/events`

`docs/future/events.md` records the broadcast ceiling knowingly. A per-connection interest registry
is real machinery with its own failure modes, and the two concrete costs found in the trace, the
`term:status` fan-out and the helper forwarding non-active nodes, are both fixable at their source
in phase 2. The model stays refused until a measurement on a real multi-node fleet demands it.

**Both source fixes shipped and the exit condition is untouched, 2026-09-03.** Phase 5 split
`term:status` and filtered non-active nodes at the helper, and phase 10 confirmed at the request seam
that a second client adds no work to a status ping (§ 2026-09-03 — phase 10). What
nobody has is the measurement this entry asks for: every number in the programme was taken against one
node, so the broadcast volume of a real two- or three-node fleet is unknown. The exit condition stands
exactly as written, and it needs a second machine rather than a second reading.

### Splitting the node into worker threads or multiple processes

The single loop carries synchronous SQLite, terminal emulation, and git spawns, and no measurement
says any of them is the problem. Phase 3 removes the largest unconditional load (emulating unwatched
sessions) and phase 0 adds the histograms that would justify a split. Process architecture is a
one-way door; do not walk through it on a structural argument.

### Dropping unreferenced icons at build time

68 of 1,756 names appear as literals in the tree, but a user can assign any icon to a task and a
plugin manifest can name any one, and both choices are persisted. A build-time census breaks stored
data. The split in phase 0 (eager 68, lazy rest) gets the bytes without the breakage.

### Rebuilding the transcript virtualizer

Removed on purpose: `measure()` churn made output flash and become unselectable, and
`docs/managed-agents.md` owns that record. The rebuild-everything projection is what made it
thrash, so phase 4's fixes come first, and any revisit starts by reading the removal commit.

### Single-theme diff tokens

Every token carries `light` and `dark` so a theme switch costs nothing. That is roughly double the
token memory a large diff needs, and it stays that way until a real diff's memory is the complaint,
because the switch being free is a property people notice.

### Replacing base64 on the helper wire ahead of a measurement

`wire.ts` names its own ceiling and its own upgrade (an id-tagged binary frame beside the JSON
reply), and nothing but terminal output is likely to reach it. Phase 3 moves `term:out` to binary
frames because that path is measured in frames per second; request and response bodies stay JSON
until a body shows up in the phase 0 numbers.

**Half taken, 2026-09-03.** The binary frame shipped as phase 6, not phase 3, and it carries terminal
output on both hops and nothing else. Bodies are still base64 in the JSON messages, and this entry is
still the reason: no body has shown up in a measurement. The frame format is in
`packages/protocol/src/ws.ts` § The one binary frame, so a later body upgrade has something to reuse
rather than something to invent.

**Still parked, and the trigger is real now, 2026-09-03.** Phase 10 went to read the body sizes out of
phase 0's request log and found that the line never carried one, so the exit condition this entry has
had since 2026-08-31 could not have been met by the instrument it named. The line prints the response's
`content-length` now, `-1` for a stream that declares none (`packages/node-core/src/server/respond.ts`).
The largest body anyone has measured anywhere in the programme is the agent snapshot's first page at
2,158,126 B (§ 2026-09-03 — phase 7), an order of magnitude under the ceiling
`wire.ts` names. Exit condition, unchanged in substance and now checkable: a `[perf:request]` line over
about ten megabytes.

### Scrollback beyond the ring after phase 3

Gating the headless emulator on attached sinks means a cold attach rebuilds the screen from the
256 KB raw ring, so history older than the ring is gone and an alternate-screen app whose state
depends on older bytes redraws from its next output. That is the accepted price for not running a
parser per session forever. If a session class appears where full history matters, the answer is a
bigger ring for that class, not a return to always-on emulation.

**Taken, 2026-09-03.** The gating shipped as phase 6, not phase 3, and the price is paid as written.
What the numbers say about the trade: a megabyte of a build's output through an unwatched session is
2.8 ms instead of 492 ms, and the rebuild a cold attach pays instead is 20 ms, once per tab
(§ 2026-09-03 — phase 6). The behaviour is now stated for a reader in
[terminal.md](./terminal.md) § The screen, and who pays for it, and nobody has yet watched what
losing older bytes looks like for a real agent TUI after a long build.

### Added 2026-09-02

#### Collapsing the process topology, or holding the token in the renderer

The desktop's three processes cost one serialisation per hop, and the second read counted the hops
exactly: renderer to helper over a loopback WebSocket, helper to node over pinned HTTPS. Moving a
boundary would remove one JSON hop and would put the device bearer or the certificate pin somewhere
the trust model says it cannot go (`docs/security.md` § Trust boundaries). WKWebView cannot pin a
self-signed certificate, so a renderer-to-node path would need a CA the shell installs, which is a
larger change to the machine than to the app. Binary frames on the existing hops (phase 6) buy the
measurable part.

#### A filesystem watcher for worktree status

There is none, and phase 5 does not add one. A watcher per worktree is a handle per directory on
Linux without recursive `fs.watch`, a stream of events that need debouncing into the same coalesced
read phase 5 builds anyway, and a second source of truth about "dirty" beside git's. The two-second
cache with in-flight dedup gets the amplification down from processes per client per ping to one per
worktree per window, and the node's own writes invalidate it. Exit condition: a measured case where a
change made outside acorn (an editor, a shell) has to appear in under two seconds without a ping, and
the ping cannot be made to happen.

#### `Rows` virtual by default, on either host

On the desktop, virtual rows need a fixed row height (`--row-h-virt`), and most lists have rows of
varying height; 25 of 27 call sites would render wrong. In cells, `virtual` swaps the box's flex so
the list grows into its panel, and a short list would stretch to fill space its rows do not need
(`apps/tui/src/kit/showing.tsx`). Both hosts opt in at the long-list sites instead (phase 9 names
them for the terminal client). The default stays a decision per list.

#### A second query client in the terminal client

`apps/tui/src/App.tsx` mints its own `QueryClient` beside the per-node one client-core builds, so the
shell reads a client nobody invalidates and nothing persists. That is a bug against the caching
contract, not a design. Phase 4 removes the second client; nothing may add another on any host.

#### A terminal-specific keymap

Phase 9 replaces runtime matchers with a layer that comes and goes, because that is what
`@opentui/keymap` caches around. It does not add a second engine or a second binding table. The
rule is `docs/tui.md` § What must never happen.

#### Dropping the tree host's whole-batch pre-flight

`packages/client-core/src/host/tree/treeState.ts` simulates a whole batch before applying any of it,
so a stranger's bundle cannot leave a half-applied tree. The simulation is quadratic in places. The
security decision stays; phase 10 makes the algorithm linear when a loaded plugin's tree is measured
slow.

**The pre-flight stays and the algorithm is linear, 2026-09-03.** Phase 10 measured the tree it was
waiting for: a batch of 4,000 `remove` ops against a 4,500-node tree blocked the main thread for
1,103.9 ms, because the pass scanned every live node and walked its ancestors once per `remove`. It
carries a child index beside the parent map now and walks the subtree down, which is 71.4 ms for the
same batch and 2.9 ms for a hundred removes that used to cost 62 ms
(§ 2026-09-03 — phase 10). The old walk also had a correctness bug the rewrite ends: a
grandchild whose parent the same loop had already deleted survived in the projection, so a later op
addressing it was accepted. Nothing about the whole-batch decision changed.

#### A 503-until-ready node contract

Phase 3's gated half binds the listener before plugin init and answers plugin routes with
`plugin_starting` until their plugin is ready. It is a wire contract every client and the MCP child
would honour forever. It shipped only if the phase 0 breakdown showed plugin init dominating the boot
after concurrency, taken as over 300 ms.

**Refused on the numbers, 2026-09-02.** Phase 0 measured it: every plugin's `init` together is 46 ms on
a first boot against a realistic data root and 24 ms warm, and no plugin declares a `ready` at all, so
that pass is free (§ The node's boot breakdown). Binding the listener before plugin init
would buy at most 46 ms of a 412 ms boot and cost a permanent wire contract.

What the same measurement found instead is that **82% of the node's cold boot is `graph`** — 338 ms in
`loadExternalPlugins`, scanning the data root's install directory, verifying each manifest, importing
each bundle and running its migrations chain — and it runs in front of plugin init, so no amount of
concurrency in the init pass touches it. Phase 3's target is the loader. Exit condition for revisiting
this entry: a node whose plugin passes measure over 300 ms after the loader has been dealt with.

**The refusal stands; that last paragraph does not.** Phase 2 took the re-measurement phase 0's own
caveat asked for, against the staged `service.js` rather than under `tsx`, and `graph` is 47 ms — most
of the 338 ms was transpiling TypeScript the loader pulled in. Two costs the breakdown does not see
are larger: 449 ms spawning the node and evaluating its one-chunk bundle before the boot timer starts,
and 220 ms of `migrate` on a first-ever boot. Phase 3 should pick its target from
§ 2026-09-03 — phase 2 rather than from the `tsx` figure. The plugin passes are still
46 ms cold, so the wire contract is still refused for the reason above.

**Phase 3 shipped without it, 2026-09-03.** The plugin passes measure 24 ms warm and 38 to 41 ms on a
first boot against a realistic root, before and after making them concurrent, out of a 132 ms boot to
`listener-up`. Binding the listener in front of them cannot buy more than that, and it would cost a
`plugin_starting` code every client and the Model Context Protocol child honours forever.

One claim in phase 3's own scope turned out to be false and is worth recording, because it was part of
the case for the gated half being cheap: **the client does not retry on `retryable`.**
`packages/protocol/src/errors.ts` does carry the field, and `apiClient.ts` reads it onto `ApiError`,
but nothing in `packages/client-core/src/infra/node/` retries on it — there is no retry loop and no
TanStack Query `retry` predicate reading it. So the gated half would have needed client code after all,
which makes it more expensive than the phase file assumed, not less.

### Added 2026-09-03

#### Splitting the node service bundle into per-plugin chunks

Phase 3's scope and phase 10's deferred list both said to split the one 1,099,400 B service chunk into
per-plugin dynamic imports if its evaluation time came in over 100 ms. It is 293 ms, and the split is
refused anyway, because the measurement says the bytes are not where the time is: 51 ms of the 293 ms
is the bundle's own modules and 242 ms is external libraries the chunk does not contain
(§ 2026-09-03 — phase 3). Every plugin in `nodePlugins()` has its `init` called on
every boot, so per-plugin chunks would evaluate all 51 ms of it anyway, in 16 pieces instead of one.

`drizzle-orm` is 161 ms of the 242 ms and cannot be narrowed: the root barrel is 92 ms, `sqlite-core`
alone is 155 ms, and both together are 161 ms, so moving 99 files off the root barrel would save about
6 ms. Exit condition: a real change to what the node needs before it binds, such as the node no longer
building its schema at boot. Two smaller candidates are recorded with their sizes under § The numbers
rather than refused: `@agentclientprotocol/sdk` at 25 ms and `jose` at 10 ms, both statically imported
for work that happens long after the listener is up.

#### A journal check in front of drizzle's `migrate`

Phase 3's scope said to write this down if the ten SQLite opens turned out to cost more than
milliseconds each. They do not. `core.sqlite` opens and migrates in 7 ms and the nine plugin files cost
23 ms together, warm, including the 159 MB `agents.sqlite`. `migrate` against an up-to-date journal is
one `SELECT` against `__drizzle_migrations`, which is what it measures. Nobody should add a check that
guards a `SELECT` with a file read.

The 111 ms the `migrate` boot label used to report was `diskBlobCache` sweeping 2,975 files with a
`chmod` each, inside the same step. That is fixed in `packages/node-core/src/server/bindings.ts` and
the step is 29 ms.

#### `keepAlive: 'dom'` on the pane contract

Phase 8's own scope offered both halves: implement the field in `TaskPaneHost.tsx` for the panes that
hurt, or delete it. It is deleted. One pane set it, nothing read it, and what it promised — a pane's
elements kept alive across a task switch — is a hidden element tree per task, which is the memory shape
`docs/managed-agents.md` records declining for the agent transcript. The two mechanisms that were
already there cover what it was reaching for: `paneModels.ts` holds a pane's state per task across its
own mounts, and the query cache holds a pane's data across tasks. Phase 8 warmed the second with a
hover prefetch and moved the editor's document pool into the first, and then measured a pane toggle at
zero requests. Exit condition: a pane whose cost on remount is the *elements* rather than the data —
one holding a third-party canvas or a media element with no serialisable state — and a measurement
saying so.

#### A per-file row model for the diff

Phase 8's done-when line asked for one list re-render while a 200-file diff hydrates. It got 102, down
from 226, and 102 is the floor for what is there: `buildRenderableRows` builds one array over every
file, so a file arriving rebuilds it. Going lower means a row model per file with the virtualizer
reading a concatenation, which is a redesign of the most carefully tuned surface in the app — the
sticky header, the split bands, the find pass and the measure scheduling all read that one array — and
phase 8's own scope refuses restructuring anything in the diff beyond the two quadratic costs. Exit
condition: a profile of a real large pull request that puts `buildRenderableRows` above the tokenizer,
rather than an argument from the count.

#### `virtual` opted in at the long-list sites in cells

Phase 9's scope named six lists to opt into `Rows`'s `virtual` — the pull-request list, notes,
changes, context, docker and the agents sidebar — and called each "a one-prop change in the plugin's
client file". None of them shipped, for three reasons found against the source rather than argued:

- **The prop is not the terminal's.** `virtual` is on the shared `Rows`, so a plugin's call site sets
  it on both hosts, and the DOM half positions rows absolutely at a fixed `--row-h-virt`. The
  "`Rows` virtual by default" entry above already records that 25 of 27 DOM call sites would render
  wrong at a fixed row height; a plugin's list is one of those call sites.
- **The pull-request list already passes it.** `plugins/github/src/client/PullList.tsx` has been
  `virtual` on both hosts since before this programme.
- **The other five cannot take the flex swap.** Notes, changes, context and the agents sidebar draw
  several `Section`s stacked inside one scrolling body, and `virtual` makes a list grow into the room
  its panel has left — which is the stretch the default entry above refuses, once per section.
  Docker's images, volumes and networks are each the only list in a `TabPanel`, which on this host is
  a `ScrollViewport`: a virtual list inside one measures the height its own rows want, which is the
  failure `showing.tsx` names in its own comment ("it always fitted, always drew everything, and
  overflowed the frame").

What did ship from that half of the scope is the diff pane, which is where the number was: 5,303
renderables to 376 at five thousand lines (§ 2026-09-03 — phase 9). Exit condition
for revisiting the five: a list whose own panel bounds its height, on a host where the prop can be set
without deciding for the other one — which means either a terminal-only prop on the shared node, or a
measurement on the desktop saying its rows are uniform enough for the virtualiser.


### Added 2026-09-03, closing the programme

The last three of the arguments phase 10 held open, each refused on a number it took.

#### An incremental transcript projection

Phase 7 made the store keyed and the markdown incremental and left this one behind a figure: if a long
session still rebuilds `buildConversationItems` per event and the profile says that is the cost, the
projection becomes a per-turn fold that appends.

It does rebuild per event, and it is not the cost. Against the largest session in this machine's
66,264-event database, the rebuild is **0.61 ms** at 1,850 rows and **linear at about a third of a
microsecond a row**, so a streaming session at 25 events a second spends 15 ms of main thread per
second and one rebuild is a twenty-seventh of a frame
(§ 2026-09-03 — phase 10). Four copies of that session end to end, 7,400 rows, is
4.73 ms.

What an incremental projection would cost is not an append. `buildConversationItems` folds a tool
update into the card that opened it, a usage line into its turn's line, a plan into its turn, and a
subagent's stream into the card that spawned it, and every one of those targets can be anywhere earlier
in the list. Keeping those indexes live across arrival, out-of-order `seq`, and a snapshot merge is a
second implementation of the fold with its own drift. Exit condition: a session whose event array
passes about 10,000 rows, which is 6 ms a rebuild here, or a profile that puts the projection above the
DOM write it feeds.

#### Per-key query persistence

The persister serialises the whole dehydrated cache once per five-second window per node, and the first
read said to weigh the blob before choosing between per-key writes and a shorter throttle: tens of
kilobytes is nothing, megabytes means per-key.

It is a megabyte, and a megabyte turns out not to be the question. This developer's real store holds
**1,097,335 characters of JSON across 81 queries**, and `JSON.stringify` over it is **2.4 ms**
(§ 2026-09-03 — phase 10). Once per five seconds, on a window that is doing something
else anyway, that is not worth a key per query plus its eviction and its restore fan-in. The shape is
also healthy rather than accidental: 81 entries holding a megabyte says `queryPersistence.ts`'s
exclusions are keeping patch bodies and blobs out, and the largest single entry is one plugin-chrome
row at 163 KB. Exit condition: a blob past about ten megabytes, where the serialise reaches 25 ms and
drops a frame every five seconds.

#### The reconciler's per-element cost in the terminal client

`apps/tui/src/kit/reconciler.ts` — deleted by the terminal rewrite, and in the git history — tied
every element's destruction to its creating owner and wrapped every dynamic child in an accessor.
Both fixed bugs a person could see: a `Suspense` that resolves into a destroyed renderable draws
nothing, and loose text in a box throws.

Phase 9 answered the question the deferred argument asked, from the other end. The cost is per element
and the element count is bounded now: the heaviest screen in the client, a 5,000-line diff, draws
**376 renderables instead of 5,303** (§ 2026-09-03 — phase 9), and
`apps/tui/src/diffLong.test.tsx` holds a bound under 1,000 that forbids a count growing with the data.
A per-element cost over a few hundred elements is not something a frame notices, and removing either
behaviour brings back a documented bug. Exit condition: a screen that passes that bound, or a measured
frame time that lands on element creation.

## The numbers

What each phase measured, with the command that produced it, so an argument rests on a figure rather
than on an impression. Several phases were gated on a value an earlier one recorded, and the last phase
re-took every one of them.

Append a dated section. Do not edit an older one: a number that turned out to be wrong gets a new entry
saying so, because a decision made on the old figure was made on the old figure.

### 2026-09-02 — phase 0

Machine: this developer's M-series macOS laptop, Node 24.11.0 (Node 26.8.1 for the terminal client's
build). Nothing else in the programme had shipped.

#### The renderer's startup budget

`pnpm --filter @acorn/desktop build` → `apps/desktop/scripts/check-renderer-budget.mjs`.

| | Startup scripts | Styles | Startup assets | Preload depth |
| --- | --- | --- | --- | --- |
| Before, at `92fef8e0` | **1,329,679 B** (RED, budget 1,250,000 B) | 92,153 B | 148 | — |
| After the icon split | **974,732 B** (green) | 92,153 B | 151 | 4 |

The 1,329,679 B figure is this phase's own re-measurement. the decisions section recorded 1,324,279 B on
2026-09-02 and the first read 1,317,605 B on 2026-08-31, so the tree drifted 12 KB further the wrong way
in between. That drift is the whole argument for the denylist.

Two numbers the script now also prints:

- **Preload depth 4.** The longest chain of static imports from the entry chunk. The first read argued
  that 143 requests through the custom scheme handler is a waterfall; it is four rounds deep and
  otherwise parallel, so depth is not where the time is. That does not settle whether the scheme
  handler itself is slow per request — nothing here measures that.
- **74 more chunks, 1,727,294 B one dynamic import away**, not counted against the budget. Reported,
  not gated: the `__vite__mapDeps` array is the union over every import site in the entry chunk, so a
  legitimately lazy pane is in it and always will be. Denylisting it would fail forever.

#### The icon split

`pnpm --filter @acorn/client-core icons`, then the build above.

| | Value |
| --- | --- |
| Census: Lucide names spelled as literals in product code | **77** |
| `iconNodes.eager.json` | 13,750 B |
| `Icon-*.js` chunk, in the startup list | **15,847 B** (was 371,214 B) |
| `icon-nodes-*.js` chunk, lazy, not in the startup list | 368,667 B |
| Lucide icons in total | 1,756 |

The phase file said "sixty-eight names" from a grep on 2026-08-31. The script says 77, and the script
is the number: it counts `name="…"`, `icon: '…'` and `glyph: '…'` literals that are Lucide names, over
`packages/`, `plugins/` and `apps/`, excluding test files (a test's icon name is a fixture; nothing
draws it). The whole startup saving is 354,947 B, which is 27% of what the renderer used to load.

#### The terminal client's eager graph

`pnpm --filter @acorn/tui build` → `apps/tui/scripts/check-startup-graph.mjs`.

| | Value |
| --- | --- |
| Chunks reachable statically from the `App` chunk | **110** |
| Bytes in that closure | **1,114,282 B** |
| Whole build | 2,100,437 B |
| Ceiling set by this phase | 1,150,000 B |

Reproduces the decisions section's "110 chunks, 1.06 MB of 2.05 MB" exactly. The ceiling is the measured value
rounded up by about 3%, not the measured value itself: an exact ratchet goes red on a comment in a
client-core file, and this check exists to catch a 300 KB regression.

The icon split changed this number by zero, because the terminal client aliases both halves of the
icon set to an empty table — there is no SVG in a cell.

#### The node's boot breakdown

**This is the number phase 3 is gated on.** § A 503-until-ready node contract says the
wire contract ships only if the plugin passes dominate the boot after concurrency, taken as over
300 ms.

Measured by calling `startServiceRuntime` directly against a data root, under `tsx`, and reading the
`[service:boot]` lines. Two roots: an empty one (11 plugins, no loaded packages) and a copy of this
machine's `apps/node/.acorn` (16 plugins — 5 of them loaded from disk — a 1.6 MB `core.sqlite` and a
159 MB `agents.sqlite`), which is the realistic one.

| Step | Realistic root, first boot | Realistic root, second boot | Empty root, first boot | Empty root, second boot |
| --- | --- | --- | --- | --- |
| `login-shell` | 0 ms | 0 ms | 0 ms | 0 ms |
| `bundled-packages` | 10 ms | 8 ms | 14 ms | 7 ms |
| `migrate` | 6 ms | 4 ms | 220 ms | 4 ms |
| **`graph`** (the plugin loader) | **338 ms** | **125 ms** | 1 ms | 1 ms |
| all plugin `init` passes | **46 ms** | **24 ms** | 25 ms | 12 ms |
| all plugin `ready` passes | **0 ms** | **0 ms** | 0 ms | 0 ms |
| `cert` | 1 ms | 1 ms | 1 ms | 1 ms |
| `bind` | 7 ms | 7 ms | 20 ms | 8 ms |
| `scheduler` | 1 ms | 1 ms | 3 ms | 1 ms |
| **total to `listening`** | **412 ms** | **172 ms** | 287 ms | 36 ms |
| `reconcile.*`, after listening | 62 ms | 8 ms | 3 ms | 3 ms |

Per plugin, realistic root, first boot: `github` 24 ms, `memory` 7 ms, `agents` 3 ms, `terminal` 3 ms,
`browser` 1 ms, `changes` 1 ms, `workflows` 2 ms, `database` 2 ms, `http` 1 ms, and `docker`, `editor`,
`notes`, `preview`, `linear`, `model-providers`, `rollbar` all under 1 ms. **No plugin declares a
`ready`,** so that pass is free.

Three conclusions:

1. **Phase 3 must not ship the 503-until-ready wire contract.** The plugin passes are 46 ms cold and
   24 ms warm, an order of magnitude under the 300 ms bar. Binding the listener before plugin init
   would buy at most 46 ms and cost a wire contract every client and the MCP child would honour
   forever.
2. **What actually dominates the node's boot is `graph`, the plugin loader** — 338 ms cold, 125 ms
   warm, 82% and 73% of the boot. That is `loadExternalPlugins` scanning the data root's install
   directory, reading and verifying each manifest, importing each bundle, and running its migrations
   chain. It runs **in front of** plugin init, so no amount of concurrency in the init pass helps. If
   phase 3 wants the node listening sooner, the loader is the target.
3. `migrate` costs 220 ms only on a first-ever boot, and 4-6 ms thereafter. Not worth optimising.

Caveat, and it matters: measured under `tsx`, so `graph` includes transpiling whatever TypeScript the
loader pulls in. The five loaded packages in that root are built JavaScript bundles, so most of the
338 ms is real filesystem and import work, but a packaged build would be somewhat faster. Re-measure
against the staged `service.js` before deciding how much of the loader to rework.

#### The desktop's cold-start timeline — NOT measured

Every process now prints its own marks and the code is in place, but nobody has read the four accounts
side by side, so there was **no measured desktop cold-start timeline** at this point. Taking one means
launching the packaged shell with `ACORN_PERF=1` in its environment and `localStorage.acorn.perf = '1'`
in the renderer, then reading Rust's spawn, `[helper:boot] ready line`, `[service:boot] listener-up`,
`[renderer:boot] first paint` and `[renderer:boot] nodeReady` together. That needs the app running and
a person watching it, which this phase could not do. Phase 2 needs the number and should take it first.

The terminal client's own timeline is likewise unread: `[acorn:boot]` prints on exit, but reading it
means running `acorn` against a live node on Node 26.4.

#### What the histograms said — NOT measured

`ACORN_PERF=1` turns on a `git` histogram, a SQLite histogram and a line per request, and none of them
has been read against real traffic. Phase 5 is the phase that needs them (`git status` fan-out) and
should be the one to record them here.

### 2026-09-03 — phase 1

Same machine, Node 24.11.0 (Node 26.8.1 for the terminal client). Phase 0 had shipped at `17b03dbe`;
nothing else in the programme had.

#### The renderer's startup budget

`pnpm --filter @acorn/desktop build` → `apps/desktop/scripts/check-renderer-budget.mjs`.

| | Startup scripts | Styles | Startup assets | Preload depth |
| --- | --- | --- | --- | --- |
| After phase 0 | 974,732 B | 92,153 B | 151 | 4 |
| After phase 1 | **654,403 B** | 91,571 B | 133 | 4 |

**320,329 B off the first paint, 33% of what was left**, and 18 fewer requests. Against the pre-phase-0
figure of 1,329,679 B the two phases together have taken 675,276 B, just over half.

The four denylisted names are gone. The script's `KNOWN` allowance list is empty and a test in
`apps/desktop/test/scripts/checkRendererBudget.test.ts` asserts that it is:

```
[renderer-budget] startup scripts=654403B styles=91571B assets=133 depth=4
[renderer-budget] one interaction away: 109 more chunks, 1509975B (not counted)
```

No `KNOWN FAILURE:` lines, where the same command printed three before. Proof by name, from the built
startup list: `shiki` — absent, and two `shiki-*.js` chunks exist in the build, so it is fixed rather
than renamed. `DiffPane` — absent, two chunks exist. `wasm` — absent. `viewState` — absent, one chunk
exists (see the editor below). `icon-nodes` — absent, phase 0's.

`prModel` needs its own line, because it is the one that moved rather than shrank. There is **no
`prModel-*.js` chunk in the build any more**: making the GitHub plugin's PR pane a lazy contribution
took `prModel.ts` out of the eagerly-reachable set, and rolldown folded its modules into a chunk it
named `prSections-*.js`, which is not in the startup list. A chunk name is one module's name, so it
follows the graph. Both names are on the denylist now.

#### Where those bytes were, and what the reads got wrong

The `RemoteTree` chunk is in the modulepreload list on every cold window because it is the fallback
branch of `host/tree/Slot.tsx`, and it held `host/tree/components.ts`, whose one static import of
`DiffPane` pulled `features/diff/` and, through `infra/highlight/worker.ts`, the highlighter. That part
of decision 3 was exactly right. Two other parts were not:

- **`host/frames/remoteSolid.ts` is not a second copy of the component table.** It builds
  `KIT_NODE_COMPONENTS` with `Object.fromEntries(KIT_NODES.map(...))` — one factory per name that mints
  a node of that name. It imports no component and can import none: it runs inside a stranger's worker
  and touches no `window`. There was nothing to merge, and merging would have broken the sandbox rule.
  It was not touched.
- **`Markdown` was not the shiki edge.** `kit/components/content/Markdown.tsx` already reached the
  highlighter through `await import('../../../infra/highlight/shiki')` and its grammars through
  `infra/highlight/langs.ts`, which is loaders already. It is a loader in the table now for the
  streaming-transcript reason, not for a byte saving.
- **`prModel` was not a registry-holds-values problem in any of the four tables.**
  `plugins/github/src/client/index.ts` imported `./pullDetail/PrPane` statically to read
  `prPaneContribution`, which the same file declared beside the component — so the contribution row
  held the component, and with it the pull-request model, the overview, the conversation, the file list,
  the check log and the diff viewer. Every sibling plugin's pane contribution was already a `lazy()` in
  a module of its own; this was the one exception, and the phase file's Scope said pane contributions
  "already are" lazy. The fix is `plugins/github/src/client/pullDetail/paneContribution.ts`, the
  sibling shape.

#### The editor's grammars

| | Value |
| --- | --- |
| `viewState-*.js` — the chunk holding `features/editor/language.ts` | **60,861 B** (was 954,915 B) |
| Chunks in the build that hold a CodeMirror grammar | 17 |
| Of those, statically reachable from `language.ts`'s chunk | **0** |
| Grammar packages imported statically by `language.ts` | **0** (was 17) |
| Opening a `.ts` file, once the editor pane is loaded | **2 more chunks, 110,946 B** |

**894,054 B off the editor's lazy chunk, 94% of it.** The count is 17 grammar imports, not the 19
the decisions section and the phase file both say: 13 `@codemirror/lang-*` packages and 4
`@codemirror/legacy-modes` modes. `@codemirror/language` and `@codemirror/state` are the engine, not
grammars, and stay static.

The two chunks a `.ts` file fetches are the `lang-javascript` grammar and one shared Lezer chunk;
everything else CodeMirror needs came with `basicSetup` when the pane loaded. "One grammar" is the
honest claim rather than "one chunk". The four JavaScript dialects resolve the same package, so a
`.tsx` file after a `.ts` one fetches nothing.

#### The terminal client's eager graph

`pnpm --filter @acorn/tui build` → `apps/tui/scripts/check-startup-graph.mjs`.

| | Chunks | Bytes | Whole build |
| --- | --- | --- | --- |
| Before (phase 0's figure, re-measured) | 110 | 1,114,282 B | 2,100,437 B |
| After phase 1 | 111 | **1,024,422 B** | 2,109,214 B |
| Ceiling now held | | **1,060,000 B** | |

**89,860 B, 8%. The phase file's `Done when` asked for under 550 KB and this does not reach it**, and
the reason is that the phase file was wrong about where the terminal client's eager bytes are. Two
findings:

- **This host's kit table was never in its eager graph.** `apps/tui/src/plugins/RemoteTree.tsx` is
  loaded lazily, so `apps/tui/src/kit/components.tsx` and everything under it — the 173 KB `RemoteTree`
  chunk included — is fetched only when a loaded plugin draws a tree. Decision 3's claim that this
  table "is why that host's eager graph is half its whole build" is false. The table took the shared
  `KitTable` type for parity and kept every entry a component: the heavy nodes share
  `apps/tui/src/kit/showing.tsx` with the cheap ones, so a loader there would cost a frame of blank and
  save no bytes.
- **What the eager graph actually is, is the plugin roster.** `apps/tui/src/App.tsx` imports thirteen
  client plugin barrels statically so their `init` can register. Cutting each of the `App` chunk's 80
  direct static edges in turn and re-walking gives the exclusive cost of each: the largest after this
  phase is 28,040 B, then 23,823 B, then 21,274 B, and the rest is a tail of 75 chunks under 5 KB each.
  There is no registry left in it. Halving this number means not importing thirteen barrels before the
  first frame, which is **phase 4's** work, not a table's shape.

The 89,860 B this phase did take is the pull-request model and its subtree, measured by the same
edge-cut walk at 61,151 B across 4 chunks, plus the modules that came with it.

#### What the four tables cost, one line each

| Table | What it held eagerly | What it holds now |
| --- | --- | --- |
| `client-core/host/tree/components.ts` | 75 components, 5 of them reaching `features/` or the highlighter | 67 components and 8 loaders; nothing under `features/` is reached statically |
| `client-core/host/frames/remoteSolid.ts` | node factories, no components | unchanged — the claim about it was wrong |
| `apps/tui/src/kit/components.tsx` | 75 components, none in the eager graph | 75 components, type shared with the DOM host |
| `client-core/features/editor/language.ts` | 17 grammars, 894 KB | 17 loaders, 0 KB until a file is opened |

### 2026-09-03 — phase 2

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`) and 1 (`77ed2ebd`) had shipped.

#### The boot order, which is the whole phase

`pnpm --filter @acorn/desktop test` runs the boot test with `ACORN_PERF=1`, against a fresh data root
under the bundled Node. The helper's marks, before and after, measured by stashing the two changed
files and re-staging:

| `[helper:boot]` mark | Before | After |
| --- | --- | --- |
| `handshake` | +21 ms | +20 ms |
| `plugin-cache sweep` | +34 ms | +28 ms |
| `bundled plugins trusted` | +34 ms | +28 ms |
| `ws bound` | — (after the node) | **+31 ms** |
| **`ready line`** — Rust unblocks and creates the window | **+547 ms** | **+33 ms** |
| `service.start` — the node reported itself listening | +535 ms | +486 ms |
| `node adopted` | +543 ms | +493 ms |

**514 ms off the shell's blocking wait**, and the ready line went from the last mark to the fifth.
`apps/desktop/test/boot.test.ts` now asserts that order — `ws bound` before `ready line` before
`service.start` before `node adopted` — so undoing it fails a test rather than quietly costing half a
second.

#### The desktop's cold-start timeline — measured this time

Phase 0 left this unread and said phase 2 should take it. Three launches of
`ACORN_PERF=1 tauri dev` against this machine's real `apps/node/.acorn` (16 plugins, a 1.6 MB
`core.sqlite`, 166 MB of plugin databases), reading Rust, the helper and the node side by side.
Launch 1 had a cold WebKit store for the dev bundle identifier — no remembered node and no persisted
query cache. Launches 2 and 3 were warm.

| | Launch 1, cold | Launch 2, warm | Launch 3, warm |
| --- | --- | --- | --- |
| helper `ready line`, and `[shell] helper ready` one line later | +95 ms | +109 ms | +104 ms |
| node `migrate` (its own clock) | 210 ms | 89 ms | 88 ms |
| node `graph`, the plugin loader (its own clock) | 45 ms | 48 ms | 47 ms |
| node `listener-up` (its own clock) | +392 ms | +256 ms | +237 ms |
| helper `service.start` | +842 ms | +725 ms | +706 ms |
| **window open → the node is listening** | **747 ms** | **616 ms** | **601 ms** |

**The window opens 601 to 747 ms before the node's listener is up**, which is this phase's `Done when`.
`[shell] helper ready on <port>` is printed immediately before `open_window`, so it is the window's
own mark.

Two things in that table are worth a later phase's attention:

- **The node's own boot account under-reports by about 450 ms.** `service.start` resolves at helper
  +842 ms when the node's own clock says +393 ms, so the node's timer starts 449 ms after the helper
  did. That gap is spawning the process and evaluating the one-chunk 1,093,602 B service bundle before
  `startServiceRuntime` runs. Phase 0's breakdown does not see it, and it is larger than every step in
  the breakdown except `graph`.
- **`graph` is 45-48 ms here, not the 338 ms phase 0 measured.** Phase 0 measured under `tsx`, and its
  own caveat said to re-measure against the staged `service.js`. This is that re-measurement, and it
  changes the conclusion: **the plugin loader is not what dominates a real packaged boot.** The 220 ms
  `migrate` on a first-ever boot and the 450 ms of bundle evaluation are both bigger. Phase 3 should
  re-read this before targeting the loader.

#### What the renderer stopped waiting for

`pnpm --filter @acorn/desktop build` → `apps/desktop/scripts/check-renderer-budget.mjs`, measured by
stashing `index.tsx` alone.

| | With the two top-level awaits | Without |
| --- | --- | --- |
| Startup scripts | 655,372 B | **627,146 B** |
| Startup assets (requests through the scheme handler) | 134 | **43** |
| Preload depth | 4 | **3** |
| Styles | 91,571 B | 91,569 B |

**28,226 B and 91 requests off the first paint, and nobody predicted it.** A top-level `await` in the
entry module makes rolldown keep every module the entry reaches as its own async chunk; with the awaits
gone it merged them. Phase 0 measured 143 startup assets and said depth, not count, was the thing —
which was right about the waterfall and left the count on the table. The count is now 43.

Against the pre-programme figure of 1,329,679 B, the three phases together have taken 702,533 B, 53%,
and 105 of the 148 startup requests.

#### The renderer's own marks, and the one that would not be read

Launch 3, warm, dev build. `[renderer:boot]` offsets count from the document's navigation, so they
start where the window opening left off:

| Mark | Offset |
| --- | --- |
| `script start` | +1,154 ms |
| `nodeReady` | +1,213 ms |
| `node selected` | +1,214 ms |
| `plugins applied` | +1,250 ms |
| `first paint` | **never printed** |

Read this table for the ORDER, not the magnitudes. A dev build is proxied from Vite unbundled, so
`script start` is hundreds of module requests rather than the 43 a packaged build makes; the packaged
figure is not recorded anywhere. What the order says is that the node was reachable before the renderer's
entry module finished, and that `node selected` and `plugins applied` both land after the shell has
already been told to render — which is the phase.

**`first paint` was not measured, and phase 0's mark cannot be read the way it is.** It is a
`requestAnimationFrame` callback, and macOS pauses those while the window is occluded — the window
opens behind whatever the developer is looking at, so the callback never runs. Reading it needs the
window frontmost, which needs a person at the machine. Phase 10 should either take it that way or
change the mark to something a background window still fires.

#### Not measured, and why

- **The immutable-asset saving.** A dev build serves `no-store` by design, so the header only does
  anything in a packaged build, and reading it means `pnpm dist` plus a second launch to see the
  webview reuse its cache. Nothing here says what those hashed reads cost today.
- **A warm-cache first paint in a packaged build.** Same reason as the mark above, plus the same
  packaged build.

### 2026-09-03 — phase 3

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`) and 2 (`7c826ad6`) had shipped.

Everything here is measured against the **staged `service.js`**, not under `tsx`, and under the pinned
runtime the desktop ships (`apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin`, Node 24.11.0).
The harness forks the bundle with an IPC channel the way the helper does, sends one `service.start`,
and reads the `[service:boot]` lines against the parent's clock. The data root is a copy of this
machine's `apps/node/.acorn`: 16 plugins, five of them loaded from disk, a 1.6 MB `core.sqlite`,
166 MB of plugin databases, and 2,975 files in `blobs/`. Before-and-after pairs were taken by
reverting the changed files, rebuilding, re-staging, and running the same protocol.

#### The 449 ms phase 2 could not see, split

Phase 2 found that the node's own boot account starts 449 ms after the helper's, and asked phase 3 to
split spawning the process from evaluating the bundle. Median of seven forks:

| | Value |
| --- | --- |
| `fork()` → the child's first line of user code | **23 ms** |
| of which the child's own clock says was Node's bootstrap | 10 ms |
| **evaluating the service bundle's module graph** | **293 ms** (344 ms on the first, cold fork) |
| `fork()` → the bundle fully evaluated | **316 ms** |

So 316 ms of phase 2's 449 ms is spawn plus evaluation, and the remaining ~133 ms is the helper's own
work between its clock and the fork plus the `service.start` round trip. **Spawning the process is
23 ms and is not worth touching.** Bundle evaluation is 293 ms, which is over the 100 ms bar phase 3's
scope and phase 10's deferred list both set.

#### What the 293 ms is, and why per-plugin chunks are refused

Timing each external import in a fresh process, in this order, then importing the bundle with those
already warm:

| Import | Cost |
| --- | --- |
| `drizzle-orm` | 91 ms |
| `drizzle-orm/sqlite-core` | 76 ms |
| `@agentclientprotocol/sdk` | 25 ms |
| `zod` | 17 ms |
| `@hono/node-server` | 11 ms |
| `jose` | 10 ms |
| `ws` | 6 ms |
| `hono` | 5 ms |
| `node-pty` | 3 ms |
| `drizzle-orm/better-sqlite3/migrator`, `smol-toml`, `@vscode/ripgrep`, `node:sqlite` | 4 ms together |
| **the service bundle's own 1,099,400 B chunk, externals warm** | **51 ms** |

**The per-plugin dynamic-import split is refused, and the reason is that the premise was wrong.**
Phase 3's scope said "if it is over 100 ms, the fix is per-plugin chunks through dynamic imports in
`apps/node/src/composition/plugins.ts`". It is over 100 ms, and that fix buys nothing. Only 51 ms of
the 293 ms is acorn's own bundled code, and every plugin in `nodePlugins()` has its `init` called on
every boot, so making each one a dynamic import moves those 51 ms into 16 chunks and evaluates all of
them anyway. The other 242 ms is external libraries, which are already outside the chunk.

`drizzle-orm` and `drizzle-orm/sqlite-core` are 161 ms together and cannot be separated: the root
barrel alone is 92 ms, `sqlite-core` alone is 155 ms, and both together are 161 ms, so the 99 files
importing query operators from the root barrel are paying about 6 ms for the privilege. Narrowing them
would be 99 files for 6 ms. `sqlite-core` is the schema builder, and the node cannot migrate anything
without it.

Two candidates are left, sized, for whoever wants them: `@agentclientprotocol/sdk` at 25 ms, imported
statically by the managed-agent driver and needed only when an Agent Client Protocol session starts,
and `jose` at 10 ms for internal tokens. Both live in files phase 3 does not own.

#### The boot, before and after

Five warm boots of the same root under each build, medians. Warm because that is what a person's second
launch of the day is.

| `[service:boot]` step | Before | After |
| --- | --- | --- |
| `login-shell` | 0 ms | 0 ms |
| `bundled-packages` | 11 ms | 11 ms |
| `migrate` | **111 ms** | **29 ms** |
| `graph` | 52 ms | 59 ms |
| the whole `init` pass (`install` minus `graph`) | 24 ms | 24 ms |
| `cert` | 1 ms | 1 ms |
| `bind` | 8 ms | 8 ms |
| **total to `listener-up`** | **210 ms** | **132 ms** |

**78 ms off a warm boot, and none of it is the concurrency.** The `graph` step reads 7 ms slower after,
which is the loaded-plugin imports landing on a slightly colder page cache now that less runs in front
of them; it is noise, not a regression.

#### The login-shell probe, which is the phase's real number

The table above is a development build, where the probe does not run at all. With `isPackaged: true`,
which is what a packaged macOS build does:

| | Before | After |
| --- | --- | --- |
| `login-shell` step | **569 ms** | **5 ms** |
| total to `listener-up` | **757 ms** | **209 ms** |

**548 ms off a packaged macOS boot.** This machine's `$SHELL` is `/bin/bash`, and
`/usr/bin/time -p $SHELL -lic 'printf %s "$PATH"'` reports 0.52 to 0.55 seconds over three runs, which
matches the 569 ms step. A profile with a version manager in it costs more. The probe still runs, still
keeps its five-second ceiling, and the first process the node spawns waits for it; nothing on the path
to the listener does.

#### What the concurrent init pass actually saved: nothing measurable

The `init` pass is 24 ms warm and 38 to 41 ms on a first boot against this root, both before and after.
The task brief predicted "at most about 22 ms" on the reasoning that concurrency turns a sum into a
maximum. That reasoning does not apply here, and the reason is worth writing down: **these inits are
synchronous.** `ctx.storage.open()` opens a `node:sqlite` handle and runs drizzle's `migrate`, both
synchronous calls, and `agents.init` — the most expensive one — has no `await` in it at all. One thread
cannot overlap synchronous work, so `Promise.allSettled` starts 16 inits that then run to completion one
after another exactly as the `for` loop did.

The change is still right and it stays: the loop was serial because loops are, the file's own header
says declaration order is not load-bearing, and a plugin that does await something no longer blocks its
neighbours. But it is a correctness change with a rounding-error payoff, not a performance one, and
anyone quoting it should say so.

What the marks do show is that the pass is genuinely concurrent. Completion order is no longer
declaration order: on a first boot `github` and `memory` finish after `rollbar`, which is declared
eleventh places later.

#### The ten SQLite opens and migrations: confirmed a non-issue

Phase 3's scope asked for a measurement, not a change, and said to write down a journal check before
`migrate` only if the marks demanded it. They do not.

| | Value |
| --- | --- |
| `core.sqlite` open plus drizzle `migrate` (`openDb`) | **7 ms** |
| the nine plugin files, opened and migrated inside their inits | **23 ms** together, warm |
| the widest single one (`agents`, 159 MB) | 11 to 14 ms |

Thirty milliseconds for ten opens and ten migration chains. Drizzle's `migrate` on an up-to-date
journal is one `SELECT` against `__drizzle_migrations`, and that is what it costs. **No journal check
is needed, and nobody should add one.**

#### The 102 ms nobody was looking for

Splitting the `migrate` step to find out whether its 111 ms was really migration found that it is not.
`makeRuntime` is what the step covers, and inside it:

| Call | Cost |
| --- | --- |
| `openDb` — open plus migrate `core.sqlite` | 7 ms |
| `ensureSessionKey` | 0.2 ms |
| `activeIdentityStore` | 0.2 ms |
| `ensureBoundIdentity` | 0.6 ms |
| `ensureCert` | 1.2 ms |
| **`diskBlobCache`** | **102 ms** |
| `loadOrCreateInternalToken` | 0.1 ms |

`diskBlobCache` sweeps the blob directory at every boot, calling `chmod(0600)` on every file to migrate
entries written under a permissive umask. On this root that is 2,975 `lstat` calls and 2,975 `chmod`
calls, in front of the listener, and **not one file had the wrong mode.** `put` has written 0600 for a
long time, so the sweep exists for files an old build left behind.

Reading the mode off the `lstat` the loop already does, and chmodding only a file that is actually
wrong:

| | Value |
| --- | --- |
| `readdir` of 2,975 entries | 2 ms |
| `lstat` over all of them, checking the mode | 10.5 ms |
| `lstat` plus unconditional `chmod`, warm | 60 ms |
| the same during a real boot | 102 ms |
| files whose mode was wrong | **0** |

That is the whole 78 ms of the development-build table above. It was not in phase 3's scope list, and
I took it anyway: it is one line, it is the largest single item in the node's own boot account, it sits
on the serial boot chain this phase exists to shorten, and no other phase file names it.
`bindingsSecurity.test.ts` still proves the migration works on a 0644 file and now also asserts that an
already-0600 file's `ctime` does not move.

#### The second launch writes nothing under the plugin cache

`packages/custody/src/plugins/bundledPluginTrust.test.ts` asserts it with nanosecond mtimes: two
bundled packages, a full launch (sweep, then trust the roster), then a second launch through fresh
`PluginCache` and `PluginTrustStore` instances so the decision comes off disk rather than off an
in-memory flag. Four files exist afterwards — two bundles, `index.json`, and `plugin-trust.json` — and
all four `mtimeNs` values are unchanged by the second launch. Before this phase the same second launch
wrote all four.

Not measured as a wall-clock saving, and it would be dishonest to claim one: on this machine's APFS
volume five bundle writes and ten fsynced rewrites of two small JSON files do not show above the noise
in the helper's marks, which is why phase 2 measured `plugin-cache sweep` and `bundled plugins trusted`
at 28 ms together. The argument for the change is that the writes are unconditional, they fsync, and
they are in front of the window on a machine with a slower disk than this one.

#### Not measured

- **A packaged build.** Every number here is the staged bundle under the pinned runtime, driven by a
  test harness rather than by the Rust shell. The 548 ms login-shell figure is `isPackaged: true`
  through that harness, not a `pnpm dist` bundle launched from Finder.
- **The desktop's window-to-node gap after this phase.** Phase 2 measured it at 601 to 747 ms with the
  node listening at the end of it. The node now gets there 78 ms sooner on a warm development boot and
  548 ms sooner on a packaged macOS one, but nobody has re-read the four accounts side by side, which
  needs the app running and a person watching it. Phase 10 owns that.
- **`first paint`.** Still unread, for the reason phase 2 gave: it is a `requestAnimationFrame`
  callback and macOS pauses those while the window is occluded.

### 2026-09-03 — phase 4

Same machine. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`) and 3 (`facd8288`) had shipped.

The terminal client runs on **Node 26.8.1** with `--experimental-ffi`; nvm's default here is 24.11 and
OpenTUI cannot draw on it. Every number below is the built bundle (`pnpm --filter @acorn/tui build`,
then `node --experimental-ffi dist/main.js`) driven through a pty with `script -q`, against a fixture
data root and a fixture config directory, quit with `Ctrl+C`, reading the `[acorn:boot]` marks phase 0
added. Before-and-after pairs were taken by stashing `apps/tui` and `packages/client-core`, rebuilding,
and running the same protocol.

Caveat on the "starting a node" rows: there is no `standalone.js` beside the TUI bundle in a checkout,
so `supervise.ts` falls back to the source entry under `tsx`. That is what a developer's `acorn` does,
and it is what the before column was paying for.

#### First draw

Medians of three runs, except the start rows (two before, three after).

| | Before | After |
| --- | --- | --- |
| Attached to a running node, **warm** cache | 88 ms | **67 ms** |
| Attached to a running node, **cold** cache | 88 ms | **65 ms** |
| **Starting a node** (root opened before) | **722–852 ms** | **62 ms** |
| First-ever start, fresh root and no cache | 886 ms | 886 ms — unchanged, and deliberately |

**The 300 ms target in the phase file is replaced by 67 ms**, which is the measured warm attached
figure. The proposal was written before phase 0's marks had been read on this host; the attach path was
never the problem. What was the problem is the row below it: `acorn` against a stopped data root drew
its first frame **at 62 ms instead of 722–852 ms**, an order of magnitude, because the shell no longer
waits for a node it just spawned. In a checkout with a cold `tsx` cache that gap is seconds rather than
hundreds of milliseconds.

Cold and warm attached differ by 2 ms, which is honest and slightly disappointing: the restore is one
`readFileSync` of a 1.8 KB snapshot on this fixture root. On a real root the snapshot is hundreds of
kilobytes and the gap will be larger; nobody has measured that.

The first-ever start still waits, and that is the design. There is no `node.json` to name a cache
partition with and no cache under it, so there is nothing to draw and waiting costs nothing.

The marks after, warm attached, one run:

| Mark | Offset |
| --- | --- |
| `node open` | +3 ms |
| `cache restored` | +21 ms (18 ms) |
| `App imported` | +35 ms (14 ms) |
| `renderer created` | +39 ms (5 ms) |
| **`first draw`** | **+67 ms** (28 ms) |
| `roster registered` | +81 ms (14 ms) |

…and before, warm attached, one run: `node open` +3 ms, `App imported` +43 ms (**40 ms**),
`tasks read` +53 ms, `renderer created` +60 ms, `first draw` +90 ms. Two things moved: the `App` import
is 14 ms rather than 40 ms because the roster left it, and the tasks round trip is gone from the
critical path entirely.

#### The eager closure, and the new ceiling

`pnpm --filter @acorn/tui build` → `apps/tui/scripts/check-startup-graph.mjs`.

| | Chunks | Bytes | Whole build |
| --- | --- | --- | --- |
| After phase 1 | 112 | 1,026,357 B | 2,110,161 B |
| After phase 4 | **91** | **841,142 B** | 2,122,669 B |
| Ceiling now held | | **870,000 B** | |

**185,215 B, 18%, and 21 fewer chunks.** The whole build grew 12 KB, which is the roster becoming its
own chunk boundary rather than being folded into `App`.

This is phase 1's missed target, and it is still missed: phase 1's `Done when` asked for under 550 KB.
Phase 1 was right that the roster was what remained and wrong that removing it would halve the number.
Its edge-cut walk measured each barrel's *exclusive* cost — the largest 28,040 B, then a tail of 75
chunks under 5 KB — and cutting all twelve at once takes 185 KB, not 500 KB, because most of what the
plugins reach is client-core that the chrome reaches too.

What is left is the chrome and the client-core it draws with: `PanelGrid` 228 KB, `asking` 114 KB,
`App` 108 KB, `fleet` 92 KB. That is what the first frame is made of. There is no registry in it and
nothing in it is waiting to be made lazy, so **the next honest saving here is a smaller kit, not a
later import**, and nobody should set a byte target for this host again without saying which components
they intend to delete.

#### The cache directory is written

Proof by file, against the fixture config directory after one run:

```
$ ls -l "$ACORN_TUI_CONFIG_DIR/cache"
-rw-------  1  1798  acorn-cache%3A92973bbb-580b-4dff-837d-bd59a52c508c.json
```

One file, named by the partition key (`acorn-cache:<nodeId>`, colon percent-encoded), 0600 in a 0700
directory. Before this phase that directory never existed: the store was installed and no persister was
ever driven. Its four entries, all `success`, are `['workspaces','groups','v2']`, `['tasks','v3']`,
`['integrations','v3']` and `['prefs']`.

That last fact is also the proof that the node's arrival is honoured. On a start run all four of those
queries fail with `ECONNREFUSED` while the child boots; they are `success` in the snapshot because the
first non-offline state invalidates the active queries and they refetch, the same effect
`apps/desktop/src/client/index.tsx` has held since phase 2.

#### Two things the reorder exposed, both fixed here

Neither is in the phase file, and both were only reachable once a frame could be drawn in front of a
node that is not listening.

- **`Unknown node`, not `ECONNREFUSED`.** Skipping `connect()` until the handshake left the broker with
  no record, and `NodeBroker.fetch` answers that with a hard `Unknown node` error rather than a
  reconnect. The fix is to connect to the row last time's handshake wrote — its port is dead, the broker
  reports `offline` and retries, which is a state the footer already draws.
- **An unhandled rejection drew OpenTUI's debug console over the shell.** `initSessions` in client-core
  fires its first pull without a `catch`; OpenTUI answers an uncaught error by showing its console
  overlay. Fixed at the source, and the renderer is now created with `openConsoleOnError: false`. The
  host also keeps OpenTUI's console *capture* on and hidden rather than deactivating it, so a stray
  `console.warn` from a plugin lands in the capture and is printed after `renderer.destroy()` instead of
  being written to the file the renderer draws on.

#### Not measured

- **A real data root.** The fixture root has no tasks, projects or worktrees, so the rail is empty in
  every frame above and nothing here says what a hundred-task rail costs to draw. The cache snapshot is
  1.8 KB rather than the hundreds of kilobytes `cache.ts`'s own comment assumes.
- **A packaged build.** In a checkout the TUI has no `standalone.js` beside it, so the started node runs
  under `tsx`. Phase 7 of the bundle programme pins that layout.
- **`tasks:changed` against a real write.** `watchTaskChanges()` is installed and the shell now reads the
  client it invalidates, which `chrome.test.tsx` covers from the cache side, but nobody has created a
  task on the node from a second client and watched this rail move.

### 2026-09-03 — phase 5

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`) and
4 (`92983971`) had shipped.

Every number here comes from a throwaway `*.test.ts` under the package it measures, driving the real
modules with the real subprocesses and the real SQLite file, and counting at the seam. The two
measurement files were deleted after they were read; the assertions that hold each number are in the
permanent tests named below. What is **not** here is a reading of phase 0's request log, because that
needs the packaged shell running with a person driving a terminal, and port 4317 is this machine's live
instance. The section at the end says what that leaves unmeasured.

#### git processes per status ping

One status ping, as the trace defines it: every connected client asks for the rail's dirty markers
(one `git status --porcelain=v2 --branch` per active worktree) and, with a changes pane open, the
local-changes list (`git status --porcelain=v2` plus two `git diff --numstat` per worktree). Two
clients, four worktrees, one dirty file in each, real git.

| | `git status` | git processes in total |
| --- | --- | --- |
| Before | 16 | 32 |
| After | **4** | **20** |

Four is one per worktree per two-second window, which is the phase's done-when line, and it does not
move with the number of clients: the second client's eight reads all join or hit the first client's
four runs. The `git diff --numstat` pair is untouched at 16, because this phase shares the status half
of the local-changes read and nothing else. That is the residue worth knowing about: a changes pane on
two clients is still 16 processes a ping, and coalescing them means caching a per-file stat list, not
a status line.

Held by `packages/node-core/src/server/worktrees/worktreeStatus.test.ts`: two concurrent callers run
git once, a caller inside the window runs it zero times, an invalidated path runs it again, and a
failure is never remembered.

#### The worktree-removal guard

**It passes.** A file written 100 ms ago still blocks `removeWorktree` without `force`, with the cache
warmed to "clean" immediately before the write. `worktreeDirty` passes `fresh: true`, which skips both
the in-flight promise and the window, and the same test proves the bypass is real by counting two
`git status` spawns for one read and one refusal issued together, where two reads would have been one.

#### SQLite reads in auth

A hundred authenticated requests with the same device token, counting calls into `db.select` on the
`devices` table.

| | Reads |
| --- | --- |
| Before | 100 |
| Inside one 60-second window | **1** |
| Spread over 10 minutes | 10 |

Zero on a warm token, which is the done-when line, and one per minute of continuous traffic. A revoke
drops the entry before it notifies anyone, and a token that failed is never remembered, both held by
`packages/node-core/src/server/auth/deviceTokens.test.ts`.

#### The task-list route

`GET /v2/core/tasks`, counting calls into `db.select`. The route reads the tasks, their links, and
every project they mention.

| Rows | Before | After |
| --- | --- | --- |
| 1 project, 2 tasks | 4 | **3** |
| 3 projects, 24 tasks | 26 | **3** |

It was one project query per task, in a loop, including a repeat for every task sharing a project. The
list is what every client refetches on `tasks:changed`, so on a hundred-task node that was a hundred
identical statements per write per client. Held by
`packages/node-core/src/server/routes/projects/tasks.test.ts`.

#### Query traffic on an idle client while a terminal streams — counted at the client, not the node

A terminal producing output crosses the idle-to-working threshold repeatedly, and each crossing used to
be one `term:status` frame with six subscribers. Counted as reads provoked per crossing, on a client
with a task open, a changes pane, a PR pane and the agents sidebar:

| Subscriber | Before, per edge | After, per edge |
| --- | --- | --- |
| Plugin chrome sweep (`chromeData.ts`) | one descriptor read per plugin per contribution | 0 |
| Worktree status sweep (`taskStatus.ts`) | 1 read, 3 git processes per worktree behind it | 0 |
| Session roster (`agentSessions.ts`) | 1 read | 1 read |
| Pull-request keys (`prTabs.ts`) | 2 invalidations | 0 |
| Workflow runs and steps (`AgentTaskSidebar.tsx`) | 1 read plus one per run | 0 |
| Terminal client re-export | unused | removed |

The session roster is the one thing that genuinely wanted this edge, and it is the only thing that
still hears it, on `terminal:sessions-changed`. The dirty markers moved to `worktree:status-changed`,
which the terminal engine fires on the human edges only: a command going quiet, a session exiting, a
setup script finishing. So a `git commit` typed into a shell still moves the markers immediately, and a
build spewing output does not.

`chromeData.test.ts` holds the first row (a `terminal:sessions-changed` frame bumps no plugin's chrome
revision, and a `term:status` naming one bumps only that one), and `wsClient.test.ts` holds the
routing.

#### Backpressure

Driven over a real socket with the client end paused and the hub's mark set to one byte, so the pause
and the resume happen for real without pushing four megabytes through a loopback socket
(`maxBufferedBytes` on `WsAuthDeps` exists for that and nothing else).

Four one-megabyte `term:out` frames into a paused socket: the engine is asked to pause the
pseudo-terminal once, not once per frame; all four frames arrive with `seq` 1, 2, 3, 4; the engine is
asked to resume once the buffer drains. A socket terminated while holding a pause releases it. Three
invalidation frames shed in the same congested window produce exactly one `ws:shed` marker and no gap
at all, and `nodeBroker.test.ts` shows the broker forwarding a marker rather than closing the socket,
including one that did skip a number.

Before this, a frame over the mark was dropped and `seq` incremented anyway, so the broker read the gap
as loss and closed the socket, and reconnect re-attached every terminal.

#### Not measured

- **Phase 0's request log.** Every done-when line in the phase file is written in terms of
  `ACORN_PERF=1`'s per-request lines and its git and SQLite histograms. Reading them means launching
  the packaged shell with a person driving a terminal at full rate, and this machine's live instance
  holds port 4317 and the data root's lock. The numbers above are the same quantities counted at the
  seam instead, in-process, with real subprocesses and a real database. Nobody has read the histograms
  against real traffic, which is still what phase 0 asked for and still owed. Phase 10 should take it.
- **A deliberately saturated socket recovering without a reconnect, in the app.** Held as a unit over a
  real socket, not observed on a real build's output.
- **The `git diff --numstat` pair.** Two processes per worktree per client per ping, untouched, for the
  reason in the first section.

### 2026-09-03 — phase 6

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`),
4 (`92983971`) and 5 (`28781ae6`) had shipped.

Every number here comes from a throwaway `*.test.ts` or `*.test.tsx` under the package it measures,
driving the real modules — the real `@xterm/headless`, the real panel in jsdom — and counting at the
seam. Both measurement files were deleted after they were read; the assertions that hold each
behaviour are in the permanent tests named below. The "before" figures for the tab switch were taken
by checking the two client files out at `92fef8e0` and running the same measurement against them, not
by reading the old code.

The corpus for the node-side numbers is one megabyte of real terminal output: 4,272 bytes of
`git log --color --graph --oneline` repeated, with a full-screen redraw frame every third chunk
(cursor hide, clear, box-drawing borders, a quoted string and a backslash — the shape an agent TUI
emits). 339 chunks, 1,004,005 bytes.

#### Parser work for an unwatched session

The whole point of the phase. Same bytes, nobody attached.

| | Time |
| --- | --- |
| Before: an emulator per session, running from the moment it was spawned | **492 ms** |
| After: the ring alone, no emulator built | **2.8 ms** |

Emulators built for an unwatched session: **0**, which is the assertion rather than the timing.
`plugins/terminal/src/server/terminalDisplay.test.ts` holds it, along with the last detach disposing
and a cold attach rebuilding byte for byte the same visible screen a session that emulated throughout
would have shown.

Phase 0 put its `ACORN_PERF=1` histograms on the git and SQLite seams, and `terminal.write` is inside a
plugin rather than in node-core, so this is the phase file's other option taken: the parser is counted
at the seam in a test rather than sampled through a histogram. What a histogram would add is a reading
against a person's real session, which is the same thing phase 5 left owed and phase 10 should take.

#### What an attach costs the node

| | Time |
| --- | --- |
| Before, per tab switch: serialize a warm framebuffer | 17.8 ms |
| After, per first visit to a tab: replay the ring and serialize | 20.0 ms |

The same work, and the point is how often it happens: it used to be once per switch, for ever, and it
is now once per tab per drawer session.

#### Network per tab switch

Counted in jsdom with the real panel and the real surface, xterm stubbed, four switches between two
sessions.

| | Before | After |
| --- | --- | --- |
| First visit to a tab | 1 `POST …/resize`, 1 `term:attach`, 1 xterm built | same |
| Every switch after that | 1 `POST …/resize`, 1 `term:detach`, 1 `term:attach`, 1 xterm disposed, 1 built | **nothing** |

Over four switches: **4 HTTP requests and 8 WebSocket frames before, 1 and 1 after** — and the one is
the second tab's own first visit, not a switch. Held by
`plugins/terminal/src/client/TerminalPanel.test.tsx`, which also fails if the list goes back to
iterating the session rows or moves to `<Index>`.

#### `term:out` wire volume

Bytes on the wire for the same corpus, per flush, one flush per coalescing tick. The node hop is the
node's socket to the desktop broker; the helper hop is the broker's forward to the renderer, which used
to re-wrap the JSON frame in a push and stringify it again.

| Corpus | Node hop | Helper hop | Encodes, 3 sockets |
| --- | --- | --- | --- |
| Mixed, as above | 1,196,783 → **1,016,209 B** (15.1%) | 1,223,225 → **1,028,413 B** (15.9%) | 1,017 → **339** |
| The full-screen redraw frames alone | 57,743 → **42,601 B** (26.2%) | 66,557 → **46,669 B** (29.9%) | |
| The plain-text chunks alone | 1,139,040 → **973,608 B** (14.5%) | 1,156,668 → **981,744 B** (15.1%) | |

So the saving is a sixth of the bytes on ordinary output and nearly a third on the escape-heavy frames
a full-screen agent draws, which is the traffic that actually arrives at 60 frames a second. The
`payload` itself is 1,004,005 B, so the after figures are the payload plus 36 bytes of id per frame and
nothing else.

The **encodes** column is the part that does not show up in bytes: the node used to `JSON.stringify` the
frame once per attached socket, and now builds one frame per broadcast whatever the socket count.
`packages/node-core/src/server/transport/wsHub.test.ts` holds that two attached sockets receive
byte-identical frames, that a binary frame takes no sequence number, and that an id the fixed-width
field cannot spell falls back to the JSON frame rather than going missing.

#### Not measured

- **The app.** Every number above is in-process. Nobody has watched a real build spew output through
  the packaged shell with these changes in, because this machine's live instance holds port 4317 and
  the data root's lock. The smoke checklist in docs/testing.md is what covers that, by hand.
- **Memory per open tab.** Keeping an xterm per tab is the trade the phase accepts, and nobody has
  measured what one costs. jsdom's stub is not an xterm, and a real figure needs the app.
- **Scrollback loss in practice.** A cold attach rebuilds from 256 KB, so a program whose screen
  depends on older bytes redraws from its next output
  (§ Scrollback beyond the ring). What that looks like for a real agent TUI
  after a long build has not been watched.

### 2026-09-03 — phase 7

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`),
4 (`92983971`), 5 (`28781ae6`) and 6 (`449807fb`) had shipped.

Every number here comes from a throwaway `*.test.ts` under `plugins/agents`, replaying a **real
session out of this machine's own agents database** — a read-only copy of
`apps/node/.acorn/plugins/agents.sqlite`, 151 MB, 66,264 events, through the real
`buildConversationItems` and the real `renderBlocks`. The "before" column is the old algorithm written
out beside the new one in the same file and fed the same events, so both see the same data in the same
process. The measurement file was deleted after it was read; the assertions that hold each behaviour
are in `managedStore.test.ts`, `usageFold.test.ts`, `managedBridge.test.ts`, `AgentTranscript.test.tsx`
and `Markdown.test.tsx`.

The session is **`72f744c0-abff-49b6-a84f-4077989ce7bf`, "Implement phase 4 of
docs/future/phased-review-steps/", 2,727 events**, the largest in the database and the one
the decisions section's "2,700 events" refers to. 881 of its events are `usage`, which is 32%.

#### The event mix, database-wide

| Type | Rows | Share |
| --- | --- | --- |
| `tool` | 35,472 | 54% |
| `usage` | **16,359** | **24.7%** |
| `assistant_message` | 11,155 | 17% |
| everything else together | 3,278 | 5% |

Confirms the decisions section's "usage rows are 25% of all events" exactly. It also says something that read
did not: **`tool` is more than twice as many rows as `usage`**, and nothing in this phase folds those.
The transcript already collapses a call's updates into one card at render time, the way it used to do
for usage; folding them at the source is the same shape of change and is not in this phase.

#### What one streamed event costs

Median of three replays of the whole session, after a warm-up pass.

| | Before | After |
| --- | --- | --- |
| Store bookkeeping, whole session | 59.0 ms | **0.4 ms** |
| Store bookkeeping, per event | 21.6 µs | **0.1 µs** |
| One projection rebuild at full size | 1.00 ms | **0.85 ms** |
| Bookkeeping plus one rebuild, whole session | 901 ms | **771 ms** |
| **Per arriving event** | **0.33 ms** | **0.28 ms** |

**The store's own per-event work is 200 times cheaper**, and that is the whole of what `appendEvent`
was: two linear scans, a copy of the array and a sort of an already-sorted array, on a list that grows
to 2,727. It is now a `Set` lookup and a `push`.

Two honest caveats on the rest of that table.

- **The 2 ms budget in the phase file was already met before the phase.** At 2,727 events the whole
  per-event cost outside the DOM was 0.33 ms, not something over 2 ms. The proposal was written from
  source rather than from a profile, which is what its own `Verify before building` line said to check.
  What the phase actually buys at this size is the 21.6 µs and the highlighter, not a budget rescue.
- **The projection rebuild is now the cost**, at 0.85 ms of the 0.28 ms average and rising with the
  session. Folding usage takes the array from 2,727 rows to 1,850, which is where the 1.00 → 0.85 ms
  comes from. Making that rebuild incremental is refused for now and parked in phase 10, and this is
  the number phase 10 should argue from.

`buildConversationItems` still copies and sorts its input on every call, and that was measured rather
than assumed: on the 1,850-row array the copy plus sort and an in-order check that would skip it both
land around 0.02 to 0.06 ms, run to run, because V8's sort walks an already-ordered array in one pass.
Guarding it buys nothing, so it was left alone.

#### The Markdown work, on the longest fenced message in the database

Found by concatenating every `assistant_message` delta per message id across all 114 sessions: session
`6c8cff0a-6b8a-4016-84cf-c781cf7406f6` ("Microlighter"), **15,083 characters, 34 blocks, 3 closed code
fences** — which is exactly the "message with three fences" the phase file describes.

| Over eleven renders (the message plus ten streamed updates) | Before | After |
| --- | --- | --- |
| Blocks whose element is replaced | 374 (all 34, every render) | **10** (one per update) |
| **Highlighter calls** | **33** | **3** |
| Copy buttons disposed and re-mounted | 33 | **3** |
| Parse of the whole message | 0.31 ms | 0.31 ms |

**No fence re-highlights while its text is unchanged**, which is this phase's `Done when`, and
`Markdown.test.tsx` holds it with a spy across ten updates.

The parse is deliberately unchanged: `renderBlocks` still reads the whole source every tick, because
the parser is line-based and cheap (0.31 ms for 15 KB) and a resumable parser would be real machinery
for less than the DOM write it feeds. What the split buys is everything after the parse.

The longest message in the profiled session itself is 3,758 characters over 13 blocks with no fences;
growing it moves 1 key of 14.

#### The snapshot a client reads

`GET /v2/…/snapshot` caps a page at 2,000 event rows. Session `72f744c0`, first page:

| | Before | After |
| --- | --- | --- |
| Rows in the page | 2,000 | **1,345** |
| Serialized bytes | 2,351,578 B | **2,158,126 B** |

**33% of the rows and 8.2% of the bytes.** The gap between those two numbers is the finding: usage
rows are small, so folding them is a saving in rows walked and objects held rather than in bytes on the
wire. The rows are what `buildConversationItems` pays for on every event afterwards, which is why it is
worth doing, but nobody should quote this as a transfer saving.

The ledger is untouched, and `managedBridge.test.ts` asserts it against a real migrated database: 58
usage rows in one turn project as one through the HTTP bridge, while `exportSnapshot`, `store.snapshot`
and `eventPage` all still return 58.

#### What a projected event reads

| | Before | After |
| --- | --- | --- |
| Row reads per `user_message`, `request`, `request_resolved`, `turn_completed` | up to 2,000 event rows, plus every turn and request | **0** — one turn row or one request row arrives with the event |
| Row reads per `error` | up to 2,000 | up to 2,000 — unchanged, on purpose |
| Projected events in the whole database | 679 of 66,264 | of which **645 no longer refetch** and 34 (`error`) still do |
| In session `72f744c0` | 7 refetches | **1** |

`error` keeps its refetch because it also expires the session's pending requests, and no frame names
that set.

#### Not measured

- **The app.** Every number above is in-process, against the real database but not through the shell.
  This machine's live instance holds port 4317 and the data root's lock, so nobody has watched a real
  agent stream through the packaged build with these changes in. The smoke checklist in
  docs/testing.md is what covers that, by hand.
- **Text selection surviving an update.** No test covers selection anywhere in this repo — it needs a
  real selection in a real window. `Markdown.test.tsx` asserts the thing selection depends on, which is
  that an unchanged block keeps the same element, but that is a proxy and it should be confirmed by
  hand: select across two paragraphs of a streaming agent message and watch the selection hold.
- **Memory.** Folding usage keeps roughly a third fewer event objects per session in the client, and
  the highlight cache holds up to 200 fences under 16 KB each. Neither was weighed.

### 2026-09-03 — phase 8

Same machine, Node 24.11.0. Phases 0 (`17b03dbe`), 1 (`77ed2ebd`), 2 (`7c826ad6`), 3 (`facd8288`),
4 (`92983971`), 5 (`28781ae6`), 6 (`449807fb`) and 7 (`9e5d90ca`) had shipped.

Every number here comes from a `*.test.tsx` under jsdom driving the real component — the real
`DiffPane` over 200 files, the real `EditorPane` over a real CodeMirror, the real `TabRail` — and
counting at the seam. The "before" columns are not modelled: they are the same harness run against the
same tree with the phase's own files stashed, so both columns see the same fixture in the same process.
The measurement files were deleted after they were read; the permanent assertions are named under each
table.

#### List re-renders while a 200-file diff hydrates

Counted as calls to `buildRenderableRows`, which walks every file in the diff and every row in each of
them and is what the virtualizer, the measure passes and the sticky header all hang off. 200 files,
each a small patch, hydrated to completion.

| | Row-model rebuilds |
| --- | --- |
| Before | 226 |
| After | **102** |

One per file that arrives, near enough, against two to three per file before: the statuses moved from a
`Map` behind one version counter to a store keyed by path, and the load row reads its own key rather
than the row model carrying a status baked in at build time. Each rebuild also walks all 200 files, so
the memo's own iterations went from about 45,000 to about 20,000, and the `hydrator.status()` calls
inside them from about 45,000 to zero.

**102 is not 1, and the phase file's done-when line said one.** Getting there means a row model built
per file rather than over all files, and that is a restructure of the most carefully tuned surface in
the app, which this phase's own scope refuses. What is left is the floor for the shape that is there: a
file arriving changes the rows, and the rows are one array.

Held by `packages/client-core/src/features/diff/DiffPane.test.tsx`, which fails at 226 against the old
shape, and `packages/client-core/src/kit/diff/hydration.test.tsx`, which holds the property underneath
it: a publish for one path does not re-run a memo reading another. That file is `.tsx` because the
`logic` project runs in bare Node against Solid's server build, where a store notifies nobody.

#### Requests when the editor pane comes back

Counting calls into the editor's API from a mount, driving the real pane.

| | `root` | `read` |
| --- | --- | --- |
| Coming back to a task after visiting another, before | 1 | 1 |
| Coming back to a task after visiting another, **after** | **0** | 1 |
| Pane closed and reopened in the same task, before | 1 | 1 |
| Pane closed and reopened in the same task, **after** | **0** | **0** |

Zero requests for a pane toggled inside a task, which is the phase's done-when line, and the open file
keeps its text, its undo history and its cursor with it: the per-file documents moved into the pane
model, which the host holds per (pane, task).

Across tasks the file is read again, deliberately. The agent shares the worktree, so the pane cannot
serve a file's text out of a cache it left behind; what it does not ask for again is the checkout path,
which is now a query with a one-minute window and is warmed by the rail on hover.

Held by `plugins/editor/src/client/EditorPane.test.tsx`.

#### Round trips to first editor text on a remembered file

The same harness with an artificial latency on every request, so the slope across two latencies counts
serial round trips rather than milliseconds of jsdom.

| Latency per request | Before | After |
| --- | --- | --- |
| 50 ms | 222 ms | **174 ms** |
| 100 ms | 331 ms | **232 ms** |
| slope (serial round trips) | **2.2** | **1.2** |

Two serial requests became one. The first read's fixed cost — importing the file's grammar, and jsdom
itself — is the ~120 ms both columns carry.

The first read called this three round trips (root, mount, read). Only two of them are requests; the
mount between them is local, and it is gated on the root rather than on the network.

#### The node-switch remount, which is an examination

The phase said to measure it and act only if it is over a second. It is not, and the change is not
made.

What a node switch does is re-key `PersistQueryClientProvider` and the whole shell under it
(`apps/desktop/src/client/index.tsx`), so the data half is: build or look up the node's cache
partition, restore its persisted snapshot, and remount the subtree. Driven in jsdom against the real
`clientFor` and a **2.4 MB snapshot of 300 queries**, far larger than a real partition:

| | |
| --- | --- |
| First mount, including the restore | 9 ms |
| Switching node A → B, subtree remount | 5 ms |
| Switching node A → B, to the new cache restored | 5 ms |

**Verdict: leave it.** Single-digit milliseconds on the half that can be measured here, against a
threshold of a second.

What that does not include is the shell's own re-render — the rail, the panes, the plugin chrome —
which needs the packaged shell with two nodes configured and a person clicking the switcher. The
nearest measured bound is phase 2's renderer marks, where everything from `script start` to
`plugins applied` is 96 ms in a dev build (§ The renderer's own marks). A remount does
a subset of that with the modules already evaluated, so it is not the second the phase set as its bar.

#### Rail hover prefetch

Behavioural rather than numeric, held by `packages/client-core/src/features/tabs/TabRail.test.tsx`
against the real rail: a pointer settled on a row for 200 ms warms every pane that declares a
`prefetch`, a row crossed for 50 ms warms nothing, and a pane that declares none is not asked. The
agent pane's session list is deduplicated over a five-second window in the store, so the hover and the
click that follows it are one read rather than two
(`plugins/agents/src/client/sessions/managedStore.test.ts`).

#### Not measured

- **The app.** Every number here is in-process. Nobody has watched a task switch, a pane toggle or a
  node switch through the packaged build with these changes in; this machine's live instance holds
  port 4317 and the data root's lock. Phase 0's request log is still owed, and phase 10 should take it
  with the app running — it is the only thing that can say what a real task switch issues across every
  pane at once, rather than per pane at the seam.
- **The rail's hover prefetch against real latency.** The test counts calls, not milliseconds, and
  nobody has watched whether 150 ms is the right settle for a real pointer on a real rail.
- **Memory.** The editor's document pool now outlives a pane mount, so a task with twenty files open
  holds twenty `EditorState`s until the task is left. Nothing weighed that; it is bounded by the tabs
  the reader opened, and it was already the shape within one mount.

### 2026-09-03 — phase 9, the terminal client's keystroke

Every number here is from `apps/tui`'s own suite under Node 26.8.1
(`PATH=~/.nvm/versions/node/v26.8.1/bin:$PATH npx vitest run` from `apps/tui`; on the default Node
the whole suite skips). Before and after were taken from the same working tree, the before by
stashing the phase's source changes and running the same throwaway case again.

#### What a key press walks

A region three boxes deep holding a list and one control beside it, and the move is Down from the
control. The counter is `walkSteps` in `apps/tui/src/keys/regions.ts`, behind
`ACORN_TUI_KEYS_TRACE`; it counts renderables visited.

| Region | Nodes visited per move, before | After |
| --- | --- | --- |
| 200 rows, depth 3 | 20 | 15 |
| 2,000 rows, depth 3 | 20 | 15 |

The count is flat in the rows on both sides, because `stopsIn` already drew a collection as one stop.
What the phase changed is the two things the count does not see:

- **`stopsIn` ran twice per move.** `moveStop` asked once to decide whether it owned the stop and
  `walkStops` asked again to move; that is the 20 against 15, one whole subtree walk per key press.
- **Each visited node scanned the registries.** `groups.some`, `parents.find`, `containers.find` and
  an `isPanel` that walked the parent stops and allocated a fresh panel array for each — on a browse
  screen, about nine comparisons and one allocation per node visited, growing with the regions,
  strips and lists on screen. It is four hash lookups and no allocation now.

`apps/tui/src/keys/regions.test.ts` § a key press costs the depth of the tree holds both: the count
is under the bound, and the count at 2,000 rows equals the count at 200.

#### What the footer costs

The browse screen at 100 by 28, with `getActiveKeys` wrapped to count calls.

| | Before | After |
| --- | --- | --- |
| `activeKeyCacheBlockers`, screen idle | 12 | 0 |
| `activeKeyCacheBlockers`, after ordinary navigation | 48 | 0 |
| `getActiveKeys` calls across three keyboard-free redraws (two toasts and a resize) | 6 | 0 |
| `getActiveKeys` calls per focus change | 6 | 2 |

The blocker count is what the engine's own active-key cache turns on: `@opentui/keymap` 0.5.9 caches
only while it is zero, and it counts every layer, command or binding carrying a runtime matcher. It
grew with the controls on screen, because every bare key of every control carried
`active: () => !typing()`. Zero on both readings is the typing shadow and the command layer's
build-time filtering together; either one alone leaves it non-zero.

Two calls per focus change rather than one because both halves of the cache key move on a focus
change: the focused renderable, and the engine's `state` event. Six before, because the list was
rebuilt per render and each rebuild asked twice — once for the keys and once for the descriptions.

#### The diff pane at 5,000 lines

`ACORN_FIXTURE_PATCH_LINES=5000`, the `pr` pane at 80 by 24, counting every renderable under the
renderer's root — the whole screen, chrome included.

| | Renderables |
| --- | --- |
| Before | 5,303 |
| After | 376 |

`apps/tui/src/diffLong.test.tsx` § a five-thousand-line diff holds the bound at under 1,000, which is
the shape rather than the layout: what it forbids is a number that grows with the patch.

#### Not measured

- **A frame rate.** The phase's done-when line asks the diff pane to scroll at the rate the rail
  scrolls at. Nobody has watched either, here or anywhere in this programme: this machine's live
  instance holds port 4317 and a worktree cannot run the app. What is measured is the renderable
  count the frame rate follows from.
- **The rail's row rebuilds against a real `tasks:changed`.** The fixture has one task, so the
  property is held as a unit test of `keyedRows`
  (`apps/tui/src/chrome/chrome.test.tsx` § the rail keeps the rows a change did not touch) rather
  than as a count of destroyed renderables on a real refetch.
- **`markersFor`.** The sort is once per registry change rather than per row per render, and the
  registry is empty in the fixture, so there is nothing here to count.


### 2026-09-03 — phase 10, the re-measurement

Same machine, Node 24.11.0 (Node 26.8.1 for the terminal client). Every phase from 0 (`17b03dbe`) to
9 (`c11bcd29`) had shipped, and nothing else was in the tree.

Read this section for the programme's before-and-after and for the four things nobody had measured
before it. Where a number here disagrees with an earlier phase's, both are kept and the disagreement
is named, because a phase that decided on the old figure decided on the old figure.

#### The build artifacts, re-measured

`pnpm --filter @acorn/desktop build` and `pnpm --filter @acorn/tui build`, on the tree at `c11bcd29`.

| | Before the programme | The phase that took it | Now |
| --- | --- | --- | --- |
| Desktop startup scripts | 1,329,679 B | 627,146 B (phase 2) | **631,512 B** |
| Desktop startup assets | 148 | 43 (phase 2) | **44** |
| Desktop preload depth | 4 | 3 (phase 2) | **3** |
| Desktop styles | 92,153 B | 91,569 B (phase 2) | 91,599 B |
| Terminal client's eager closure | 1,114,282 B in 110 chunks | 841,142 B in 91 (phase 4) | **857,233 B in 95** |
| Terminal client's whole build | 2,100,437 B | 2,122,669 B (phase 4) | 2,148,414 B |
| The node's one service chunk | 1,093,602 B | 1,099,402 B (phase 3) | 1,110,974 B |

**Everything is inside its ceiling and everything has drifted the wrong way since the phase that took
it.** The desktop is 4,366 B and one request over phase 2's figure, the terminal client 16,091 B and
four chunks over phase 4's with 12,767 B of headroom left under the 870,000 B ceiling, and the service
chunk 11,572 B over phase 3's. None of it is a regression anyone would notice and all of it is the
same drift the denylist exists for: five phases of ordinary work each added a few kilobytes to the
first paint. The check that catches a 300 KB mistake does not catch this, and it is not meant to.

The desktop's uncounted tail grew too: 120 chunks and 1,595,686 B are one dynamic import away, against
109 chunks and 1,509,975 B after phase 1. That number is reported and not gated, for the reason phase 0
gave.

#### The node's boot, end to end, with a fresh data root

`npx vitest run test/boot.test.ts` from `apps/desktop`, which spawns the real helper under the pinned
runtime with `ACORN_PERF=1` and hands it the staged `service.js`. One launch, a fresh root, eleven
bundled plugins and no loaded ones.

| `[helper:boot]` | Offset | | `[service:boot]` | Its own clock |
| --- | --- | --- | --- | --- |
| `handshake` | +33 ms | | `login-shell` | 0 ms |
| `plugin-cache sweep` | +34 ms | | `bundled-packages` | 11 ms |
| `bundled plugins trusted` | +34 ms | | `migrate` | 91 ms |
| `ws bound` | +41 ms | | `graph` | 1 ms |
| **`ready line`** | **+44 ms** | | the whole `init` pass | 24 ms |
| `service.start` | +689 ms | | `cert` | 1 ms |
| `node adopted` | +701 ms | | `bind` | 19 ms |
| | | | **`listener-up`** | **154 ms** |

**The window opens 645 ms before the node is listening**, and phase 2's ordering holds: `ws bound`
before `ready line` before `service.start` before `node adopted`. Phase 2 measured the same gap at 601
to 747 ms against the real 16-plugin root, so the gap has not moved. What moved is what fills it.

Two figures worth putting beside their originals:

- **`migrate` is 91 ms on a first-ever boot**, where phase 0 measured 220 ms on an empty root under
  `tsx` and phase 3 measured 29 ms warm on the real root. The first-boot cost is the migration chains
  themselves and nothing else now that phase 3 took `diskBlobCache`'s `chmod` sweep out of the step.
- **The `init` pass is 24 ms**, `agents` being all of it, which is exactly what phase 3 measured warm.
  The 46 ms phase 0 recorded was the realistic root with five loaded plugins in it.

The same launch with `isPackaged: true`, which is the flag that turns the login-shell `PATH` probe on:

| | Value |
| --- | --- |
| `login-shell` | **2 ms** |
| `migrate` | 76 ms |
| `graph` | 2 ms |
| `bind` | 15 ms |
| **total to `listener-up`** | **121 ms** |

**Phase 3's headline holds.** The probe measured 569 ms on this machine before phase 3 moved it behind
the boot, and it is 2 ms on the path now. The 209 ms phase 3 recorded for a packaged boot was against
the realistic sixteen-plugin root; 121 ms here is the same shape against a fresh one.

The gap the node's own account cannot see is **535 ms** here (helper +689 against the node's +154),
where phase 2 measured 449 ms and phase 3 split it into 23 ms of `fork` plus 293 ms of bundle
evaluation plus about 133 ms of the helper's own work. The section below re-measures the middle term at
about 350 ms, which makes 23 + 350 + 160 and lands on the 535 ms measured end to end. Two independent
measurements agreeing is the reason to believe the larger figure.

#### The service bundle's evaluation: 351 ms, not 293 ms, and the difference is the machine

`node-aarch64-apple-darwin`, the runtime the desktop ships, importing the chunk in a fresh process
seven times. **Both chunks were measured today**, which is the control that matters: the older one is
the exact artifact phase 3 measured.

| Chunk | Bytes | Median of seven | Range |
| --- | --- | --- | --- |
| `coreTools-B7AABCpy.js`, the one phase 3 measured at **293 ms** | 1,099,402 B | **351.6 ms** | 340.4 to 467.1 ms |
| `coreTools-CxFs0y90.js`, the tree at `c11bcd29` | 1,110,974 B | **353.1 ms** | 347.9 to 361.9 ms |

So the 11,572 B this programme's later phases added costs about 1.5 ms, and the 58 ms between phase 3's
figure and this one is measurement conditions rather than code. Phase 3 timed the child's own marks
across seven forks; this is a dynamic import from a bare process, which carries Node's bootstrap and
the loader's resolution with it. Anyone quoting a number for this should quote 350 ms and say which
runtime it was.

Timing each external import in one process, in the same order phase 3 used, gives the same shape at
about 1.7 times the magnitude: `drizzle-orm` 158.6 ms, `drizzle-orm/sqlite-core` 105.2 ms,
`@agentclientprotocol/sdk` 60.4 ms, `ws` 22.7 ms, `@hono/node-server` 21.6 ms, `jose` 20.5 ms, `hono`
10.0 ms, `smol-toml` 6.1 ms, `node-pty` 4.4 ms, the drizzle migrator 3.2 ms, `@vscode/ripgrep` 1.4 ms,
`zod` 1.2 ms warm, `node:sqlite` 0.2 ms. The bundle's own chunk with all of them warm is 73 to 132 ms,
against phase 3's 51 ms. The uniform factor across twelve unrelated packages says the machine, not the
tree.

**Nothing in this changes phase 3's conclusion.** External libraries are still the large majority,
`drizzle-orm` and its `sqlite-core` are still a third of the whole on their own, and per-plugin chunks
would still evaluate all of acorn's own modules on every boot.

#### The request log and the histograms, read for the first time

Five phases wrote "not measured" against phase 0's `ACORN_PERF=1` output, all for the same reason: it
needs a node serving real traffic, and this machine's live instance held port 4317 and the data root's
lock. It does not any more, so here it is.

Not the packaged shell, and not a person driving it. A standalone node under `tsx` with `ACORN_PERF=1`,
against a **fresh scratch data root** with the eleven bundled plugins, and a scratch git repository of
eight files with four git-branch tasks in it, each with a real worktree materialised through
`GET /v2/p/editor/tasks/:id/editor/root` and one dirty file. Driven over pinned HTTPS with the device
token the handshake line prints. Fifteen rounds two seconds apart; each round is two concurrent
clients, and each client asks for the rail's statuses, the task list, and one task's local changes,
which is what a desktop window with a changes pane open does on a status ping.

Ninety-one requests, and `kill -USR2` for the histograms:

| Seam | Count | Mean | p50 | p95 | Max |
| --- | --- | --- | --- | --- | --- |
| `git status` | **60** | 21.8 ms | 20.5 ms | 35.2 ms | 36.1 ms |
| `git diff` | **60** | 18.4 ms | 17.8 ms | 28.0 ms | 29.6 ms |
| every SQLite statement together | **183** | 0.02 ms | 0.0 ms | 0.0 ms | **0.1 ms** |

| Route | Requests | Mean | Max |
| --- | --- | --- | --- |
| `GET /v2/core/task-statuses` | 30 | 19.8 ms | 36.8 ms |
| `GET /v2/p/changes/tasks/:id/local/changes` | 30 | 20.3 ms | 30.8 ms |
| `GET /v2/core/tasks` | 31 | **0.7 ms** | 1.5 ms |

Four things fall out of that, and three of them are phase 5's done-when lines answered through the
instrument phase 5 asked for rather than at the seam:

1. **Sixty `git status` spawns is four per round: one per worktree per two-second window.** Two clients
   asking thirty times produced the same count one client would have. Phase 5's line was "one status
   ping spawns at most one `git status` per worktree per TTL window, however many clients are
   connected", and this is that line, measured.
2. **Sixty `git diff` spawns for one worktree.** The changes pane's `--numstat` pair is not coalesced,
   so it is two processes per client per ping, and two clients on one task cost as much as the rail
   costs for four. Phase 5 named this residue and did not fix it; the number says it is now the larger
   half of the git bill on any client with a changes pane open.
3. **The task list is 0.7 ms.** Phase 5 took it from 26 queries to 3 for 24 tasks, and this is what
   that is worth at the request seam: the route every client refetches on `tasks:changed` costs less
   than a millisecond.
4. **SQLite is not where the node's time goes.** Every statement in the whole run, boot excluded,
   totals 3.4 ms, and the slowest single one is 0.1 ms. The programme refused splitting the node into
   threads and asked for these numbers instead; they say the synchronous database is not the thing to
   split away from.

**Warm-token auth: zero reads, exactly.** A hundred `GET /v2/core/prefs` with one device token, in one
minute:

| | Value |
| --- | --- |
| Reads of the `devices` row | **1** |
| The route's own `prefs` reads | 100 |
| Request duration | mean **0.12 ms**, p50 0.10 ms, p95 0.20 ms, max 0.80 ms |

That is phase 5's `ACORN_PERF` line — "zero SQLite reads in auth on a warm token" — read off the
histogram rather than counted at the seam. The 0.12 ms is also the first honest figure for what the
node's own request overhead is when the route does almost nothing.

#### The transcript projection, and why it does not become incremental

Phase 7 left the incremental projection to phase 10 and named the number to argue from: 0.85 ms per
rebuild at full size. Re-measured against the same session out of a read-only copy of this machine's
`agents.sqlite`, session `72f744c0-abff-49b6-a84f-4077989ce7bf`, 2,727 rows and 1,850 after the usage
fold the node now does. Median of 50 runs after a warm-up.

| Rows | Items projected | Median rebuild | Per row |
| --- | --- | --- | --- |
| 500 | 137 | 0.182 ms | 0.36 µs |
| 1,000 | 287 | 0.333 ms | 0.33 µs |
| **1,850, the largest real session** | 522 | **0.61 ms** | 0.33 µs |
| 7,400, that session four times over | 2,088 | 4.73 ms | 0.64 µs |

**It is linear, and it is 0.61 ms rather than phase 7's 0.85 ms.** Both are the same quantity measured
the same way on the same data, so treat 0.85 ms as the top of the range and 0.6 ms as the middle of it.
At about 25 events a second, the largest session in a 66,264-event database costs 15 ms of main thread
per second of streaming, and one rebuild is a twenty-seventh of a frame. A session would have to reach
roughly 25,000 events before a rebuild filled a frame, and the whole database's largest is 2,727.

The event mix in that session is worth recording because it is not the mix § What was decided describes:
`tool` 1,682, `usage` 881, `assistant_message` 137, everything else 27. Folding usage is what takes
2,727 to 1,850; the 1,682 `tool` rows are already collapsed at render time and folding them at the
source would take it to about 700.

#### The tree host's remove, which was the one argument the numbers took up

`packages/client-core/src/host/tree/treeState.ts`'s pre-flight simulated a batch against a copy of the
parent map, and for each `remove` it scanned every live node and walked its ancestors. Measured against
a synthetic loaded-plugin tree, before and after making it a walk down a child index:

| Tree | Removes in one batch | Before | After |
| --- | --- | --- | --- |
| 1,000 nodes | 100 | 18.4 ms | **2.3 ms** |
| 1,000 nodes | 500 | 57.2 ms | **6.1 ms** |
| 4,500 nodes | 100 | 62.0 ms | **2.9 ms** |
| 4,500 nodes | 1,000 | 488.4 ms | **19.9 ms** |
| 4,500 nodes, near the 5,000 cap | 4,000, the batch cap | **1,103.9 ms** | **71.4 ms** |

**A batch that emptied a tree at the node cap blocked the main thread for 1.1 seconds.** That is what
the deferred argument was waiting to see, and it is 15 to 24 times cheaper now. The insert side is
unchanged at 24 to 28 ms for 4,508 inserts across four batches.

The same walk had a correctness bug that the rewrite ends. The old loop iterated a snapshot of the
projection while deleting from it, so a grandchild whose parent the same loop had already deleted
walked up into a hole, stopped, and survived in the projection. A later op in the same batch addressing
that grandchild was then accepted, which is exactly the sandbox-and-host disagreement the pass exists
to catch. `treeState.test.ts` holds both halves: the refusal, and a bound on the batch.

The residue, named because it is now the larger half: applying the batch takes 71.4 ms because
`detach` filters the parent's children array once per `remove`, which is quadratic in the siblings.
Fixing that means keeping an index of the live children too, and nothing has measured a real plugin
tree that removes thousands of siblings at once.

#### The persisted query cache, weighed after months of use

Phase 0's read said to measure the blob before deciding between per-key persistence and a shorter
throttle. The desktop persists through `idb-keyval` into the webview's IndexedDB, so the blob is a row
in `~/Library/WebKit/acorn-desktop/WebsiteData/Default/*/IndexedDB/*/IndexedDB.sqlite3`. Read from a
copy of this developer's real store.

| | Value |
| --- | --- |
| The row as IndexedDB stores it, UTF-16 | **2,194,679 B** |
| The same blob as JSON | **1,097,335 characters** |
| Queries in it | 81 |
| Mutations in it | 0 |
| The largest single entry | 163,159 B, `["plugin-chrome","rollbar","rollbar-items",…]` |
| The next five | pull-request entries, 38 KB to 65 KB each |
| `JSON.stringify` of the whole thing | **2.4 ms** median |
| `JSON.parse` of it on restore | 2.0 ms |

**A megabyte, and 2.4 ms once per five-second window.** Eighty-one queries holding a megabyte also says
the exclusions in `queryPersistence.ts` are doing their job: no patch bodies and no blobs are in it.

#### The suites

| Command | Result |
| --- | --- |
| `PATH=~/.nvm/versions/node/v26.8.1/bin:$PATH npx vitest run` in `apps/tui` | 34 files, **318 tests, 0 skipped**, 203 s |
| `pnpm --filter @acorn/desktop test` | 14 files, 91 tests, plus 30 Rust tests |

#### What is still not measured, and what each one needs

- **`first paint` in a packaged build.** Still unread. It is a `requestAnimationFrame` callback and
  macOS pauses those while the window is occluded, so it needs someone at the machine with the window
  frontmost. What this phase did instead is add `[renderer:boot] tree built`, which fires when `render`
  returns and therefore fires in a background window, so a launch watched from a terminal now has a
  mark for the end of the renderer's own work. The paint mark stays for whoever can watch it.
- **A `pnpm dist` bundle launched from Finder.** The packaged-flag boot above is the real helper and
  the real staged bundle under the pinned runtime, but it is still a test harness rather than an
  installed app, and the renderer is not in it at all.
- **A person's session.** No agent has streamed, no build has spewed through a terminal, and no task
  has been switched with every pane open, through the packaged shell with these ten phases in. The
  request log above is a script's traffic against a scratch root: real subprocesses, a real database
  and real routes, but not a real day. `docs/testing.md`'s smoke checklist is what covers that, by
  hand.
- **A multi-node fleet.** Nothing here says what a second and third node's broadcast volume looks
  like, which is the exit condition the interest model on `/v2/events` still waits on.
- **Memory, anywhere.** An xterm per open tab, the editor's document pool, the highlight cache, a third
  fewer event objects per session: four phases traded memory for time and none of them weighed it.
- **The immutable-asset saving.** A dev build serves `no-store` by design, so it needs `pnpm dist` and
  a second launch.
