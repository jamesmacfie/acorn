# Rendering: the kit on OpenTUI

## The one switch

`packages/client-core/src/kit/tokens/support.ts` exports `HOST: Host = 'dom'`, and `Only` and `Fallback`
are the only nodes that read it. `HOST` becomes a constant each host package supplies at build time;
the desktop says `dom`, the TUI says `tui`. Nothing else in the kit reads it, and that stays true: a
node that wants to know which host it is on is a node that is about to draw something host-specific,
and the answer is a `<Fallback>` child, not a branch.

## A second `KIT_COMPONENTS`

`packages/client-core/src/plugins/tree/components.ts` is the DOM host's table: one enumerated import
per `KitNodeName`, no wildcard, compound halves flattened. The TUI has its own table with the same
key type, and the same test that says the two lists are the kit and nothing else. Each entry is a Solid
component written against OpenTUI's renderables through `@opentui/solid`, so first-party panes, which
are Solid JSX against `@acorn/plugin-api/ui`, run in-process on the TUI exactly as they do on the
desktop, with a different component behind each name.

The spec for each component is already written. `docs/ui-design.md § Every node at 80 by 24` has one
sentence per node, and `tools/arch/kitTable.test.ts` fails if that table and the kit disagree about
which nodes exist. Phase 1 makes that test also read the TUI table, so a node cannot be added with a
sentence and no component, or a component and no sentence.

The four levels and what they mean once something reads them:

| Level | Count | Meaning on the TUI |
| --- | --- | --- |
| `full` | 52 | Drawn natively from its sentence. `Stack`, `Row`, `Badge`, `Button`, `Field`, `Fold`, `Timeline`, and the rest. |
| `reduced` | 14 | Drawn, with a stated loss. `Popover` opens as a full-width block under its anchor, not floating. `ListDetail` is one column below 80 cells. `Table` and `Grid` truncate columns to fit and say so in the header. `Markdown` drops images and renders links as text with the URL in dim. `DiffPane` has no side-by-side. `Spinner` is a braille cycle. `Icon` is the Lucide name's registered glyph or one character. `UserAvatar` is initials. `MentionTextarea` is a text field with `@` completion in a `Menu`. |
| `absent` | 3 | Not drawn. `SplitHandle` and `SplitCell`: a terminal split moves by a key, not a grip. `Rectangle`: the node is absent because the host draws `pty` and `editor` natively without going through it (below). |
| `fallback` | 1 | `CopyButton` draws its `<Fallback>` child, or nothing. A terminal cannot reach the clipboard portably; where the terminal advertises OSC 52 the button works and the level becomes `full` at runtime. |

A `reduced` node's loss is written next to its level in `support.ts` and in the 80×24 table, so a
plugin author reading either knows what to expect.

## Roles as cells

`roles.ts` maps each role value to a DOM custom property and to a terminal value, and `roleVar()` is
the DOM accessor. `roleCell()` is its sibling: it returns the OpenTUI style fragment for a role value
(a colour attribute, `dim`, `bold`, a box-drawing set, a blank-line count), and `'ignored'` returns
nothing. Six roles, the same enums: `space`, `size`, `tone`, `text`, `border`, `radius`. `radius` is
`ignored` throughout and `size` is one line throughout, which is honest.

Colour is the theme's 16 ANSI slots plus `dim` and `bold`. A theme's 40-odd tokens collapse to that
through one mapping owned by the appearance layer: `tone.accent` is the theme's accent slot,
`tone.ok`, `tone.warn`, `tone.danger` are green, yellow, red as the theme assigns them, `text.muted`
is `dim`. Where the terminal reports truecolor the theme's hex values are used directly; where it
reports 16 colours the slots are. Style packs are ignored except `density`, which decides whether
`Section` and `Card` spend a blank line.

## Layouts as projections

Eight names, seven components (`packages/protocol/src/paneLayouts.ts`; `document-over-frame` and
`frame-beside-document` are one component with the axis in the name). `docs/panes.md § Layout model`
has a terminal projection per layout, and phase 2 builds each from its projection:

- `single`: the region fills the pane.
- `list-detail`: two columns above 80 cells, one at a time below, a key switches groups. The split
  position is a session signal (`layouts/state.ts`) and moves by a key, not a drag.
- `header-body-footer`: one line, the rest, one line.
- `tabs`: the bar is one line, `Tab  [Tab]  Tab`; the current panel below; hidden panels never
  mount, the same thunk rule the DOM layout keeps.
- `document-over-frame` and `frame-beside-document`: the frame half is a rectangle and is absent,
  so the document half fills the pane and a footer line says what is missing.
- `stack-split`: regions on successive blocks with a rule between, the split moved by a key.
- `wizard`: one step at a time, the step count on the header line, the actions on the footer line.

`LayoutProps` and `Region` (`packages/client-core/src/layouts/regions.ts`) are host-neutral: a region
is a thunk that returns JSX, and on the TUI that JSX is kit components on OpenTUI. `layouts/state.ts`
is shared as-is. The DOM layouts' drag handling (`createSplitDrag`, `offsetWidth`) has no sibling.

## Rectangles

`Rectangle` is the kit's one admission of defeat: four kinds, `pty`, `webview`, `frame`, `editor`,
and the host draws the box and hands the caller an element (`packages/client-core/src/kit/components/Rectangle.tsx`).
On the TUI:

- `pty` is native. The terminal plugin's pane and docker's exec both mount a PTY through a
  `Rectangle`; on the TUI the rectangle is a region OpenTUI hands the PTY's bytes to directly, with
  the same Enter-to-enter, Escape-to-leave contract and the same `isTerminalTarget` rule in
  `keys/host.ts`. The TUI is drawing a terminal inside a terminal, and it does it with a real PTY
  attached to a real cell region, not xterm.js.
- `editor` is a read-only text view with search, and an action that hands the file to `$EDITOR` in a
  suspended TUI (the renderer releases the terminal, the editor runs, the renderer resumes). The
  editor plugin's file tree and search cross unchanged; Monaco does not.
- `webview` and `frame` draw the `<Fallback>` child, or a one-line placeholder naming what is
  missing and offering to open the URL with the system opener.

`Rectangle` itself is `absent` in `NODE_SUPPORT` because the TUI does not go through the node to draw
these; it recognises the kind and draws natively. The `rectangle` extension kind (a sibling region an
iframe fills, `docs/panes.md`) is absent entirely: no iframe, no pixels, a placeholder line.

## Unknown nodes and failed trees

The DOM host renders a labelled placeholder for a node type this build cannot draw
(`packages/client-core/src/plugins/tree/placeholder.tsx`), the same placeholder for a failed slot, and one error boundary per
tree. The TUI keeps all three, drawn as an `Alert` in `warn` tone. The forward-compatibility rule is
the same on both hosts: a new node name from a newer plugin renders as a placeholder and a roster
row, never as a crash.

## What the TUI never does

- Read the terminal width inside a node or a layout. Breakpoints are the renderer's. A layout asks
  "am I narrow" of its own region, as the DOM layout asks its own element.
- Draw a hover state. Hover is never load-bearing and a terminal has none.
- Accept `class`, `style`, or a DOM attribute. There is no DOM; the type-level test
  (`ui/kit/props.test-d.ts`) already refuses them and the tree protocol drops them on the wire.
- Invent a node. A pane that needs something the kit lacks asks the kit, and the kit answers for both
  hosts or refuses for both.
