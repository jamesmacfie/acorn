# Performance

A programme, started 2026-08-31 and widened 2026-09-02 to cover the terminal client and to record
the architecture decisions the first reads stopped short of. Phase 0 has shipped; nothing else has.

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
| [1](./phase-1-registries-hold-loaders.md) | Every name-to-component table maps to a loader: the kit tables on both hosts, the iframe copy, the CodeMirror language table; the terminal client stops loading CodeMirror. | Not started. |
| [2](./phase-2-paint-before-the-node.md) | The desktop window opens before the node boots: helper ready first, no awaits before `render`, paint from the persisted cache, immutable assets. | Not started. |
| [3](./phase-3-the-node-listens-sooner.md) | The node's boot sheds its serial dead weight: background shell probe, idempotent bundle writes, concurrent plugin init; the listener before plugins, gated on a number. | Not started. |
| [4](./phase-4-the-terminal-client-draws-first.md) | The terminal client renders under the per-node query client, persists it to the file cache it already installed, and draws while a started node boots. | Not started. |
| [5](./phase-5-stop-the-event-amplifiers.md) | Split `term:status`, filter non-active nodes in the helper, PTY pause with honest `seq`, the task-list N+1, and node-side caches for git status and device tokens. | Not started. |
| [6](./phase-6-terminals-work-only-when-watched.md) | The headless emulator runs only while attached, the ring is chunks, hidden tabs stay mounted, `term:out` is binary. | Not started. |
| [7](./phase-7-streaming-surfaces-render-incrementally.md) | The transcript's append is constant time, usage folds on the node, markdown re-renders its open block and caches closed fences. | Not started. |
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
