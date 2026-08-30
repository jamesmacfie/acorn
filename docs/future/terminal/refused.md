# Refused

What was considered and turned down, with the argument, so it is not re-argued.

## A per-plugin terminal UI

The 2026-08-10 idea: a plugin opts into a `tui` surface and draws its own ANSI rectangle. Refused
because it makes every plugin author write two UIs and makes the terminal a second-class host by
construction. The tree renders on any host for free; a plugin that needs pixels has a rectangle and
is absent in the terminal. No `tui` surface kind, no `tui` entry in a manifest.

## A tree-only host

Considered on 2026-08-30: run every pane, first-party included, through the worker tree protocol, so
the TUI needs no Solid reconciler. Refused with the owner. Every first-party plugin would need the
universal JSX transform and a worker bundle, and would lose in-process access to the host it has
today. The desktop runs first-party panes in-process and loaded ones in a worker, and the symmetry
test (`packages/client-core/src/host/frames/twoPaths.test.tsx`) is what proves the two paths draw
one kit. The TUI keeps the same two paths so that test keeps meaning something.

## Bun as the TUI runtime

OpenTUI's own development requires Bun. Its published core runs under Node through a `node` export
condition. Two runtimes in one tarball is two things to pin, sign, and prebuild native modules
against, and the node needs Node 24 for `node:sqlite`. One runtime.

## A second keymap, or key handling in a node

Inherited from `docs/future/client-plugins/refused.md § A second keymap`. Every key goes through
`@opentui/keymap`'s layers. A node handles `next`, not `ArrowDown`. The footer and the cheat sheet
read the same table the dispatcher does.

## Rendering pixels in cells

Monaco, webviews, images, charts beyond block and braille characters. Sixel and Kitty graphics
protocols exist and are not portable. A rectangle draws its `<Fallback>` or a placeholder, and
Markdown drops images.

## A below-80-column story

Each layout has one narrow projection, written in `docs/panes.md § Layout model`. There is no second
breakpoint, no phone-shaped terminal mode. Below 80 columns the TUI says so on the footer line and
draws the narrow projection anyway.

## A TUI-specific layout

A ninth layout, or a terminal-only region on an existing one, would be a pane declaring something
the desktop cannot draw. Eight layouts, each with a projection, on both hosts.

## Mouse support as a phase

Clicking to focus and scrolling a collection is a small addition to phase 4 if someone wants it, and
nothing more than that is ever promised. Drag, hover, and context menus stay keyboard-driven, because
hover is never load-bearing and a context menu is a `Menu` on a key.

## A hub or relay for the terminal

`acorn --node` reaches a node the way the desktop does: directly, over a network the operator already
trusts, with pinning. Reaching a node across the internet is `docs/future/remote.md`'s relay and is
not made a terminal question.

## Building the PWA first

`terminal.md` sequenced the PWA before a toy terminal host. Struck on 2026-08-30. The toy host is the
cheapest test that the kit is intent and not layout, and the PWA neither needs it nor is needed by it.
