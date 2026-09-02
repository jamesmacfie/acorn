# Performance: the architecture read

Analysis, 2026-08-31, the same day as [analysis.md](./analysis.md) and one level above it. That file
reads surfaces; this one reads shapes. It comes from tracing four paths end to end in source: the
desktop cold start across all three processes, the terminal byte path from PTY to glyph, the event
fan-out from the node's WebSocket to the query cache, and what a task or tab switch actually costs.
Five shapes came out wrong. [phases.md](./phases.md) holds the order; [refused.md](./refused.md)
holds the shapes that looked wrong and are not.

Nothing here was profiled. Every claim is read from source with the path beside it, and the standing
rule from the first read applies: instrument before arguing about anything that needs a number.

## 1. The window waits for a complete node boot, three processes deep

The cold start is one serial chain before a single pixel. The Rust shell calls `boot()` synchronously
and blocks its main thread on the helper's ready line (`apps/desktop/src-tauri/src/lib.rs`,
`helper.rs`, a 90-second timeout). The helper does not print ready until it has re-hashed and
rewritten about 2.4 MB of bundled plugin bundles
(`packages/custody/src/plugins/bundledPluginTrust.ts`), spawned the node, and waited out the node's
entire boot: the login-shell PATH probe, SQLite migrations, a strictly serial init pass over eleven
or more plugins each opening its own database (`packages/node-core/src/server/pluginHost/host.ts`),
cert generation, and the TLS bind. Only then does the window open. The renderer then fetches 141
module scripts and awaits two more node round trips before `render()`, and the shell still gates on
`nodeReady()` behind that.

What makes this wrong rather than merely slow is that every piece of the fix already exists. The
fleet list is `fleet.json` on the helper's disk, not a node answer. The plugin roster read is
failure-tolerant on purpose (`packages/client-core/src/infra/node/nodePlugins.ts`). The renderer
already handles a node arriving late: `node-status` pushes and the `node-replaced` reload are wired
(`apps/desktop/src/shell/bridge.ts`), and the persisted query cache with its `isRestoring` gate is
in place. `apps/desktop/src/client/activate.ts` argues in its own comment that registering plugins
and correcting later beats waiting, and then `index.tsx` awaits the node anyway.

The change: the helper binds its WebSocket server and prints ready before the node spawn, the window
opens immediately, the shell paints from the persisted cache, and the node arrives as a status push.
The one real coupling to break is that the cache partition key is derived from the fleet answer
(`packages/client-core/src/infra/node/fleet.ts`), so the last-known node id has to be readable
synchronously in the renderer. Downstream of that, the work is deleting awaits, not building
machinery.

## 2. Backpressure is handled by amplifying load

There is no flow control on the terminal path, and the one guard that exists makes congestion worse.
The node's hub drops a frame when a socket buffers past 4 MB but increments `seq` anyway,
deliberately (`packages/node-core/src/server/transport/wsHub.ts`). The broker treats any `seq` gap
as loss and closes the socket (`packages/custody/src/broker/nodeBroker.ts`). Reconnect re-attaches
every live terminal, which forces a full 1,000-line framebuffer serialize per session on the node,
and the client answers the reconnect by invalidating the active node's entire query cache
(`apps/desktop/src/client/index.tsx`).

So a build that spews output overruns the buffer, and the system responds with a socket reset, a
framebuffer replay, and a whole-cache refetch, at the moment the node is busiest. Congestion control
that multiplies load under load is the wrong shape however rarely it fires. The fix is small: pause
the PTY while the sink is over its mark (`node-pty` supports it), and stop counting shed frames
against `seq`, or mark the drop so the broker can tell shed load from lost data.

## 3. The terminal pipeline does the expensive thing on the common path

The intent is sound: the node owns a canonical screen per PTY through an `@xterm/headless` emulator
so a client can reattach without replaying history (`plugins/terminal/src/server/terminalDisplay.ts`).
The implementation inverts the costs:

- The emulator runs at full rate for every session whether anyone is attached or not, and its only
  consumer is `attach()`. No agent reads it (agent-facing state comes from the raw ring) and no
  other client reads it. A background task's terminal pays continuous ANSI parsing to produce state
  that may never be read.
- The common operation, switching terminal tabs, hits the expensive path every time. The panel
  mounts only the active tab (`plugins/terminal/src/client/TerminalPanel.tsx`), so each switch
  destroys the xterm and its WebGL context, asks the node for a full 1,000-line serialize, ships it
  as one frame, and parses it into a fresh emulator. Same cost on every reload and every reconnect.
