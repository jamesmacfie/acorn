# Phase 2: layouts, keys, and focus

Status: **shipped 2026-08-31.**

Read [findings.md](./findings.md) first: it adds two jobs to this phase, the host-supplied layout table the pane registry currently names directly, and the `Suspense` a `lazy()` region needs on a cell host.

## Goal

The seven layout components drawn from their projections, the keymap's terminal adapter installed
with all four layer tiers, focus regions and collections working without a DOM, and the PTY drawn
natively with the Rectangle contract. After this, every compiled first-party pane mounts on the TUI.

## Why this phase, and why now

Phase 0 built two layouts badly and wired four intents. Phase 1 finished the nodes. The layouts and
the keyboard are what turn a pile of nodes into a pane a person can drive, and every pane needs them.
The PTY is here because the terminal plugin's pane is the one that defines an agent workspace, and
because doing it natively is the thing a terminal does better than the desktop.

## Scope

In:

- Seven layout components in `apps/tui/src/layouts/`, one per `PaneLayoutName`, each from its
  projection in `docs/panes.md § Layout model`, sharing `packages/client-core/src/host/layouts/state.ts`
  and `LayoutProps` from `layouts/regions.ts`.
- `kit/keys/keymapHost.ts` generic over the keymap's two type parameters; the TUI installs
  `createDefaultOpenTuiKeymap`; the four tiers hold.
- A TUI `regions.ts`: registration by layout, ordering by the layout's region list, first stop by
  focus role over the renderable tree, focus through the renderer.
- `collection.ts` split into a shared intent half and a per-host element half.
- Traps as layers: `Modal` and `Menu` own the key layer while open.
- The Rectangle contract on the TUI: Enter to enter, Escape to leave, double Escape to send Escape,
  the footer saying so.
- The PTY region: `plugins/terminal`'s pane and `plugins/docker`'s exec mount a real PTY into a cell
  region through the Rectangle's `mount`, with resize following the region.
- `SIGWINCH` handling in the renderer.

Out: chrome (phase 4), the editor's `$EDITOR` handoff (phase 6), mouse.

## Design detail

**Layouts.** Each is a Solid component over OpenTUI box renderables, calling a `regionFocus` helper
in setup where the DOM one uses the directive. `list-detail` reads its own region's width, not the
terminal's, to decide one column or two; the threshold is the style token the DOM layout uses. Split
position moves by a chord on layer 5 and is stored in the same session signal.

**Keys.** `kit/keys/keymapHost.ts` today: `type AcornKeymap = Keymap<HTMLElement, HtmlKeymapEvent>`. It becomes
`Keymap<Target, Event>` with the pair supplied at `setKeymap`. `bindIntents` and `registerIntentLayer`
take a target rather than an `HTMLElement`. `isTerminalTarget` is supplied by the host at install:
the DOM's asks `.closest`, the TUI's asks the focused renderable for its rectangle kind.

**Regions.** The TUI's `regions.ts` (`apps/tui/src/keys/regions.ts` (new)) exports the same functions
the DOM one does. The DOM one's `compareDocumentPosition`, `querySelector`, `focusin`, and
`pointerdown` have no siblings; their callers are the layouts, which supply order explicitly.

**Collections.** `packages/client-core/src/kit/keys/collection.ts` splits at the element boundary:
`collectionIntents.ts` (new) is the intent handler over the host store; `collection.ts` keeps the
DOM element half and imports the shared one; `apps/tui/src/keys/collection.ts` (new) is the TUI
element half. `Grid`'s exception is unchanged on both.

**The PTY.** The terminal plugin's `TerminalSurface.tsx` mounts xterm into the element a `Rectangle`
hands it. On the TUI the `Rectangle` component for `pty` hands back a cell region with `write(bytes)`
and `onResize(cols, rows)`, and the surface writes the PTY stream to it and forwards keys while
entered. The PTY itself stays where it is: on the node, reached over the same `term` WebSocket
channel. The TUI is a second terminal emulator for it, this time a real one.

## Code touched

- `apps/tui/src/layouts/*.tsx` (new, seven files), `apps/tui/src/keys/{regions,collection,install}.ts` (new).
- `packages/client-core/src/kit/keys/keymapHost.ts`, `install.ts`: generic types, host-supplied
  `isTerminalTarget`.
- `packages/client-core/src/kit/keys/collection.ts`, `collectionIntents.ts` (new).
- `packages/client-core/src/host/layouts/regions.ts`: `regionFocus` as a function beside the directive.
- `plugins/terminal/src/client/TerminalSurface.tsx`, `plugins/docker/src/client/DockerExecTerminal.tsx`:
  write to the rectangle's handle when it offers one.

## Tests

- One buffer test per layout at 80 by 24 and 120 by 40, from its projection.
- `keys/keys.test.tsx` gains a TUI twin in `apps/tui/`: the same intent scenarios against the
  terminal adapter, so the two adapters cannot drift.
- A trap test: a `Modal` open swallows `next` from the pane below and `dismiss` closes it.
- A rectangle test: Enter enters, keys go to the PTY handle, Escape leaves, Escape Escape sends `\x1b`.
- A resize test: `SIGWINCH` re-lays out and the PTY handle sees the new size.

