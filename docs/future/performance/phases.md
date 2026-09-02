# Performance: the order of work

Plan, 2026-08-31, reordered 2026-09-02 when the programme widened to the terminal client. Nothing
here is scheduled. Each phase is independently shippable, has its own file, and ends with a
measurement, because the standing rule of this programme is that nothing past phase 0 gets argued from
source alone. [decisions.md](./decisions.md) says which decision each phase serves;
[refused.md](./refused.md) says what none of them will do.

## The graph

```text
0 instrument and unblock
└─ 1 registries hold loaders
   ├─ 2 paint before the node (desktop)
   ├─ 3 the node listens sooner
   ├─ 4 the terminal client draws first
   └─ 5 stop the event amplifiers
      ├─ 6 terminals work only when watched   (needs 5's seq accounting)
      ├─ 7 streaming surfaces render incrementally
      ├─ 8 switching and hydration           (reads better after 7)
      └─ 9 the terminal client's keystroke
         └─ 10 re-measure, then the deferred arguments
```

Phases 2, 3, 4, and 5 are independent of each other and can run in parallel once 0 and 1 are in.
Phases 7, 8, and 9 are independent of each other; 6 needs 5. Phase 10 is last by definition.

## The phases

**[Phase 0: instrument, and unblock the build.](./phase-0-instrument-and-unblock.md)** The icon split
that turns the desktop budget green, a startup denylist on both hosts so a named heavy chunk fails the
build even under budget, boot marks in every process stitched into one timeline, and a request-duration
line on the node. Done when the budget passes and a cold start prints a timeline a person can read.

**[Phase 1: registries hold loaders.](./phase-1-registries-hold-loaders.md)** The kit component
tables on both hosts, the iframe path's copy, and the CodeMirror language table map names to loaders.
Removes `shiki`, `DiffPane`, and `prModel` from the desktop's first paint and CodeMirror from the
terminal client entirely. Done when the denylist passes and the terminal client's eager graph is
under half its measured size.

**[Phase 2: paint before the node.](./phase-2-paint-before-the-node.md)** The helper prints ready
before the node boots, the window opens on that, the renderer drops its two awaits, and the shell
paints from the persisted cache. Done when the timeline shows the window open before `listener-up`.

**[Phase 3: the node listens sooner.](./phase-3-the-node-listens-sooner.md)** The shell probe leaves
the critical path, bundle writes become idempotent, plugin init runs concurrently. The listener before
plugin init was gated on phase 0's breakdown and is refused: 24 ms of plugin passes does not justify a
wire contract. Shipped 2026-09-03. `install` did not drop, because plugin inits are synchronous and
concurrency cannot overlap them; what dropped was the boot, by 548 ms on a packaged macOS build (the
shell probe) and 78 ms on a warm one (a `chmod` sweep over the blob cache).

**[Phase 4: the terminal client draws first, from disk.](./phase-4-the-terminal-client-draws-first.md)**
One query client per node in `acorn` too, persisted through the file storage it already installs;
the tasks request and the plugin activation off the critical path; the shell visible while a started
node boots. Done when first draw on a warm cache is under the stated target.

**[Phase 5: stop the event amplifiers.](./phase-5-stop-the-event-amplifiers.md)** `term:status`
splits into events that name what changed, the helper filters non-active nodes, the PTY pauses under
backpressure with honest `seq`, the task-list N+1 goes, and the node caches git status and device
tokens with short time-to-live windows, reads only. Done when a busy terminal moves no query traffic
on an idle client and one ping spawns one git per worktree.

**[Phase 6: terminals do work only when watched.](./phase-6-terminals-work-only-when-watched.md)**
The headless emulator runs only while attached, the ring is chunks, inactive tabs stay mounted,
terminal output is binary on the wire. Done when an unwatched session costs no parser time and a tab
switch touches no network.

**[Phase 7: streaming surfaces render incrementally.](./phase-7-streaming-surfaces-render-incrementally.md)**
Constant-time append, usage folded once on the node, markdown that re-renders its open block and
caches closed fences, one memoized turn map. Done when a 2,700-event session streams under the
per-event budget.

**[Phase 8: switching and hydration.](./phase-8-switching-and-hydration.md)** `keepAlive` deleted or
implemented, one round trip to editor text, hover prefetch on the rail, per-path diff hydration.
Done when switching back to a recent task issues no request.

**[Phase 9: the terminal client's keystroke.](./phase-9-the-terminal-clients-keystroke.md)** Indexed
focus regions, hints as a memo, typing as a layer so the keymap's cache stays on, stable rows in the
rail, windowed long lists and diff pane. Done when a key press visits a bounded number of nodes and
the reachability suite is green unchanged.

**[Phase 10: re-measure, then the deferred arguments.](./phase-10-re-measure-and-the-deferred-arguments.md)**
Everything parked behind a number, taken up or refused against the re-measured tree.