- Every live byte is parsed by two ANSI emulators (three under the TUI, whose OpenTUI cell buffer is
  a third parse), and JSON-escaped twice: once per attached connection on the node
  (`wsHub.ts` stringifies per socket) and again on the helper-to-renderer hop.
- On the same loop, the 256 KB raw ring is rebuilt by string concatenation on every PTY chunk
  (`plugins/terminal/src/server/terminal.ts`) to serve consumers that read at most the last 10 KB.

The wire itself is clean: `term:out` only flows to attached sockets, so background sessions cost
nothing on the network. The fix moves node-side cost from continuous to on-demand: gate the emulator
on `live.size > 0` and rebuild the screen at attach time by replaying the raw ring through a fresh
headless instance, accepting scrollback bounded by the ring; keep inactive terminal tabs mounted and
hidden so a switch is a toggle rather than a round trip; and put `term:out` on binary WebSocket
frames, the upgrade `apps/desktop/src/shell/wire.ts` already names.

## 4. Every client hears everything, and one ping refetches the world

Corrected 2026-09-02: `bumpChrome` already takes a plugin id, and the `term:status` consumer list is
six. See [decisions.md](./decisions.md) § Corrections to the first reads.

The node's `/v2/events` socket is a firehose. The only subscription primitive is `term:attach`;
everything else broadcasts to every connected client (`wsHub.ts`), and a plugin's frames reach every
socket whether any surface for them is mounted (`packages/node-core/src/server/pluginHost/context.ts`).
The helper forwards every paired node's frames across the process boundary, and the renderer drops
whatever is not the active node on arrival (`packages/client-core/src/infra/node/wsClient.ts`), so
an N-node fleet delivers N nodes' traffic to be discarded.

The amplification lands hardest on `term:status`: a content-free ping on every terminal idle-busy
edge, also emitted by task creates and worktree changes, which each client answers by refetching
every plugin's chrome descriptor through a global `bumpChrome()` with no plugin id
(`packages/client-core/src/host/chrome/chromeData.ts`), a git-status sweep over every active
worktree, the session list, GitHub's PR tabs, and the agents sidebar. One busy terminal makes every
connected client re-ask the node most of what it knows, repeatedly.

`docs/future/events.md` already records "frames reach every socket regardless" as a known ceiling,
so this is a deliberate deferral that the `term:status` amplification has caught up with. Splitting
that ping's consumers onto narrower events, giving `bumpChrome` a plugin id, and filtering non-active
nodes in the helper pays for itself before any general interest model exists; the per-connection
topic model stays refused until a measurement demands it.

## 5. Switching is remount-first with per-mount refetch, and the softeners are dead code

A task switch disposes the entire task scope (`apps/desktop/src/client/App.tsx`). Every pane
rebuilds, CodeMirror's per-file state pool is cleared with its pane
(`plugins/editor/src/client/EditorPane.tsx`), and the editor then makes three serial round trips
before text appears: root, then mount, then read. Maximizing a pane unmounts its siblings. A node
switch remounts the whole shell. The two mechanisms that would soften this exist as a dead field and
a pane-local map: `keepAlive` is declared on the pane contract, set by exactly one pane, and read by
nothing (`packages/client-core/src/host/registries/panes/panes.ts`), and the CodeMirror pool does
not survive its pane.

Remount-first is defensible. It matches the codebase's stance of persisting state as data rather
than DOM (`packages/client-core/src/features/editor/viewState.ts` is the pattern), and it keeps pane contributions
simple. But then the data layer has to make a remount cheap, and it does not: nothing prefetches on
rail hover (GitHub's PR list is the only prefetcher in the app), the editor waterfall is serial when
root and content could be parallel or one request, and switching back to a task left two seconds ago
refetches what the cache already holds. Either wire `keepAlive: 'dom'` for the panes that hurt
(terminal, editor) or delete the field. A field that promises keep-alive and delivers nothing is the
worst of both.

## Verify before building

- The boot chain above was read at `e12ad5eb`. Confirm the helper's ready line still gates window
  creation and that nothing has started reading `keepAlive` before acting on either.
- The claim that the headless emulator's only consumer is `attach()` came from a grep over
  `plugins/terminal/src`; re-run it, and check `plugins/agents` has not grown a screen reader.
- The `term:status` consumer list (chrome, git status, session list, PR tabs, agents sidebar) is the
  blast radius that justifies phase 2. Re-derive it before splitting the event.
- The bundled-plugin rewrite cost (~2.4 MB per boot) assumes the hashes rarely change between
  launches. Confirm `pluginCache` rewrites unconditionally before making it conditional.
- Whether painting from the persisted cache needs anything beyond a synchronously readable last-known
  node id is the design question of phase 1. Prototype that before committing to the rest.
