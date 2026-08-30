# Phase 2: layouts, keys, and focus

Status: not started. Waits on phase 1.

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
- `keys/host.ts` generic over the keymap's two type parameters; the TUI installs
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

**Keys.** `keys/host.ts` today: `type AcornKeymap = Keymap<HTMLElement, HtmlKeymapEvent>`. It becomes
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