## Docs owed

- `docs/panes.md § Layout model`: the projections are drawn, and where a projection changed on
  contact.
- `docs/command-palette-and-shortcuts.md`: the terminal adapter is used; the double-Escape rule.
- `docs/terminal.md`: the PTY on the TUI.

## Doors left open

- Mouse: `regions.ts` has no pointer path; adding one is a focus-on-click and nothing else.
- The chrome's regions (rail, pane row, footer) register through the same `regions.ts`, phase 4.

## Done when

Every compiled pane in `plugins/*` mounts on the TUI without a thrown error, the terminal pane runs a
shell at 80 by 24 with vim inside it surviving a resize, and `j`/`k`/Enter/Escape do the same things
they do on the desktop in every collection.

## Verify before building

- `packages/client-core/src/kit/keys/keymapHost.ts` still types the keymap to `HTMLElement`.
- `packages/client-core/src/host/layouts/regions.ts` still exports `LayoutProps` with `Region` as a thunk.
- `plugins/terminal/src/client/TerminalSurface.tsx` still mounts through `Rectangle`'s `mount`.
- `docs/panes.md § Layout model` still has a projection row per layout.

## What shipped, and where it differs

Seven layout components, the terminal adapter with all four tiers, focus regions and collections
without a DOM, traps as layers, and the PTY drawn natively with the Rectangle contract. `pnpm lint` is
green and the `tui` suite is 111 cases on Node 26.8.1.

Both findings this phase inherited are closed. The pane registry's layout table is host-supplied now
(`client-core/src/host/layouts/table.ts`), so `paneContributions()` hands back a component either host
can mount and the toy draws Notes through the pane's own component rather than reading its regions
back off the entry. And every region is under a `Suspense` of its own in the mount path — as is the
layout, which is a `lazy` for the same reason and was the empty string that actually broke the mount.

Six things went differently from the plan, or turned up on the way:

- **`keymapHost.ts` did not become generic over a pair of type parameters a caller threads through.**
  It holds the engine at the widest pair the engine allows and hands each host's pair back at the one
  call that reads it, because every caller in the kit means the DOM's and threading two parameters
  through `bindIntents` would have touched forty components to say nothing new. What did move out is
  `isTerminalTarget`, which is DOM all the way down and now lives in `host/keys/install.ts`; and what
  moved in is one host-supplied predicate, "is somebody typing", which is the only question a binding
  asks about the focused thing.

- **A rectangle owns its keys by intercepting, not by holding a layer.** A layer answers keys it can
  name and a rectangle answers all of them, so `PtyRectangle` registers a key intercept above every
  layer and consumes what it takes. Keys reach the emulator through `encodeKey`, not through its own
  `handleKeyPress`: the emulator only takes keys when the renderer has focused it, and here the box
  holds the focus so that Enter and Escape belong to the rectangle rather than to what is inside it.

- **The double Escape has no pending window.** "Escape alone leaves, Escape twice sends one" is drawn
  as leave-immediately plus "a second Escape within 400ms goes back in and sends it". Holding the
  first press to see whether a second arrives would put a delay on every exit, and this is the one key
  rule the desktop does not have, so it should not also be the slowest.

- **Two rules are the terminal's own, and both are about a host with no pointer.** A pane opens with
  the keys already somewhere, because there is no click to put them there. And a region opens on its
  list where it has one rather than on the first field above it, because the first thing focused is
  the thing the bare keys drive and landing in a filter box means `j` types a `j`. Both are in
  `docs/command-palette-and-shortcuts.md` § Focus and typing.

- **One written projection changed on contact.** The two document splits said the frame half is a
  rectangle and is absent, so the document half fills the pane. A `frame` region holds a loaded
  plugin's tree, which draws in cells like anything else; what cannot cross is an iframe's pixels, and
  a frame region is not one. Both halves are drawn and `docs/panes.md` says so.

- **A shared test seam was quietly broken and this phase found it.** `_resetCollectionState()` was
  `setStates(() => ({}))`, and a Solid store setter handed a plain object *merges* it — so the reset
  did nothing and a suite's second test inherited the first one's caret. It is `reconcile({})` now.
  The DOM suite never noticed because each jsdom file is a fresh module graph; the terminal's whole
  suite is one process.

## What this phase deliberately left

`plugins/terminal/src/client/TerminalSurface.tsx` and `plugins/docker/src/client/DockerExecTerminal.tsx`
are unchanged. Both attach xterm to the element the DOM rectangle hands them, and neither is reachable
on this host yet: the TUI draws one pane and the roster has one plugin in it, so a change to either
would be code nothing runs and no test can reach. The seam they will use is built and tested — a `pty`
rectangle hands its caller `write`, `onData` and `onResize` — and the two callers move in phase 6,
after phase 4 gives the terminal a drawer to mount them in.

So the "done when" of this file is met for the layouts, the keys, the focus and the rectangle, and not
for "the terminal pane runs a shell at 80 by 24 with vim inside it": that sentence needs chrome. The
rectangle test drives the emulator directly instead — bytes in, keys out, resize through — which is
everything between the pane and the PTY except the pane.
