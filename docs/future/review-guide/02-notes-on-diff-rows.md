# Phase 2: notes on diff rows

Date: October 30, 2026. Status: not started. Needs phase 1.

## Goal

A remote tree can pin a note under a line of a `StackedDiff`, drawn in the inline agent card's shape,
and can hear when the reader presses the ✦ button on any line. The guide uses both, so its notes sit on
their lines and every line offers the same ✦ as the pull request diff.

## Starting point

Checked against `main` at `e94c01050`. Recheck before you start.

- `StackedDiff` in `packages/client-core/src/kit/diff/DiffRows.tsx` takes `path`, `patch`, and
  `lineNumbers`. It draws read-only rows with `DiffLine` and takes no children and no events. The
  terminal's version is in `apps/tui/src/kit/showing/diffRows.tsx`.
- `DiffLine` already draws the ✦ button, `AskAgentButton`, when it's given `askAgent`. In the pull
  request diff it shows on hover, with the tip "Ask agent about this line"
  (`packages/client-core/src/infra/styles/diff.css`, `.diff-ask-btn`).
- The inline agent card is `InlineDiffCard` in `plugins/agents/src/client/inlineDiff/InlineDiffCard.tsx`.
  `DiffPane` draws it under its line inside `.diff-inline-chat`.
- A tree node's props are plain data, and a prop can't hold UI. A shell component's slot is spelled as
  a child node ([the tree contract](../../plugins/tree-contract.md#nodes)). Events come from the closed
  list `KIT_EVENTS` in `packages/protocol/src/tree/nodes.ts`. A prop starting with `on` that isn't on
  that list is dropped.
- Every kit node has a row in [every node at 80 by 24](../../ui-design/every-node.md), a level in
  `packages/client-core/src/kit/tokens/support.ts`, and an entry in both hosts' component tables.
  `tools/arch/kitTable.test.ts` fails if they disagree.

## In scope

### A `DiffNote` node

Add a kit node, `DiffNote`, that's valid only as a child of `StackedDiff`. Its props:

| Prop | What it holds |
| --- | --- |
| `side` | `old` or `new`. |
| `line` | The line number on that side. |
| `tone` | A role tone: `neutral`, `warn`, or `danger`. The guide maps Explains, Look closely, and Risk onto them. |
| `label` | The short tone word shown in the header, such as "Risk". |
| `author` | The name in the header, such as "Claude Code". |
| `title` | The one-line title, also shown when the note is folded. |

Its children are ordinary kit nodes: a `Markdown` body and a row of `Button`s. The plugin owns its
buttons, so the kit knows nothing about asking, revealing, or checking.

`StackedDiff` draws each `DiffNote` child under the row it names, in the order they arrive. A note
naming a line the patch doesn't have draws after the last row, with its line in the header, so a bad
anchor is visible instead of lost. Phase 1's check makes that rare.

A note folds to its header with a chevron, as the mockup shows. Keep the fold state in the kit, as
`Fold` does, keyed by the note's node ID.

Mark the noted row with a stripe in the note's tone, as the mockup's `.row.noted` does.

### The ✦ event

`StackedDiff` takes `onActivate`. When it's set, each line draws `AskAgentButton`, and pressing it
sends `{ side, line }`. Use `onActivate` from the existing event list instead of adding a new event.

### Looks

Draw the note with the inline agent card's spacing, border, and header: the ✦ mark, the author, then
the tone label. Reuse its classes where they fit, and add tone borders through role variables. No
color crosses the wire.

### The terminal client

Draw a note under its row, indented to the code column: one header line with ✦, the label, and the
title, then the children. The ✦ event has no hover in cells. Give the row a key instead, and pick it
with the [keymap rules](../../ui-design/interaction.md). A folded note is its header line only.

## Decide before you build

- Whether `DiffNote` should be usable under `DiffPane` too. Not in this phase. `DiffPane` is a compiled
  surface with its own line extras, and phase 5 reaches it through marks instead.
- Whether the guide should draw a hunk's notes folded when the hunk has more than one. The mockup draws
  them open. Check it on a long real guide.

## Tests

- A kit test for `StackedDiff` with notes: each note draws under its row, a note on a missing line
  draws last, the fold works, and `onActivate` sends `{ side, line }`.
- A tree test: a `DiffNote` outside `StackedDiff` is refused the way other misplaced nodes are.
- The terminal kit's test for the same tree. A note adds lines, so check that fixture rows in 24-row
  panels stay reachable.
- `pnpm --filter @acorn/arch-tests test` for the kit table and the published plugin surface snapshot.
- In the guide, `GuidePane.test.tsx`: each note draws as a `DiffNote` under its line, and the ✦ event
  reaches the plugin.
- A live check in `pnpm dev:agent` and in `pnpm dev:tui:agent`. The terminal agent session has no
  loaded plugins, so build the guide into its data root first.

## Docs

Add `DiffNote` to [every node at 80 by 24](../../ui-design/every-node.md) and update `StackedDiff`'s
row. Mention notes where [diff rendering](../../diff-rendering.md) introduces `StackedDiff`. Update
the pane description in [the review guide plugin](../../first-party-plugins/review-guide.md#the-pane).

## Done when

In the guide, each note sits under its line and looks like the inline agent card. Hovering any line
shows ✦, and pressing it reaches the guide's tree. The terminal client draws the same notes.
