# Performance: the order of work

Plan, 2026-08-31. Nothing here is scheduled. Each phase is independently shippable and each ends
with a measurement, because the standing rule of this programme is that nothing past phase 0 gets
argued from source alone. Items marked (analysis) come from [analysis.md](./analysis.md) and carry
their detail there; items marked (architecture) come from [architecture.md](./architecture.md).
What this plan decided not to do is in [refused.md](./refused.md).

## Phase 0: unblock the build and get numbers

The desktop build is red on its own startup budget, and the repo has no timing anywhere. Everything
later is a guess until both are fixed.

- Split the icon set: a 12 KB eager map of the 68 code-referenced names, the full Lucide map lazy
  behind it, picker and `tasks.icon` awaiting the lazy map. Recovers about 350 KB and turns the
  budget check green. (analysis § 1)
- Instrument: boot marks in all three processes stitched into one cold-start breakdown, one
  request-duration line on the node behind an environment variable, `process.hrtime` histograms on
  the git seam and the SQLite shim, a `performance.mark` around first paint, and a count of the
  module-preload chain's depth. (analysis §§ 3, 14)

Done when: `pnpm --filter @acorn/desktop build` passes its budget, and a cold start produces a
timeline a person can read.

## Phase 1: paint before the node

The largest single change in the programme: the window stops waiting for the node.
(architecture § 1)

- The helper binds its WebSocket server and prints ready before spawning the node; the Rust shell
  opens the window on that earlier ready. The node's arrival becomes the `node-status` push the
  renderer already handles.
- The renderer drops its two top-level awaits. `applyNodePlugins` already argues for this in its own
  comments; `selectActiveNode` needs the last-known node id readable synchronously so the cache
  partition key no longer waits on the fleet answer. First paint comes from the persisted query
  cache behind the existing `isRestoring` gate, with a skeleton where the cache is cold.
- The node's own boot sheds its serial dead weight: the login-shell PATH probe starts in the
  background and is awaited at first spawn (analysis § 4), plugin init runs concurrently where the
  inits are independent, and the bundled-plugin hash-and-rewrite becomes a no-op when the hashes
  match.
- Module delivery stops fighting WebKit: the scheme handler goes asynchronous off the callback
  thread, hashed `/assets/*` responses get `immutable` caching instead of `no-store`, and the eager
  imports that pull `shiki`, `DiffPane`, and `prModel` into the startup graph get traced and cut.
  (analysis §§ 2, 3)

Done when: the window opens before the node finishes booting, the shell draws from cache with the
node still absent, and the phase 0 timeline shows it.

## Phase 2: stop the event amplifiers

Small diffs, outsized blast radius. (architecture §§ 2, 4; analysis §§ 12, 13)

- Split `term:status`: the consumers that refetch chrome, git status, the session list, and two
  plugin sidebars each get an event scoped to what actually changed, and `bumpChrome` takes a
  plugin id.
- The helper drops frames for non-active nodes instead of forwarding them to the renderer to be
  dropped there.
- The PTY pauses while a sink is over its buffer mark, and a shed frame no longer burns a `seq`, so
  transient congestion stops escalating into a socket reset, a framebuffer replay, and a whole-cache
  refetch.
- The task-list N+1 becomes one `inArray` over the distinct project ids.

Done when: a terminal producing output at full rate moves no query traffic on an idle client, and a
deliberately saturated socket recovers without a reconnect.

## Phase 3: terminals do work only when watched

The node-side half of the terminal shape. (architecture § 3)

- The headless emulator runs only while a sink is attached. Attach on a cold session replays the raw
  ring through a fresh emulator instead of reading state kept warm for nobody; the trade, scrollback
  bounded by the ring, is recorded in refused.md.
- The ring becomes a chunk list with a byte budget instead of a string re-concatenated per PTY chunk.
- Inactive terminal tabs stay mounted and hidden, the trade `TabsLayout` already names for trees, so
  a tab switch is a visibility toggle rather than a serialize, a retransmit, and a fresh WebGL
  context.
- `term:out` moves to binary WebSocket frames with one encode per broadcast, the upgrade `wire.ts`
  names for the renderer hop too.

Done when: an unwatched session costs no parser time on the node loop, and a tab switch touches no
network.

## Phase 4: the live surfaces

The per-event and per-switch costs on the surfaces a person actually stares at.
(analysis §§ 6-10, 16, 17; architecture § 5)

- `appendEvent` keeps a `Set` of seen ids and appends in place of the copy-and-sort; `turns.find`
  becomes one memoized `Map` above the `Index`; the projected-event snapshot refetch sends the
  changed turn or request instead of re-reading 2,000 rows.
- Diff hydration publishes per path instead of one version counter over every file, and the
  parsed-file map becomes a keyed store write.
- The switch cost gets a decision, not a workaround: either `keepAlive: 'dom'` is implemented for
  the terminal and editor panes, or the field is deleted and the data path carries it, meaning the
  editor's three serial mount round trips collapse to one, and the task rail prefetches on hover the
  way the PR list already does.

Done when: a profiled long agent session and a 200-file pull request stay responsive under the
phase 0 instrumentation, and `keepAlive` either works or does not exist.

## Phase 5: re-measure, then the deferred arguments

Everything parked behind a number: base64 versus binary frames for `node-fetch` bodies, an
incremental transcript projection, per-key query persistence, and any general per-connection
interest model on `/v2/events`. Each stays in refused.md until a phase 0 measurement moves it out.
