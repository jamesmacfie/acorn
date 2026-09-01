# Phase 3: one kind of tab strip, and chords the terminal can press

Design, 2026-09-02. Not started. Depends on phase 1 (`markParent`). Small, and worth landing on its
own so Linear and Rollbar catch up with GitHub before phase 4 touches the shell.

## Goal

Every `Tabs` strip that has panels is a parent stop, whether the surface was written with `Sections`
or with `Tabs` and `TabPanel` as siblings. A strip with no panels is a plain stop. No binding in
`apps/tui/src` is spelled with `super+`.

## Why

[analysis.md](./analysis.md) findings 4 and 5. Two surfaces that look the same behave differently
because one passed a prop, and two layouts bind a chord macOS terminals never deliver.

## Requirements

1. `TabPanel` registers its box with the nearest `Tabs` that shares its `idPrefix`, through a
   module-level `Map<string, Set<Renderable>>` in `apps/tui/src/kit/grouping.tsx` keyed by `idPrefix`,
   written on mount and cleaned up on disposal. `Tabs` calls `markParent(strip, () => panels for its
   idPrefix)`. The `entry` prop is deleted from the host's `Tabs`; a strip is a parent when its panel
   set is non-empty at the time `enterParent` or `parentOf` asks.
2. `Sections` needs no change beyond dropping `entry`: it already draws `Tabs` and `TabPanel`s with
   one `idPrefix`.
3. The `tabs` layout (`apps/tui/src/layouts/Tabs.tsx`) draws its panel through `Panel`, not
   `TabPanel`. It registers the panel box under its `stateKey` the same way `TabPanel` does, so the
   strip is a parent of the framed panel.
4. GitHub's Open and Closed filter in its Browse list has no `TabPanel`, so it is a plain stop and
   the Browse region enters on its rows by the phase 1 entry rule. Confirm with the existing
   `browse.test.tsx` case.
5. Linear's issue view and Rollbar's item view (`plugins/linear/src/tree/LinearIssueView.tsx`,
   `plugins/rollbar/src/tree/RollbarItemView.tsx`) gain the strip-then-Down behaviour with no plugin
   change. Their `Toolbar` above the strip holds plain stops reachable with `↑` from the strip by
   phase 2's `moveStop`.
6. `DocumentTabs` (the editor's open files) is a horizontal collection: `←`/`→` choose, `activate`
   runs `onActivate`, `delete` runs `onClose` on the active tab. It is not a parent: the document
   below it is the layout's region, not the strip's panel.
7. `apps/tui/src/layouts/Tabs.tsx` binds `ctrl+1` through `ctrl+9`. `apps/tui/src/layouts/split.ts`
   binds `ctrl+shift+arrow` only. A new test asserts the string `super+` appears nowhere under
   `apps/tui/src` except `apps/tui/src/keys/commandLayer.ts` § `asCtrl`. This is invariant 7.
8. The `tabs` layout's chord and the strip's `←`/`→` agree: both call the same `setSelected`.

## Design notes

**Why `idPrefix` and not a context.** A Solid context would work for `Sections`, where `Tabs` and
`TabPanel` share a parent component, and fail for a plugin that draws them in two sibling components.
`idPrefix` is already required on both nodes for exactly this pairing on the DOM (it builds the
`aria-controls` ids), so it is the relation the kit already promises.

**Why a strip with no panels is not a parent.** Because `↓` from GitHub's Open/Closed filter must
reach the rows, and because a region must enter on its list rather than on a filter above it.
Both are rules `docs/tui.md` § Focus regions already states.

**The pane strip stays bespoke.** `chrome/PaneRow.tsx` draws a `Tabs` with `idPrefix="chrome.panes"`
and no `TabPanel`, so it is a plain stop by requirement 1 and `↓` keeps its `moveRegion(1)`. See
[refused.md](./refused.md) § Making `PaneStrip` a parent stop.

## Files

- `apps/tui/src/kit/grouping.tsx`: `Tabs`, `TabPanel`, `Sections`, `DocumentTabs`.
- `apps/tui/src/layouts/Tabs.tsx`, `apps/tui/src/layouts/split.ts`: chords and panel registration.
- `apps/tui/src/invariants.test.ts` (new, or the file phase 1 created): the `super+` grep.

## Tests

- `apps/tui/src/kit/kit.test.tsx`: `Tabs` with two `TabPanel`s: enter the region, assert focus on the
  strip, `ARROW_DOWN`, assert focus on a stop inside the active panel, `ESCAPE`, assert the strip.
  `Tabs` with no panels beside a `Rows`: enter the region, assert focus on the first row.
- A Linear fixture case in `apps/tui/src/panes.test.tsx` or `browse.test.tsx`: select the Linear
  source, enter main, assert the strip, `ARROW_DOWN`, assert a stop in the Description panel,
  `ARROW_UP` from the strip, assert the Refresh button.
- `layouts.test.tsx`: `ctrl+2` selects the second tab of a `tabs` pane.

## Acceptance

- Requirements 1 to 8 hold. `sections.test.tsx` passes unchanged.
- `pnpm lint` and `pnpm --filter @acorn/tui test` are green.

## Doc moves when it ships

`docs/tui.md` § Focus regions loses the sentence distinguishing structural from filter tabs and gains
"a strip with panels is a parent stop". `docs/command-palette-and-shortcuts.md` § Pane shortcuts,
the sentence about Cmd+1 through Cmd+9, gains "Ctrl on the terminal". This file shrinks to a pointer.
