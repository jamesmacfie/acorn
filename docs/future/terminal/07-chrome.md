# Chrome: what the TUI draws itself

The kit and the layouts cover every pane. They do not cover the shell around the panes, which on the
desktop is bespoke DOM: the topbar (`apps/desktop/src/client/App.tsx`), the rail
(`packages/client-core/src/features/tabs/TabRail.tsx`), the palette
(`packages/client-core/src/host/palette/PaletteSurface.tsx`), and the overlay stack. None of it is kit, and
none of it is designed anywhere for a terminal. This file is that design.

## The screen

```
┌ acorn · runn-fast · 3 tasks ────────────────────────────── main ● ┐  topbar, 1 line
│ ▸ fix-login   │ Overview  [Checks]  Conversation  Diff             │
│   add-tests ● │ ──────────────────────────────────────────────── │  rail (left) + pane
│   docs        │  ✓ lint          2m                              │
│               │  ✓ test          4m                              │
│ ───────────── │  ● build         running                         │
│ term  agent   │                                                  │
│               │                                                  │
│ j/k move  enter open  tab pane  / search  ? help                 │  footer, 1 line
└───────────────────────────────────────────────────────────────────┘
```

Left to right, top to bottom: one topbar line, a rail column of task rows with the drawer sources
below a rule, the active pane in the rest, one footer line. Below 100 columns the rail collapses to a
two-cell marker strip, the same collapse the desktop's `leftCollapsed` pref does, toggled by a key.

## What is reused

`docs/future/client-plugins/04-replaceable-surfaces.md` turns four core surfaces into exclusive slots
with kit-tree provider contracts: `rail.taskList` (shipped), `pane.switcher` (phase 1), `rail` and
`topbar` (phase 2). A provider receives one props object and returns one tree of kit nodes, and
nothing in the props is a shell callback a worker could not receive. That is the property the TUI
needs: a rail drawn from a kit tree draws on the TUI for free.

So the TUI draws the core default for each of those four surfaces as a kit tree, through the same
registry, and when client-plugins lands its slots the TUI's default is one provider among the
plugins' offers. Until then the TUI's defaults are the only providers and the registry is a
formality it keeps anyway, so the day the slots open nothing in the TUI moves.

The task rows are `Row` nodes with the `core:task` rail marker drawn as a glyph, the same
`AnnotationMarks` draw site the desktop uses.

## What is drawn bespoke

The client-plugins programme keeps the command palette and the overlay stack core-owned
(`04-replaceable-surfaces.md`), because a palette drives the shell's focus stack and a replacement
would need key handling. The TUI keeps them core-owned too, and draws them itself:

- **The palette** is a centred `Modal` over dimmed content, a `Field` on the first line, `Rows` of
  results below, the same `kit/lib/paletteModel.ts` behind it. Opened by the command chord, dismissed by
  Escape, owns the key layer while open ([05-keys-and-focus.md](./05-keys-and-focus.md) § Traps).
- **The overlay stack** is a list of open modals, topmost owning the layer. Notifications
  (`client-core/src/features/notifications/`) draw as one-line `Alert`s above the footer, dismiss on a key or
  a timeout, and never take focus.
- **The pane row** (`tasks/TaskPaneHost.tsx` today) is one line of pane labels under the topbar,
  `Tabs`-shaped, until client-plugins phase 1 gives it a contract.
- **The footer** is the active bindings, as Textual does, read from the keymap
  ([05-keys-and-focus.md](./05-keys-and-focus.md) § The footer). While a PTY is entered it says
  `esc leave · esc esc send escape`.
- **The drawer** is the terminal plugin's slot on the desktop. On the TUI the drawer's sources are the
  rows under the rail's rule, and choosing one opens the PTY as the pane, because a terminal inside a
  terminal inside a drawer is one level too many.

## Navigation

- `Tab` and `Shift+Tab` cycle regions: rail, pane row, pane, footer help. The region chords at layer
  5 are the same ones the desktop uses.
- In the rail, `j`/`k` (or arrows) move, `Enter` opens the task, `w` switches workspace through a
  `Menu`.
- The command chord opens the palette from anywhere except an entered PTY.
- `?` opens the cheat sheet; `q` at the rail quits, with a confirm if the TUI started the node.

## What this file does not decide

- Mouse support. If it comes it clicks to focus and scrolls collections, and nothing else.
- Themes for the chrome beyond the 16-slot mapping in
  [04-rendering.md](./04-rendering.md) § Roles as cells.
- Replacing the palette. Refused upstream; refused here.
