# Performance: the decisions

Decided 2026-09-02, after a second read of the app that covered the terminal client and re-traced the
desktop paths the first two reads argued from. [analysis.md](./analysis.md) and
[architecture.md](./architecture.md) are the first reads; [tui-analysis.md](./tui-analysis.md) is the
terminal client's. This file is the answer to the question those reads raised and did not settle:
which foundations stay, and which change. Each phase file under this folder names the decision it
serves, and [refused.md](./refused.md) holds the alternatives so nobody re-argues them from silence.

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

Refused for now: a filesystem watcher. The exit condition is written in refused.md.

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
[docs/caching.md](../../caching.md) § Renderer query cache states; the terminal client is the host
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
held to the five rules in [docs/tui.md](../../tui.md) § Keys and focus: no new settle step, no second
keymap.

## Corrections to the first reads

The dated reads stay as written, with one pointer line each to this section.

- **Rust never sees a request body.** analysis.md § 11 counts two JSON hops through Rust and asks
  whether Rust re-parses the payload. It does not. `apps/desktop/src/shell/bridge.ts` opens a
  loopback `ws://` straight to the helper after one `invoke('helper_endpoint')` to learn the port and
  secret, and `apps/desktop/src-tauri/src/lib.rs` registers no node-fetch command. The path is
  renderer to helper over that socket, helper to node over pinned HTTPS. Two JSON hops, two base64
  round trips, and one Zod parse of the whole decoded request in the helper.
- **`bumpChrome` already takes a plugin id.** architecture.md § 4 says it has none.
  `packages/client-core/src/host/chrome/chromeData.ts` declares `bumpChrome(pluginId?: string)` with
  a per-plugin revision map behind it. The one caller passing nothing is the `wsOnStatus` line above
  it, so the phase 5 fix is one argument at one call site.
- **The `term:status` consumer list is six.** architecture.md § 4 names five. The sixth is
  `plugins/github/src/client/pullDetail/prTabs.ts`, which invalidates two pull-request keys per ping.
- **The node has a boot timer.** analysis.md says four `console.log` marks.
  `apps/node/src/composition/runtime.ts` has `bootTimer()`, which prints `[service:boot] <label>
  +<ms>ms` for migrate, install, listener-up, and each reconcile step, unconditionally. Phase 0
  extends its labels rather than adding a second timer.
- **Reconciliation is already off the critical path.** architecture.md § 1 implies the window waits
  on it. `runtime.ts` returns `started` after `listening`, and the tmux, worktree, workflow, and
  agent reconcile steps run behind that.
- **Reconnect refetches active queries only.** architecture.md § 2 says the client invalidates the
  node's entire cache on reconnect. `apps/desktop/src/client/index.tsx` passes
  `refetchType: 'active'`, which bounds the refetch to mounted queries. The framebuffer replay per
  live session still happens.

## Verify before building

- The seven measurements above were taken at `17a9acdf` on 2026-09-02. Rebuild and re-measure before
  quoting any of them in a phase's done-when line.
- The agents database numbers come from one developer's machine. A session with 2,700 events is
  typical here and may not be elsewhere; profile against a real long session before sizing phase 7.
- Decision 4's removal-guard constraint depends on `worktreeDirty` still guarding removal in
  `worktrees.ts`. Confirm before adding the cache.
- Decision 6 depends on `clientFor(nodeId)` in `fleet.ts` still building a persister per node and on
  `setCacheStorage` still being the storage seam. Confirm both.
