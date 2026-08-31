# Phase 4: chrome

Status: **shipped 2026-08-31.**

## Goal

The screen in [07-chrome.md](./07-chrome.md): topbar, rail with tasks and drawer sources, pane row,
pane, footer, palette, overlays, notifications. Switching tasks, workspaces, panes, and nodes. A
workspace a person can live in.

## Why this phase, and why now

Phases 0 to 3 produce a pane in a terminal against a real node. This phase produces acorn in a
terminal. It waits on layouts (the chrome is made of them and of kit nodes) and on the process model
(the topbar and footer show node state).

## Scope

In:

- The rail as a kit tree through the `rail.taskList` registry, with `core:task` marks as glyphs;
  collapse below 100 columns.
- The topbar as one line: workspace, task count, branch, node state.
- The pane row as one `Tabs`-shaped line.
- The footer: active bindings from the keymap; PTY-entered text; node state when it is not `ready`.
- The palette: `Modal` over `kit/lib/paletteModel.ts`, the command chord, results as `Rows`.
- The overlay stack and traps from phase 2, now with more than one overlay.
- Notifications as one-line `Alert`s above the footer.
- The drawer's sources as rows under the rail's rule; choosing one opens the PTY as the pane.
- Workspace switch through a `Menu`; node switch through the palette.
- `Tab`/`Shift+Tab` region cycling across chrome and pane.
- The cheat sheet on `?`.
- `q` with a confirm when the TUI started the node.

Out: any replaceable-surface contract (the registry is used, the contracts are
`docs/future/client-plugins/`), mouse, themes beyond the slot mapping.

## Design detail

**Registry first.** The rail's task list already goes through `CORE_EXCLUSIVE_SLOTS` and
`registries/extensionPoints/exclusiveSlots.ts`. The TUI draws its default through the same registry so that when
`pane.switcher`, `rail`, and `topbar` become slots, the TUI's defaults are providers and a plugin's
offer replaces them with no TUI change. Until then the TUI's drawing of the pane row and topbar is
bespoke and lives in `apps/tui/src/chrome/`.

**Palette.** `kit/lib/paletteModel.ts` is host-neutral; `PaletteSurface.tsx` is not. The TUI's
`Palette.tsx` (new) is a `Modal` holding a `Field` and `Rows`, driven by the same model, opened by
the same command. Results are the registry's, so plugin commands appear as they do on the desktop.

**State.** Rail source restore, active workspace, and per-workspace state are the same signals the
desktop uses (`docs/state-ownership.md`), read from the same modules. The TUI persists session-only state
exactly as the desktop does: not at all across relaunch.

**Footer.** One line, three segments: bindings on the left, notifications transient in the middle,
node state on the right. Bindings come from the keymap's active layers through one function that the
cheat sheet also uses.

## Code touched

- `apps/tui/src/chrome/{Shell,Topbar,Rail,PaneRow,Footer,Palette,Overlays,Notifications}.tsx` (new).
- `apps/tui/src/main.ts` (new in phase 0): mount the shell instead of one pane.
- `packages/client-core/src/kit/lib/paletteModel.ts`: no change expected; note anything DOM that leaks.
- `packages/client-core/src/host/registries/extensionPoints/exclusiveSlots.ts`: no change expected.

## Tests

- Buffer tests for each chrome piece at 80 by 24 and 120 by 40.
- Region cycling: `Tab` from the rail lands on the pane row, then the pane, then the footer, then the
  rail.
- The palette opens on the chord, filters, runs a command, closes, and the pane's focus returns to
  where it was.
- Rail collapse at 99 columns, expand at 100.
- A notification appears above the footer, is dismissed on a key, and never took focus.
- `q` with a started node asks; `q` with an attached node does not.

## Docs owed

- `docs/ui-design.md § Shell hierarchy`: the terminal's shell beside the desktop's.
- `docs/command-palette-and-shortcuts.md`: the region cycle and the footer.
- `docs/future/client-plugins/04-replaceable-surfaces.md`: the TUI is the second consumer of each
  contract; its defaults are providers.

## Doors left open

- Every chrome surface is a provider through the registry, so client-plugins phases 1 and 2 replace
  them without touching `apps/tui/`.
- Mouse: click-to-focus on the rail is the one addition anyone has asked about.

## Done when

A person opens `acorn`, switches workspace, opens a task, moves between its panes, runs a command from
the palette, watches an agent in one pane and its terminal in another, and quits, without reading this
folder.

## Verify before building

- `packages/protocol/src/extensionPoints.ts` still lists `rail.taskList` in `CORE_EXCLUSIVE_SLOTS`,
  and `docs/future/client-plugins/` still plans `pane.switcher`, `rail`, and `topbar`.
- `packages/client-core/src/kit/lib/paletteModel.ts` still has no DOM import.
- `packages/client-core/src/features/tabs/TabRail.tsx` still calls `ExclusiveSlotHost` for the task list.

## What shipped, and where it differs

