# Performance: refused

What this programme decided not to do, and why, so a later session argues with the reasoning rather
than with silence. Dated 2026-08-31 with the rest of the folder.

## Row patching instead of coarse `<noun>:changed` invalidation

The content-free event with a whole-route refetch is a deliberate design: a payload is a second
projection to keep in step, and `watchConnectionChanges` documents a concrete case where a patch
would leave the rest of the projection stale (the list route synthesizes rows the event cannot
carry). The observed pain is not the coarseness, it is the `term:status` amplifier, which phase 2
fixes without touching the model. Revisit only if instrumented refetch volume stays high after that.

## A general topic or subscription model on `/v2/events`

`docs/future/events.md` records the broadcast ceiling knowingly. A per-connection interest registry
is real machinery with its own failure modes, and the two concrete costs found in the trace, the
`term:status` fan-out and the helper forwarding non-active nodes, are both fixable at their source
in phase 2. The model stays refused until a measurement on a real multi-node fleet demands it.

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

## Scrollback beyond the ring after phase 3

Gating the headless emulator on attached sinks means a cold attach rebuilds the screen from the
256 KB raw ring, so history older than the ring is gone and an alternate-screen app whose state
depends on older bytes redraws from its next output. That is the accepted price for not running a
parser per session forever. If a session class appears where full history matters, the answer is a
bigger ring for that class, not a return to always-on emulation.

**Taken, 2026-09-03.** The gating shipped as phase 6, not phase 3, and the price is paid as written.
What the numbers say about the trade: a megabyte of a build's output through an unwatched session is
2.8 ms instead of 492 ms, and the rebuild a cold attach pays instead is 20 ms, once per tab
(measurements.md § 2026-09-03 — phase 6). The behaviour is now stated for a reader in
[docs/terminal.md](../../terminal.md) § The screen, and who pays for it, and nobody has yet watched what
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

### A 503-until-ready node contract

Phase 3's gated half binds the listener before plugin init and answers plugin routes with
`plugin_starting` until their plugin is ready. It is a wire contract every client and the MCP child
would honour forever. It shipped only if the phase 0 breakdown showed plugin init dominating the boot
after concurrency, taken as over 300 ms.

**Refused on the numbers, 2026-09-02.** Phase 0 measured it: every plugin's `init` together is 46 ms on
a first boot against a realistic data root and 24 ms warm, and no plugin declares a `ready` at all, so
that pass is free (measurements.md § The node's boot breakdown). Binding the listener before plugin init
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
measurements.md § 2026-09-03 — phase 2 rather than from the `tsx` figure. The plugin passes are still
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

## Added 2026-09-03

### Splitting the node service bundle into per-plugin chunks

Phase 3's scope and phase 10's deferred list both said to split the one 1,099,400 B service chunk into
per-plugin dynamic imports if its evaluation time came in over 100 ms. It is 293 ms, and the split is
refused anyway, because the measurement says the bytes are not where the time is: 51 ms of the 293 ms
is the bundle's own modules and 242 ms is external libraries the chunk does not contain
(measurements.md § 2026-09-03 — phase 3). Every plugin in `nodePlugins()` has its `init` called on
every boot, so per-plugin chunks would evaluate all 51 ms of it anyway, in 16 pieces instead of one.

`drizzle-orm` is 161 ms of the 242 ms and cannot be narrowed: the root barrel is 92 ms, `sqlite-core`
alone is 155 ms, and both together are 161 ms, so moving 99 files off the root barrel would save about
6 ms. Exit condition: a real change to what the node needs before it binds, such as the node no longer
building its schema at boot. Two smaller candidates are recorded with their sizes in measurements.md
rather than refused: `@agentclientprotocol/sdk` at 25 ms and `jose` at 10 ms, both statically imported
for work that happens long after the listener is up.

### A journal check in front of drizzle's `migrate`

Phase 3's scope said to write this down if the ten SQLite opens turned out to cost more than
milliseconds each. They do not. `core.sqlite` opens and migrates in 7 ms and the nine plugin files cost
23 ms together, warm, including the 159 MB `agents.sqlite`. `migrate` against an up-to-date journal is
one `SELECT` against `__drizzle_migrations`, which is what it measures. Nobody should add a check that
guards a `SELECT` with a file read.

The 111 ms the `migrate` boot label used to report was `diskBlobCache` sweeping 2,975 files with a
`chmod` each, inside the same step. That is fixed in `packages/node-core/src/server/bindings.ts` and
the step is 29 ms.

### `keepAlive: 'dom'` on the pane contract

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

### A per-file row model for the diff

Phase 8's done-when line asked for one list re-render while a 200-file diff hydrates. It got 102, down
from 226, and 102 is the floor for what is there: `buildRenderableRows` builds one array over every
file, so a file arriving rebuilds it. Going lower means a row model per file with the virtualizer
reading a concatenation, which is a redesign of the most carefully tuned surface in the app — the
sticky header, the split bands, the find pass and the measure scheduling all read that one array — and
phase 8's own scope refuses restructuring anything in the diff beyond the two quadratic costs. Exit
condition: a profile of a real large pull request that puts `buildRenderableRows` above the tokenizer,
rather than an argument from the count.

### `virtual` opted in at the long-list sites in cells

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
renderables to 376 at five thousand lines (measurements.md § 2026-09-03 — phase 9). Exit condition
for revisiting the five: a list whose own panel bounds its height, on a host where the prop can be set
without deciding for the other one — which means either a terminal-only prop on the shared node, or a
measurement on the desktop saying its rows are uniform enough for the virtualiser.

