# What was measured this time

[Back to performance](../performance.md)

## Performance: the decisions, the refusals, and the numbers

The record of the performance programme that ran from 2026-08-31 to 2026-09-03: eleven phases across
the desktop renderer, the terminal client, and the node. Behaviour lives in the owning docs, listed
below. This file holds the three things that have no other owner — what was decided about the shape of
the system, what was refused and on what exit condition, and every number the programme measured.

Read it the way you read [loaded-plugin-migration.md](../loaded-plugin-migration.md): a dated record
rather than a description of how the app works today. Where it disagrees with an owning doc, the owning
doc wins.

The programme's working papers — three reads of the app, an order of work, and eleven phase files —
lived in `docs/future/performance/` while it ran and were deleted when it closed. `git log` has them.

## Where each behaviour lives now

| What shipped | The doc that owns it |
| --- | --- |
| The icon split, and why an unmatched icon name still renders as itself | [ui-design.md](../ui-design.md) § Icons |
| The renderer's startup budget and its denylist | [frontend.md](../frontend.md) § Startup budget |
| The window opening before the node, and what the shell draws meanwhile | [frontend.md](../frontend.md) § Painting before the node, [shell.md](../shell.md) § The shell process |
| Boot marks, the request line, and the git and SQLite histograms | [local-development.md](../local-development.md) § Timing a cold start |
| The collector those histograms fold into, and the record model behind them | [telemetry.md](../telemetry.md) |
| The node's boot order, and the login-shell probe leaving it | [node-distribution.md](../node-distribution.md) § Boot order |
| Concurrent plugin `init`, and what a plugin may assume about its neighbours | [plugins.md](../plugins.md) § Activation |
| Bundled-plugin trust and the idempotent cache writes | [security.md](../security.md) § Third-party plugin bundles |
| Loaders in the kit's node table, and the tree contract's batch rules | [plugins.md](../plugins.md) § The tree contract |
| One grammar per file opened, and the editor's round trip to text | [editor.md](../editor.md) |
| The terminal client's host switch, attach-or-start, focus regions, key groups, viewports and footer | [tui.md](../tui.md) |
| One query client per node, and the file-backed cache the terminal client persists to | [caching.md](../caching.md) § Renderer query cache |
| Events that name what changed, and the WebSocket's shed marker | [api-reference.md](../api-reference.md) § WebSocket, [plugins.md](../plugins.md) § Hearing a core event |
| Coalesced worktree status reads, and the guard that still reads fresh | [workspaces-and-tasks.md](../workspaces-and-tasks.md) § Worktree status reads |
| Device-token caching and the transport's auth | [security.md](../security.md) § Transport and auth |
| The emulator that runs only while watched, the ring, and the binary `term:out` frame | [terminal.md](../terminal.md) § The screen, and who pays for it, [shell.md](../shell.md) § The renderer bridge |
| The transcript store, the usage fold, and the markdown that redraws its open block | [managed-agents.md](../managed-agents.md) § The transcript store, [ui-design.md](../ui-design.md) § How the kit is built |
| Pane models, hover prefetch, and the deletion of `keepAlive` | [panes.md](../panes.md) |
| Per-path diff hydration | [diff-rendering.md](../diff-rendering.md) § Parsing and highlighting |
| The node's one async-local store, and what reads it | [telemetry.md](../telemetry.md) § Ambient attribution |

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

## What was measured this time

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


## The seven decisions

### 1. The process topology stays

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

### 2. Every host draws first, then connects, then fills

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

### 3. Registries hold loaders, not values

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

### 4. The node owns freshness and coalescing

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

### 5. Streaming surfaces render incrementally

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

### 6. One query client per node, on every host

The desktop has one `QueryClient` and one persister per node, built by
`packages/client-core/src/infra/node/fleet.ts`, and every invalidation watcher writes into it. The
terminal client mints its own `QueryClient` in `apps/tui/src/App.tsx` with the comment "No
persister", renders the whole shell under it, and never calls `persistQueryClient`. So the client
that `watchTaskChanges` invalidates is not the client the shell reads, and every `acorn` start is
cold even though `apps/tui/src/node/cache.ts` installs a file-backed storage for a cache nobody
writes.

The decision is that the terminal client renders under `clientFor(nodeId).client` and persists it
through the storage it already installed. One client per node is the contract
[caching.md](../caching.md) § Renderer query cache states; the terminal client is the host
that did not keep it. Phase 4 carries it.

### 7. The terminal client's key path is indexed, not scanned

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
held to the five rules in [tui.md](../tui.md) § Keys and focus: no new settle step, no second
keymap.

## Corrections to the first reads

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

## What the phases found wrong with these seven

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

## Row patching instead of coarse `<noun>:changed` invalidation

The content-free event with a whole-route refetch is a deliberate design: a payload is a second
projection to keep in step, and `watchConnectionChanges` documents a concrete case where a patch
would leave the rest of the projection stale (the list route synthesizes rows the event cannot
carry). The observed pain is not the coarseness, it is the `term:status` amplifier, which phase 2
fixes without touching the model. Revisit only if instrumented refetch volume stays high after that.

## A general topic or subscription model on `/v2/events`