The screen in [07-chrome.md](./07-chrome.md), against a real node: a rail of tasks, a topbar, a pane
strip, a palette, a cheat sheet, notifications, a footer that says what the keyboard will do, and a
quit that asks when this TUI started the node. `pnpm lint` is green and the `tui` suite is 128 cases
on Node 26.8.1, nine of them the chrome's own.

Eight things went differently from the plan, or turned up on the way.

- **The region cycle is the screen, not the pane.** `moveRegion` walked the focused pane's regions,
  because the desktop draws several panes side by side and Tab into the next one would be a surprise.
  There is no next one here, so the rail, the pane strip and the pane's regions are one cycle, and the
  chrome orders itself around the pane by declaring orders outside the range a layout uses. The chord
  that switches which pane is drawn is `nextPane`, which is a switch on this host rather than a walk.

- **Tab is `nextRegion`, beside F6.** The DOM host spells that intent F6 because the browser owns Tab.
  A terminal owns Tab and a reader in one presses it first, so the host's key table adds it. The
  intent is the shared one and `intentKeys` is still the table; a host adding a key to an intent it
  already has is what a per-host key table is for.

- **Chords are spelled with Ctrl, and `keysFor()` grew a seam to say so.** The engine reports the
  platform's primary modifier, which on macOS is `super`, and a terminal emulator keeps Cmd for
  itself and never delivers it. So `commit` was `super+return`, a chord nobody can press. `setKeymap`
  takes a `primary` now and this host passes `ctrl`; the desktop passes nothing and is unchanged.

- **A `Modal`'s trap could not be activated from the inside.** Phase 2 put the swallow layer at the
  trap's own tier and reasoned that a collection inside the overlay would still answer its arrows
  "because its layer is focus-within on itself". Priority decides, not locality, so Enter reached the
  swallow first and a list inside a `Modal` was dead. The swallow sits below the collection tier now,
  which costs nothing: a collection behind the overlay does not fire anyway, because the overlay took
  the focus. Found by the quit confirmation, which is a list inside a modal and nothing else.

- **The palette does not use the kit's collection.** The desktop's `createOverlayPalette` handles its
  own arrows because the input owns the typing; in cells the argument is sharper, because a
  collection's keys are bare keys and a bare key does not fire while something is being typed into,
  which in a palette is always. So the palette keeps one cursor signal and binds the arrows above the
  trap.

- **An overlay hides the pane rather than replacing it.** Opening the palette must not tear down the
  pane behind it and throw away its queries and its model, so the pane box is `visible={false}` while
  an overlay is on top — the same thing `TabPanel` does for a hidden tab. `takeFocus` is the region
  store's answer to the DOM palette's `prevFocus`: what had the keys is remembered and put back.

- **`ExclusiveSlotHost` is the host's, like `KIT_COMPONENTS` and the layout table.** The arbitration
  rule in `exclusiveSlots.ts` is shared unchanged; only the drawing moved, because the DOM host's
  file reaches for `Dynamic` from `solid-js/web` and pulling that in would put a second Solid
  renderer in the graph for a component that renders one child.

- **The footer had to be told when to re-read.** The engine has no signal for "the active layers
  changed", so `activeHints()` reads the two signals that move them — where the keys are, and
  whether an overlay has taken them. Without that the footer is whatever was true at the render that
  happened to build it, which the capture script caught and the suite did not.

## What this phase deliberately left

- **The rail's drawer sources are browse sources, not terminal profiles.**
  [07-chrome.md](./07-chrome.md) says the rows under the rail's rule are the terminal drawer's and
  that choosing one opens the PTY as the pane. The terminal plugin's client half writes to the DOM
  rectangle's element and is not on this host's roster; moving it is phase 6, which owns both PTY
  callers. What is under the rule is the rail's browse sources, from the same `availableSources` the
  desktop rail reads, and the bundled roster registers none of them yet, so the rule draws nothing.

- **The footer is not a focus stop.** 07-chrome lists four stops in the cycle: rail, pane row, pane,
  footer help. The footer is a label with nothing to drive, and a stop that does nothing is a hole a
  reader falls into. `?` reaches the same list as a modal.

- **The theme is still the terminal's own palette.** `appearance.ts` said phase 4 would reach the
  preference. It cannot: a theme in acorn is an id, and its forty tokens live in a
  `:root[data-theme=…]` block in a stylesheet, whose only JS reader walks the repo from
  `pnpm-workspace.yaml` and is test-only by construction. Publishing those tokens as data is the
  appearance layer's change, not the chrome's. The default was always the terminal's own palette and
  it stays right.

- **Notifications are toasts, not notices.** The transient stack is the same `toast()` store the
  desktop's `ToastHost` draws, so `bridge.ui.toast` and every plugin that calls it lands on the
  footer's line. The notification bell is fed by agent sessions, which is the pane sweep's.

- **A workspace switch does not restore what you were looking at.** The desktop's
  `planWorkspaceViewTransition` remembers a view per workspace; this host clears the source and lets
  the first task open. Worth having, and it wants the persisted-state pipeline the TUI has none of.
