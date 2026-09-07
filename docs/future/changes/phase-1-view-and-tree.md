# Phase 1: the view menu and the tree

Status: not started. Waits on phase 0.

## Goal

A sliders button in the header opens a menu with three sections: View, List or Tree; Sort by, Path or
Name, shown in list view only; Group by, None, Tracked and untracked, or Staged and unstaged. The
choice is remembered per device. Tree view nests rows under folders, collapses single-child folder
chains into one row, and gives every folder a tri-state checkbox that stages or unstages everything
under it in one call.

## Why this phase, and why now

The flat list is fine for ten files and unreadable for eighty, which is what an agent's task often
produces. Grouping by staged and unstaged is what the pane draws today and some readers will want it
back. Both are pure functions over the rows phase 0 produces, so this is the cheapest phase to land
and the one with the most tests per line.

## Scope

In:

- `view` on the model, a persisted-state slice `changes:view` with the shape in
  [03-anatomy.md](./03-anatomy.md) § The client model, listed in `DEVICE_KEYS` in
  `packages/client-core/src/infra/persistence/devicePrefs.ts` because it is about the person and not
  about a node's resources.
- The menu: `Button iconOnly opens="menu"` as a `Menu` trigger; three sections of checked items
  through the menu's context; the sort section hidden in tree view.
- `buildTree(changes, view)` in `plugins/changes/src/client/model.ts`: paths to a folder tree,
  single-child chains collapsed, folders first then files, sorted per the view.
- `Rows tree` with `TreeRow` for folders and the phase 0 row for files, `depth` from the tree.
- Folder checkbox: tri-state from its descendants; toggling calls `stage(paths)` or
  `unstage(paths)` over the descendant files that need it.
- Group by none: one group, no fold header. Group by staged and unstaged: two folds, and the file
  checkbox is redundant in that grouping so it stays but reads as the row's state.
- Expanded folders remembered in the session through `Rows`'s own collection state; not persisted.

Out: filtering by name, a find field in the list. The palette's find-in-changes command covers the
diff, and a list filter is a knob nobody has asked for.

## Design detail

**The tree is a function, not a component.** `buildTree` returns `{ key, kind: 'folder' | 'file',
label, path, depth, children, change? }` and the list maps it to rows. A collapsed chain
(`apps/tui/src` in Zed's screenshot) is a folder node whose label is the joined path, and its `path`
is the deepest folder, which is what the checkbox stages.

**Sort in list view only.** Zed hides the sort section in tree view and so does this: a tree is sorted
by its folders, and a name sort under a folder is the only order that makes sense there.

**Checkbox state is derived, never stored.** A folder is checked when every descendant file is
staged, unchecked when none is, indeterminate otherwise. A file staged and then edited again counts as
indeterminate for its folders. Nothing writes a "checked" flag anywhere; the status resource is the
truth and the checkbox is a view of it.

**Group by staged and unstaged is the old pane.** The staged group's checkboxes are all checked and
the unstaged group's all unchecked, by construction. The fold checkbox is then Stage all for the
unstaged group and Unstage all for the staged group, which is what the old `++` and `−−` did.

**The device pref write order matters.** Write `localStorage` before touching the query cache, or
`mergePrefs` discards the value on the next read (`packages/client-core/src/infra/persistence/devicePrefs.ts`
has the reason). Use `savePref` from `packages/client-core/src/features/settings/savePref.ts`, which knows.

## Code touched

- `plugins/changes/src/client/model.ts`: `buildTree`, `folderState`, `sortChanges`, `groupBy`.
- `plugins/changes/src/client/changesModel.tsx`: `view` and its setter.
- `plugins/changes/src/client/ChangesPane.tsx`: the menu and the tree branch of the list.
- `plugins/changes/src/client/index.ts`: the `changes:view` persisted slice registered through
  `ctx.persistedState`, with a parser that tolerates any older shape by falling back to the default.
- `packages/client-core/src/infra/persistence/devicePrefs.ts`: `changes:view` in `DEVICE_KEYS`.

## Tests

- `model.test.ts`: `buildTree` over `['a/b/c.ts', 'a/b/d.ts', 'e.ts']` gives one collapsed folder
  `a/b` with two files and one root file; folders sort before files; `sort: 'name'` orders files by
  basename across folders in list view; a rename keeps `oldPath`.
- `model.test.ts`: `folderState` is checked, unchecked, and indeterminate for the three fixtures, and
  a staged-then-edited file makes its folder indeterminate.
- `ChangesPane.test.tsx`: toggling an indeterminate folder calls `stage` with the unstaged
  descendants only; the sort section is absent in tree view; the menu's checked item follows `view`.
- `devicePrefs.test.ts` or its neighbour: `changes:view` is a device key.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 1 rows: `docs/state-ownership.md` § Scope rules.

## Doors left open

- A list filter field would be a `FindBar` in the header and a predicate in `buildTree`. Not built.
- The tree builder is generic enough for the editor pane's file tree; it is not moved there until a
  second consumer asks.

## Done when

- Switching to tree view nests eighty files under their folders in under a frame, and toggling a
  folder stages everything under it with one round trip.
- The view survives a relaunch and does not follow the person to another device.
- `pnpm lint`, the changes plugin's tests, and the arch suite are green.

## Verify before building

- Phase 0 has shipped: `stage` takes `paths` and rows have a `Checkbox`.
- `packages/client-core/src/kit/components/layout/Rows.tsx` still takes `tree` and `onExpand`, and
  `packages/client-core/src/kit/components/primitives.tsx` still exports `TreeRow` with `depth`, `expandable`,
  and `onToggle`.
- `packages/client-core/src/kit/components/overlays/Menu.tsx` still hands its children a context with `close` and
  `register`.
- `DEVICE_KEYS` in `packages/client-core/src/infra/persistence/devicePrefs.ts` is still the one list that
  decides device versus node.
