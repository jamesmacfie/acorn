# Tidy the Apps pane list and card rows

Date: October 29, 2026. Status: proposed. Implementation not started.

An agent-built app looks wrong in the Apps pane in two ways. The list row beside it runs to five or
six lines because it prints the app's whole description. And the app itself comes out ragged: a row
of cards sits at uneven heights and widths, so a simple command app looks like a pile of boxes
rather than a grid.

Both come from Acorn's defaults, not from the app. The app that showed it, a set of buttons for the
`runn` command-line tool, follows the guide exactly. [Agent-built apps](../agent-built-apps.md) owns
the library's rules and wins if this plan disagrees. That page changes when this lands.

## Starting point

Checked against main at `6cbe5e034`.

- `AppList` in `plugins/trellis/src/client/AppsPane.tsx` draws each app as a stacked `Row` with up
  to four lines in its body: the name, the description with `wrap`, a "Draft of" line for drafts,
  and "Changed 7d ago". `meta` holds the version, `v1`.
- The other list panes keep a row to two lines. The memory list
  (`plugins/memory/src/client/MemoryCenter.tsx`) shows the name and one muted line cut off at the
  row's width, puts the relative time in `meta`, and gives the row a `title` for the tooltip. The
  agents sidebar (`plugins/agents/src/client/sessions/AgentTaskSidebar.tsx`) does the same with
  `density="compact"`.
- In the app renderer, `StackBinding` in `plugins/trellis/src/embed/bindings.tsx` draws a row
  `Stack` as `<Inline wrap>`. The kit's `.ui-inline` rule sets `align-items: center`, so each card
  is centred on its line. A short card sits lower than the tall one beside it.
- `CardBinding` passes `fit` to every `Card` inside a row, so each card is as wide as its content.
  That's on purpose and written down twice: in the library's `Stack` description in
  `plugins/trellis/src/shared/library.ts`, and in [agent-built apps](../agent-built-apps.md). Cards
  of different content end up different widths, and a wrapped line leaves a ragged right edge.
- The kit already has the layout this needs. `Inline even` is a grid of equal columns, each at least
  about 12rem, aligned to the top, with every card stretched to the row's height. A narrow window
  drops them onto their own lines.

## The design

### Keep each app row to two lines

Change the row in `AppList` to the memory list's shape:

1. Keep the name as the first line.
2. Show the description as one muted line, without `wrap`, so the row cuts it off at its width.
3. Set the row's `title` to the full description, so it shows on hover.
4. Move "Changed 7d ago" into `meta`, after the version: `v1 · 7d ago`.
5. Keep the "Draft of" line, only for drafts. It's rare, and it tells you which app a draft
   replaces.

Leave the density at the default. The memory list, the closest match, uses the default.

### Lay out a row of cards as equal columns

In `StackBinding`, when a row `Stack` holds only `Card`s, draw `<Inline even>` instead of
`<Inline wrap>`. Read each child's `typeName`, the way the `Select` binding already reads its
`SelectItem`s. In that case don't pass `fit` to the cards, because a card in an equal column fills
its column.

A row that holds anything else keeps `<Inline wrap>` and content-width cards. A row of buttons must
stay as it is. Under `even`, each button would stretch to fill a column at least 12rem wide.

Then update the sentence about cards in a row in both places. The library's `Stack` description is
part of the prompt agents read, so it must say what happens: a row of only cards becomes equal
columns that wrap on a narrow pane, and a card in a mixed row is as wide as its content. The change
doesn't touch any prop, so `LIBRARY_VERSION` stays the same.

## Out of scope

- The pane's "Version 1" label. It comes from the `Section` around the app, and the kit always draws
  a section's header. The section has to stay, because the shell caps a section beside a transcript
  at 40% of the column, which keeps the editing conversation visible.
- Anything inside a given app's program. The `runn` app's own heading repeats the toolbar's title,
  and its second line ends in "runn-05ea41 ·" because `task.branch` is null on the main task. An
  "Edit with agent" pass fixes those in the app.
- A general `align-items: start` for every wrapped `Inline` in the kit. Other panes depend on
  centred inline content, such as a button next to text.

## Acceptance

1. The `runn` app's row in the Apps pane is two lines tall: the name, and the start of the
   description. Hovering the row shows the full description. The meta reads `v1 · 7d ago`.
2. A draft's row shows its "Draft of" line as a third line.
3. In the `runn` app, the "Stack" and "One service" cards are the same height, start at the same
   top edge, and split the row's width evenly. The same holds for "Database and codegen" and
   "Open".
4. With the pane narrowed until a card would be under 12rem, the cards drop onto their own lines,
   full width.
5. A row of only buttons, such as the buttons inside the "Stack" card, still sits on one line at
   content width.
6. An app with a row of small stat cards still reads well in each place an app draws: the Apps
   pane, the chat card, a project's apps, and a dashboard cell. Check one before merging, because
   this changes every app that already puts cards in a row.
7. A unit test in the trellis plugin covers a row of only cards drawing as `even` and a mixed row
   keeping `wrap`.
