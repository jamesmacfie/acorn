# Terminal reporting and invariants

This page covers what telemetry the terminal client adds, and the keyboard invariants its tests hold.
It's part of [the terminal client](../tui.md).

## What the terminal client reports

Telemetry is off by default, and when it's on the terminal client builds the same five record kinds as
every other runtime. [Telemetry](../telemetry.md) owns the model, the switch, and the collector. This
section covers what this host adds.

Its stderr is the screen. A log line written while the renderer owns the terminal garbles the frame,
so `apps/tui/src/main.tsx` replaces `console.log`, `warn`, `error`, `info`, and `debug` for the run and
prints what it caught after `renderer.destroy()`. The logger writes through those five, so a
`createLogger` line still becomes a record, and its printed half waits.

A batch leaves the ordinary way. The emitter is client-core's, started from `main.tsx` with
`runtime: 'tui'`. Its poster uses the API client, which here is the platform seam, so a batch goes
through the broker with the device token and the pinned certificate.

| Seam | Where | What it emits |
| --- | --- | --- |
| Every frame | `apps/tui/src/renderer.ts`, from `paint/screen.ts` | Histogram `tui.frame`, four series by `phase`: `total`, `layout`, `paint`, and `flush` |
| Every key press | `apps/tui/src/keys/install.ts` | Histogram `tui.key` with the dispatcher's `reason`, and histogram `tui.key.steps` when the step counter is on |
| The boot account | `apps/tui/src/boot.ts` | Span `tui.boot` with a `tui.boot.mark` child per mark |
| Everything client-core reports | [Renderer telemetry](../telemetry/renderer.md) | Requests, commands, page changes, pane regions, trees, notices, contribution errors |

A frame is a histogram, never a span, because a held arrow key draws far more than 10 frames a second
([the telemetry model](../telemetry/model.md)). The split costs four `performance.now()` reads per
frame, about 160 nanoseconds against a 5 ms frame budget. `phase` is a label, so "which part is slow"
is a filter.

`tui.key.steps` is how many nodes the focus store visited for one key, the number the key trace ends
with ([key trace](./footer.md#seeing-what-the-keys-did)). It's collected only with
`ACORN_TUI_KEYS_TRACE` on, and its unit reads as milliseconds because the emitter writes one.

The boot marks become spans after the fact. The switch is a Node preference that arrives a round trip
after the shell draws, so a span emitted at the mark would always be dropped. `apps/tui/src/boot.ts`
keeps the marks for the `[acorn:boot]` account it prints on exit, and `App.tsx` turns them into one
trace the first time the preference reads yes.

Three files print to the terminal on purpose: the pairing banner and instructions in
`apps/tui/src/node/pair.ts` and `apps/tui/src/node/open.ts`, which print before any renderer exists,
and the data-root path in `apps/tui/src/platform.ts`, which is what "open the data folder" means here.
`tools/arch/boundaries.test.ts` holds those three as a baseline that may only shrink.

## The invariants

These are 11 sentences about the keyboard, each a test, not a scenario.
`apps/tui/src/reachability.test.tsx` walks every stop on nine surfaces: the browse rail, the six panes
the pane sweep opens, the cheat sheet as an open dialog, and the Settings route on Notifications. It
checks five of these after every press, so a new pane or control is covered the day it lands.

| # | The invariant | Where it's checked |
| --- | --- | --- |
| 1 | Every stop a region declares is reachable from the keyboard. | `reachability.test.tsx`, against `_allStops()` |
| 2 | Every stop acts: focusing it and pressing Enter calls the handler. | `kit/kit.test.tsx` § every control is a stop |
| 3 | One caret. At most one `›` is on screen, and it marks what has the keys. | `reachability.test.tsx`, after every press |
| 4 | Escape is bounded and ends in the rail. | `reachability.test.tsx` § escape is bounded |
| 5 | One deferred decision: `queueMicrotask` appears once in `keys/` and never in `kit/`. | `invariants.test.ts` |
| 6 | Focus never sits on a node that's gone. | `reachability.test.tsx`, after every press |
| 7 | No chord this host can't press: `super+` is spelled only where it's rewritten. | `invariants.test.ts` |
| 8 | The footer is accurate: the word beside a key is what the key does there. | `reachability.test.tsx`, against the word table |
| 9 | There's one focus value, and it names a node in the tree that can hold the keys. | `reachability.test.tsx`, after every press. `setFocusedNode` appears once, `.focus()` and `.blur()` once each in the caret mirror, no source asks the renderer what has the keys, and `focusable =` appears only where `invariants.test.ts` allows. |
| 10 | Focus is inside the top scope: with a dialog open, no key moves the keys out of it. | `reachability.test.tsx`, after every press on the overlay surface |
| 11 | A claimed key changed something. A handler that changed nothing returns `false`, and the key bubbles. | `reachability.test.tsx` § crossKeys, which presses `h` and `l` on every kind of focused thing and checks the footer's word came true |

Invariant 3 doesn't check for one lit control, because focus draws `strong` and `accent`, and so does
an active tab label. Invariant 4's bound is the parent stops above the caret plus the region chain
`apps/tui/src/chrome/topology.ts` names, which on a task pane is two more hops: pane region to strip,
and strip to Tasks.

The walk is Tab major and `↓` minor: inside the region with the keys, Down until the caret stops, then
Tab to the next region. A failure names the surface, the size, and the line it couldn't reach, and the
same keys reproduce it. Right and Enter aren't in the walk, because a panel's contents are the level
below.

## What must never happen

These rules hold on both hosts:

- A second keymap, or key handling in a component. Every key goes through `@opentui/keymap`'s layers.
- A node that handles `ArrowDown`. Nodes handle `next`.
- Focus state a node owns. The host owns it.
