# Phase 4: chrome

Status: not started. Waits on phases 2 and 3.

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
