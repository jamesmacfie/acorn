# Performance

A programme, started 2026-08-31 and widened 2026-09-02 to cover the terminal client and to record
the architecture decisions the first reads stopped short of. Phases 0 to 4 have shipped.

The renderer build was red on its own startup budget for two days and drifted further over it while it
sat there (1,317,605 bytes, then 1,324,279, then 1,329,679 against 1,250,000), which was the argument
for the denylist phase 0 added alongside the byte total. It is green now, at 974,732 bytes.

Four reads, one set of decisions and one set of numbers feed eleven phases:

- [analysis.md](./analysis.md) reads the desktop's surfaces: the startup payload measured from the
  built renderer, and the per-event costs of the agent transcript, the diff viewer, the node's request
  paths, and the persister, read from source. 2026-08-31.
- [architecture.md](./architecture.md) reads the desktop's shapes, from tracing four paths end to
  end: a cold start that gates the window on a complete node boot, backpressure that amplifies load,
  a terminal pipeline that pays for sessions nobody watches, an event firehose whose `term:status`
  ping refetches most of what a client knows, and remount-first switching whose softeners are dead
  code. 2026-08-31.
- [tui-analysis.md](./tui-analysis.md) reads the terminal client: a startup path with the desktop's
  shape, two query clients and a cache nobody writes, an eager graph that is half the build, a key
  path that scans arrays inside a subtree walk, and lists that build every row. 2026-09-02.
- [decisions.md](./decisions.md) is what was decided from all three: seven decisions about which
  foundations stay and which change, and the corrections to the first two reads. 2026-09-02.
- [phases.md](./phases.md) is the order of work and the dependency graph. Each phase has its own
  file, written for a reader with none of this context: why the mechanism is the way it is, with
  paths and numbers, and then what to change.
- [refused.md](./refused.md) is what the programme decided not to do, so it stays decided.
- [measurements.md](./measurements.md) is what each phase measured, dated, with the command. Phase 0
  filled it first, and phase 3's decision about a wire contract turns on a figure in it.

## The phases, in one line each