The event admission rule in `docs/plugins/forward-compatibility.md` records the broadcast ceiling
knowingly. A per-connection interest registry
is real machinery with its own failure modes, and the two concrete costs found in the trace, the
`term:status` fan-out and the helper forwarding non-active nodes, are both fixable at their source
in phase 2. The model stays refused until a measurement on a real multi-node fleet demands it.

**Both source fixes shipped and the exit condition is untouched, 2026-09-03.** Phase 5 split
`term:status` and filtered non-active nodes at the helper, and phase 10 confirmed at the request seam
that a second client adds no work to a status ping (§ 2026-09-03 — phase 10). What
nobody has is the measurement this entry asks for: every number in the programme was taken against one
node, so the broadcast volume of a real two- or three-node fleet is unknown. The exit condition stands
exactly as written, and it needs a second machine rather than a second reading.

## Splitting the node into worker threads or multiple processes

The single loop carries synchronous SQLite, terminal emulation, and git spawns, and no measurement
says any of them is the problem. Phase 3 removes the largest unconditional load (emulating unwatched
sessions) and phase 0 adds the histograms that would justify a split. Process architecture is a
one-way door; do not walk through it on a structural argument.

## Dropping unreferenced icons at build time

68 of 1,756 names appear as literals in the tree, but a user can assign any icon to a task and a
plugin manifest can name any one, and both choices are persisted. A build-time census breaks stored
data. The split in phase 0 (eager 68, lazy rest) gets the bytes without the breakage.

## Rebuilding the transcript virtualizer

Removed on purpose: `measure()` churn made output flash and become unselectable, and
`docs/managed-agents.md` owns that record. The rebuild-everything projection is what made it
thrash, so phase 4's fixes come first, and any revisit starts by reading the removal commit.

## Single-theme diff tokens

Every token carries `light` and `dark` so a theme switch costs nothing. That is roughly double the
token memory a large diff needs, and it stays that way until a real diff's memory is the complaint,
because the switch being free is a property people notice.

## Replacing base64 on the helper wire ahead of a measurement

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

## Scrollback beyond the ring after phase 3

Gating the headless emulator on attached sinks means a cold attach rebuilds the screen from the
256 KB raw ring, so history older than the ring is gone and an alternate-screen app whose state
depends on older bytes redraws from its next output. That is the accepted price for not running a
parser per session forever. If a session class appears where full history matters, the answer is a
bigger ring for that class, not a return to always-on emulation.

**Taken, 2026-09-03.** The gating shipped as phase 6, not phase 3, and the price is paid as written.
What the numbers say about the trade: a megabyte of a build's output through an unwatched session is
2.8 ms instead of 492 ms, and the rebuild a cold attach pays instead is 20 ms, once per tab
(§ 2026-09-03 — phase 6). The behaviour is now stated for a reader in
[terminal.md](../terminal.md) § The screen, and who pays for it, and nobody has yet watched what
losing older bytes looks like for a real agent TUI after a long build.

## Added 2026-09-02

### Collapsing the process topology, or holding the token in the renderer

The desktop's three processes cost one serialisation per hop, and the second read counted the hops
exactly: renderer to helper over a loopback WebSocket, helper to node over pinned HTTPS. Moving a
boundary would remove one JSON hop and would put the device bearer or the certificate pin somewhere
the trust model says it cannot go (`docs/security.md` § Trust boundaries). WKWebView cannot pin a
self-signed certificate, so a renderer-to-node path would need a CA the shell installs, which is a
larger change to the machine than to the app. Binary frames on the existing hops (phase 6) buy the
measurable part.

### A filesystem watcher for worktree status

There is none, and phase 5 does not add one. A watcher per worktree is a handle per directory on
Linux without recursive `fs.watch`, a stream of events that need debouncing into the same coalesced
read phase 5 builds anyway, and a second source of truth about "dirty" beside git's. The two-second
cache with in-flight dedup gets the amplification down from processes per client per ping to one per
worktree per window, and the node's own writes invalidate it. Exit condition: a measured case where a
change made outside acorn (an editor, a shell) has to appear in under two seconds without a ping, and
the ping cannot be made to happen.

### `Rows` virtual by default, on either host

On the desktop, virtual rows need a fixed row height (`--row-h-virt`), and most lists have rows of
varying height; 25 of 27 call sites would render wrong. In cells, `virtual` swaps the box's flex so
the list grows into its panel, and a short list would stretch to fill space its rows do not need
(`apps/tui/src/kit/showing.tsx`). Both hosts opt in at the long-list sites instead (phase 9 names
them for the terminal client). The default stays a decision per list.

### A second query client in the terminal client

`apps/tui/src/App.tsx` mints its own `QueryClient` beside the per-node one client-core builds, so the
shell reads a client nobody invalidates and nothing persists. That is a bug against the caching
contract, not a design. Phase 4 removes the second client; nothing may add another on any host.

### A terminal-specific keymap

Phase 9 replaces runtime matchers with a layer that comes and goes, because that is what
`@opentui/keymap` caches around. It does not add a second engine or a second binding table. The
rule is `docs/tui.md` § What must never happen.

### Dropping the tree host's whole-batch pre-flight

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

### A 503-until-ready node contract

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
