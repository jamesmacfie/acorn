# Phase 4: the shell's keyboard contract

Design, 2026-09-02. Not started. Depends on phase 1 (the topology and the settle pass). Phases 2 and
3 are independent of it.

## Goal

The shell states its keyboard contract in one place, the topology it hands the keys module, and the
Rail and Shell components stop making focus decisions in effects. Enter on a rail row opens and
enters; Escape from main comes home by a declared path; a workspace or project switch lands focus
through the settle pass; a descriptor source's list can be filtered. The behaviour a reader sees is
what `docs/tui.md` § Navigation already promises, with the races removed.

## Why

[analysis.md](./analysis.md) findings 2 and 3 as they show in `chrome/`. `Rail.tsx` holds a
`defaultedWorkspace` effect that picks the first source, a `menuOpens()` derivation that decides
which panel opens the screen, and `sourcesReady()` that holds the Menu empty until two queries have
answered so the caret does not land on a row that is about to move. `Shell.tsx` and the overlays call
`takeFocus` with microtask restores. Each is right and each is a focus decision made where the
component happens to be, which phase 1's settle pass exists to replace.

## Requirements

1. `chrome/topology.ts` (new) builds the `Topology` phase 1 defined, from the shell model:
   - `home`: a `chrome/source` region goes to `chrome/browse` if Browse has a list, else
     `chrome/menu`; a task pane's region goes to `chrome/panes`; `chrome/panes` goes to
     `chrome/tasks`; a rail region returns null.
   - `opensOn`: `chrome/tasks` when the session opened with an explicit task and no source,
     else `chrome/menu`.
   It is the only file in `chrome/` that names region ids as strings other than at the
   `regionFocus` call that declares them.
2. The Rail's default-source choice moves into `chrome/model.ts` as a derived signal,
   `defaultSource()`, computed from the same gates (`integrations.data`, `scope().providers`,
   `scope().linked`) and written to `setSelectedSource` by one effect in the model, keyed by
   workspace id. The Rail reads `selectedSource()` and draws. No effect in `Rail.tsx` writes focus or
   selection.
3. `sourcesReady()` stays as the gate on drawing the Menu list. It is a rendering decision, not a
   focus one, and the reason beside it is still true.
4. Enter on a Menu, Browse, or Tasks row: the row's `onActivate` runs, then `moveColumn(1)` if the
   region declares `enterMainOnActivate`. Unchanged; confirm the capture-before-activate order in
   `keys/collection.ts` survives phase 1.
5. Escape from main: `moveBack` → `parentOf` → `topology.home`. From a source detail it reaches
   Browse in `depth + 1` presses. From a task pane it reaches the strip, then Tasks. Unchanged in
   behaviour; the path is now declared in requirement 1 rather than found in `regions.ts`.
6. Workspace switch (`chooseWorkspace`): clears task and source, sets the workspace, and calls
   `scheduleSettle()`. The settle's step 1 finds the focused Menu row destroyed and re-enters Menu
   by the entry rule, which lands on the first row and, because Menu declares `pickOnEnter`, selects
   it. `workspaceFocus.test.tsx` passes with the `for` loop that waits on `selectedSource()` replaced
   by a single `until`.
7. Project switch (`chooseProject`): navigates; the routing effects do the rest; `scheduleSettle()`
   is called in case the Browse list was replaced. Focus returns to where it was if that renderable
   survived, else re-enters its region by identity.
8. Overlays: `takeFocus(box)` records `previous` synchronously and schedules a settle; on cleanup it
   records `restoring` and schedules a settle. Step 4 of the settle does the landing and the restore.
   The two microtasks in `takeFocus` are gone.
9. The descriptor source panel (`apps/tui/src/plugins/SourcePanel.tsx`) gains a title filter: the
   `search` intent (`/`) focuses a filter `Input` above the rows, typing filters `readRailItems` by
   title, Escape from the field returns to the rows, and `↓` from the field enters the rows. The
   filter is per source and resets when the source changes. This is the first of the three omissions
   `docs/tui.md` § A descriptor source's list names, and the one it says to add first.
10. `q`, `w`, `p`, `?`, `ctrl+k`, and `ctrl+b` are unchanged.
11. The quit confirmation, the two pickers, the palette, and the trust prompt are unchanged in
    behaviour. The palette keeps its own cursor and `overlayKeys`.

## Design notes

**Why a topology file and not more `regionFocus` options.** `home` is a relation between regions,
and no single region can declare it. `opensOn` depends on how the session started. Both are the
shell's, both are one function each, and both were previously spread between `Rail.tsx`,
`Shell.tsx`, and literals in `regions.ts`.

**Why the default source moves to the model.** Two components used to agree about "the first
source" only because one waited for the other. A derived signal in the model is one truth both
read, and the Rail becomes a component that draws.

**What a reader notices.** Nothing new on the screen. The `w` switch lands on the first source with
the caret on it every time rather than most times; Escape from deep in a detail takes the same
number of presses it did; `/` in a Linear list filters it.

## Files

- `apps/tui/src/chrome/topology.ts` (new).
- `apps/tui/src/chrome/model.ts`: `defaultSource`.
- `apps/tui/src/chrome/Rail.tsx`: delete the defaulting effect and `menuOpens`; declare regions.
- `apps/tui/src/chrome/Shell.tsx`: `setTopology`; `SourceRegion` unchanged.
- `apps/tui/src/keys/regions.ts` § `takeFocus`: the two microtasks become settle steps (phase 1
  may already have done this; if so this phase only confirms).
- `apps/tui/src/plugins/SourcePanel.tsx`: the filter.
- `apps/tui/src/chrome/routing.ts`: `chooseProject` schedules a settle.

## Tests

- `chrome/chrome.test.tsx`: existing cases unchanged. Add: `w`, choose the second workspace, assert
  in one `until` that the caret is on the first Menu row and `focusedRegion()` is `menu`.
- `workspaceFocus.test.tsx`: the polling loop is deleted.
- `spatial.test.tsx`: unchanged.
- A SourcePanel case in `apps/tui/src/plugins/plugins.test.tsx` or `browse.test.tsx`: select the
  Linear fixture source, `/`, type part of a title, assert the rows filtered, `ESCAPE`, assert focus
  on the first remaining row.

## Acceptance

- Requirements 1 to 11 hold.
- `Rail.tsx` contains no `createEffect` that writes a signal. `regions.ts` contains no string
  literal region id.
- `pnpm lint` and `pnpm --filter @acorn/tui test` are green.

## Doc moves when it ships

`docs/tui.md` § Navigation is rewritten from requirement 1 and [focus-model.md](./focus-model.md)
§ The five key groups, row Back. `docs/tui.md` § A descriptor source's list drops the filter from
its list of omissions. This file shrinks to a pointer.