| Phase | What it is | Status |
| --- | --- | --- |
| [0](./phase-0-instrument-and-unblock.md) | Split the icon set out of startup, add a startup denylist to both hosts' build checks, and instrument boot, requests, and first paint on the node, the desktop, and the terminal client. | **Shipped 2026-09-02.** Budget green at 974,732 B. Behaviour lives in [frontend.md](../../frontend.md) § Startup budget, [ui-design.md](../../ui-design.md) § Icons, [local-development.md](../../local-development.md) § Timing a cold start. Numbers in [measurements.md](./measurements.md). |
| [1](./phase-1-registries-hold-loaders.md) | Every name-to-component table maps to a loader: the kit tables on both hosts, the iframe copy, the CodeMirror language table; the terminal client stops loading CodeMirror. | **Shipped 2026-09-03.** Budget 654,403 B, and both hosts' known-failure allowances are empty. The terminal client's closure misses its 550 KB target at 1,024,422 B because the rest is phase 4's plugin barrels. Four of the phase's premises were false and the phase file records them: `remoteSolid.ts` holds node factories, not components. Behaviour lives in [plugins.md](../../plugins.md) § The tree contract, [editor.md](../../editor.md), [tui.md](../../tui.md) § The host switch. |
| [2](./phase-2-paint-before-the-node.md) | The desktop window opens before the node boots: helper ready first, no awaits before `render`, paint from the persisted cache, immutable assets. | **Shipped 2026-09-03.** The window opens 601 to 747 ms before `listener-up`, and the boot test asserts the mark order. Dropping the entry's awaits merged 91 chunks: 43 startup requests, depth 3. The active node selection had to be persisted first; it was not. Behaviour lives in [shell.md](../../shell.md), [frontend.md](../../frontend.md) § Painting before the node, [caching.md](../../caching.md), [state-ownership.md](../../state-ownership.md). |
| [3](./phase-3-the-node-listens-sooner.md) | The node's boot sheds its serial dead weight: background shell probe, idempotent bundle writes, concurrent plugin init; the listener before plugins, gated on a number. | **Shipped 2026-09-03, definite half only.** 548 ms off a packaged macOS boot and 78 ms off a warm one. The gated wire contract is refused, and so are the per-plugin bundle split and a journal check before `migrate`, all on numbers in [measurements.md](./measurements.md) and [refused.md](./refused.md). Behaviour lives in [node-distribution.md](../../node-distribution.md) § Boot order, [plugins.md](../../plugins.md) § Activation, [security.md](../../security.md) § Third-party plugin bundles. |
| [4](./phase-4-the-terminal-client-draws-first.md) | The terminal client renders under the per-node query client, persists it to the file cache it already installed, and draws while a started node boots. | **Shipped 2026-09-03.** First draw attached is 67 ms, not the 300 ms the phase file proposed, and `acorn` against a stopped data root draws at 62 ms rather than 722–852 ms. The cache directory is written for the first time. The eager closure is 841,142 B, ceiling 870,000 B, which is phase 1's 550 KB target still missed and now explained: cutting all twelve plugin barrels takes 185 KB, not 500 KB, because the rest is the chrome's own client-core. Two faults the reorder exposed were fixed with it: a broker with no record answers `Unknown node`, and an unhandled rejection in `initSessions` drew OpenTUI's debug console over the shell. Behaviour lives in [tui.md](../../tui.md) § Attach or start, § Where the TUI keeps things, § Booting client-core under Node, and [caching.md](../../caching.md) § Renderer query cache. |
| [5](./phase-5-stop-the-event-amplifiers.md) | Split `term:status`, filter non-active nodes in the helper, PTY pause with honest `seq`, the task-list N+1, and node-side caches for git status and device tokens. | **Shipped 2026-09-03.** A status ping is 4 `git status` processes instead of 16 over two clients and four worktrees, and does not grow with clients. A warm device token costs no `SELECT`, down from one per request. The task list is 3 queries for 24 tasks, down from 26. A terminal's idle-to-working edge moves one session read instead of six subscribers' worth. The hub pauses the pseudo-terminal instead of dropping a frame, and sheds an invalidation ping as a `ws:shed` marker with no `seq` gap, so congestion no longer causes a reconnect. **The worktree-removal guard still refuses a worktree with a change written 100 ms ago.** Two deviations from the phase file, and phase 0's request log still unread, are recorded in the phase file and [measurements.md](./measurements.md). Behaviour lives in [api-reference.md](../../api-reference.md) § WebSocket, [terminal.md](../../terminal.md) § Backpressure, [workspaces-and-tasks.md](../../workspaces-and-tasks.md) § Worktree status reads, [security.md](../../security.md) § Transport and auth, [shell.md](../../shell.md) § Connection broker, [plugins.md](../../plugins.md) § Hearing a core event. |
| [6](./phase-6-terminals-work-only-when-watched.md) | The headless emulator runs only while attached, the ring is chunks, hidden tabs stay mounted, `term:out` is binary. | **Shipped 2026-09-03.** A megabyte of a build's output through an unwatched session is 2.8 ms instead of 492 ms, and no emulator is built at all. Four tab switches between two open sessions cost nothing, down from 4 HTTP requests, 8 WebSocket frames, 4 destroyed xterms and 4 framebuffer serializes. `term:out` is a binary frame on both hops: a sixth of the bytes off ordinary output, nearly a third off the escape-heavy frames an agent TUI draws, and one encode per broadcast instead of one per socket. The trade is scrollback bounded by the 256 KB ring, which [refused.md](./refused.md) already recorded. Behaviour lives in [terminal.md](../../terminal.md) § The screen, and who pays for it, § Client, [shell.md](../../shell.md) § The renderer bridge, [tui.md](../../tui.md) § Rectangles. Numbers in [measurements.md](./measurements.md). |
| [7](./phase-7-streaming-surfaces-render-incrementally.md) | The transcript's append is constant time, usage folds on the node, markdown re-renders its open block and caches closed fences. | **Shipped 2026-09-03.** Store bookkeeping per streamed event is 0.1 µs, down from 21.6 µs on a real 2,727-event session. A message with three fences is highlighted 3 times across eleven renders instead of 33, and replaces 10 block elements instead of 374. The HTTP snapshot's first page is 1,345 rows instead of 2,000; the ledger still holds every one. 645 of the database's 679 projected events no longer refetch a snapshot, because the node sends the turn or the request; `error` still does, on purpose. Two of the phase file's premises were wrong and it records them: the 2 ms per-event budget was already met at 0.33 ms, and the highlighter cache belongs in `infra/highlight/shiki.ts`, not in `worker.ts`. Behaviour lives in [managed-agents.md](../../managed-agents.md) § The transcript store, [ui-design.md](../../ui-design.md) § How the kit is built. |
| [8](./phase-8-switching-and-hydration.md) | `keepAlive` decided, one round trip to editor text, hover prefetch, diff hydration per path. | Not started. |
| [9](./phase-9-the-terminal-clients-keystroke.md) | The terminal client's key path is indexed, hints are a memo, typing is a layer, long lists and the diff pane window their rows. | Not started. |
| [10](./phase-10-re-measure-and-the-deferred-arguments.md) | Re-measure everything, then take up or refuse the parked arguments against the numbers. | Parked behind numbers. |

## How this relates

The budget check phase 0 turns green lives in `apps/desktop/scripts/check-renderer-budget.mjs` and
runs inside the desktop build; its terminal-client twin is `apps/tui/scripts/check-startup-graph.mjs` (new).
 The event ceiling phase 5 works around is recorded in [events.md](../events.md); the terminal
display contract phase 6 changes is [docs/terminal.md](../../terminal.md)'s; the transcript decisions
phase 7 touches are [docs/managed-agents.md](../../managed-agents.md)'s; the focus rules phase 9 is
held to are [docs/tui.md](../../tui.md) § Keys and focus. Where a phase ships, its behaviour moves to
the owning doc and the phase row here shrinks to a pointer, the same way every retired programme ended.
