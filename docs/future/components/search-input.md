# SearchInput

The filter/search input, in its two house shapes: the boxed filter that narrows a list in place,
and the borderless underline input that heads a palette or popover. shadcn/Bootstrap treat this as
just an input; acorn shouldn't need much more — but today there are **seven bespoke filter-input
rules**, three of them byte-identical, and one plugin ships a filter class that is dead in its own
runtime.

## Today

Borderless palette-style (border 0, bottom divider, no outline):

- `.palette-input` (`palette.css:3-13` — CommandPalette, WorkspacePalette, editor's FilePalette)
- `.repo-picker-filter` (`topbar.css:124-134` — inside Picker)
- `.finder-input` (`overlays.css:88-97` — github's file finder)

Boxed filter-style:

- `.pr-filter` (`pull-list.css:36` — github's PR list, ALSO reused as a form title field at
  `CreatePullForm.tsx:132`, and referenced by the database frame at `DatabasePanel.tsx:217` where
  the class is **not even served** — a dead style)
- `.docker-search` ×2 (`docker.css:12-22`), `.notes-filter` (`notes.css:4` — hand-copies
  `.ui-input`'s tokens), `.search-input` (`search.css:20-30`), `.http-tree` filter absent but
  `.db-filter` present (`database.css:74-77`)
- `.diff-find-input` (`diff.css`), `.shortcut-input` (chord capture, `settings.css:93`)

## Proposal

Not a new component — **two variants on the existing `Input`**:

```tsx
<Input kind="filter" … />    // boxed, sm, search affordance; today's .pr-filter/.docker-search
<Input kind="bare" … />      // borderless underline; today's .palette-input family
```

Implementation: a `kind` prop on `Input` emitting `data-kind`, plus two rule blocks in
`primitives.css`. Optionally a `SearchInput` wrapper that adds `type="search"`,
`role="searchbox"`, a leading Icon slot and a clear (×) button — but only the clear button is
actually missing anywhere today, and only the docker logs bar would use it. Start with the
variants; add the wrapper if two consumers want the clear affordance.

## How to build it

- Extend `Input` in `packages/client-core/src/ui/primitives.tsx` (it already splits
  size/invalid/width — `kind` joins that list); CSS beside `.ui-input` in `styles/primitives.css`
  (frame-served, which fixes database's dead `.pr-filter` reference for free).
- The `bare` variant's rules come from `.palette-input` verbatim so palettes migrate with zero
  visual change.
- `adoption.test.ts` note: `class="ui-input"` hand-written is already the tracked anti-pattern;
  these variants remove the main *reason* sites hand-rolled (needing a different look).

## Refactors

- database: `DatabasePanel.tsx:217` — immediate correctness fix (currently unstyled in-frame).
- notes' `.notes-filter` (delete the token-copy rule), docker's two, editor's `.search-input`,
  github's `.pr-filter` list usage.
- github `CreatePullForm.tsx:132` — the PR *title* field is not a filter; it becomes a plain
  `Input` (misuse worth fixing on contact).
- Palette family (`.palette-input`, `.finder-input`, `.repo-picker-filter`) → `kind="bare"` as
  part of [palette-surface.md](./palette-surface.md) and Picker maintenance.
- `.shortcut-input` stays bespoke — chord capture is its own control.

## Notes

- Keyboard affordance: filter inputs that drive a list below should wire ArrowDown into the list
  (the palettes already do via `createOverlayPalette`); that stays the caller's job — this is a
  styling seam, not a behaviour component.
