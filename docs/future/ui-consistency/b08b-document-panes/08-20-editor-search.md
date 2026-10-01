# 08-20. Editor search: a field with no inset, tiny toggles, and paths in capitals

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The editor's search field and its **Aa**, **\b**, and **.\*** toggles sit flush on the column edges,
because the tab panel has no inset. The toggles are 14 by 11 bare text buttons. Each result group is a
`Section` whose label is a file path, so it takes the uppercase label treatment:
"SRC/PKG-06/MODULE-0006.TS". In one column, text starts at five different insets.

## Where to see it

**Review changed files** › **Editor** pane › the search tab in its sidebar. Search for something that
matches.

## Already done

- K2 made `sub` headers static, and the Search panel's file sections (group level, `sticky`) still
  stick.

## The fix

In `plugins/editor/src/client/search/SearchPanel.tsx:65-125`:

- Keep the stacked layout; its comment explains the narrow sidebar.
- Give it the pane inset: two sm strips, the field and then the toggles.
- The toggles take the find bar's `ToggleButton` shape, with tips.
- Result groups use `SectionHeader level="sub"`, so paths keep their case.
- The status line is a `Text` inside the same inset.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `SearchPanel.tsx:73` | Search in files… | Keep | |
| `SearchPanel.tsx:81-83` | Match case / Whole word / Use regular expression (`title`) | Keep | As `tip`. |
| `SearchPanel.tsx:62` | results truncated | Rewrite | Showing the first results. Narrow your search to see more. |

The `:62` wording is the plan's overrule: the client does not know the cap, so it cannot say "the first
{n}". `:86` is done by 08-15 (shipped in B08a).

## Risk and checks

- Before you start, check the Search panel is the only `sticky` caller left. K2 relied on that.
- Moving result groups to `sub` makes them static. Decide whether the file name should still stick; if
  so, pass `sticky`.
- Screens: search empty and with results.
- Tests: `plugins/editor`.
