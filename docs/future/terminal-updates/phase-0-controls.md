# Phase 0: every control is a stop

Design, 2026-09-02. Not started. Depends on nothing. Every later phase assumes this one has landed,
because there is no point routing focus to controls that cannot be pressed.

## Goal

Every kit node whose focus role is `stop`, `collection`, or `conditional` with a handler is
focusable on this host, is drawn so a reader can see it has focus, and calls its handler on
`activate`. `Composer` submits on `commit`. `Select`, `Picker`, and `Menu` open a list a reader can
drive. After this phase the pull-request pane's merge, close, comment, approve, and label controls
work from the keyboard, and the agents composer sends.

## Why

[analysis.md](./analysis.md) finding 1. The asking half of the kit draws its characters and wires
nothing. Three tables (`focusRoles.ts`, `support.ts`, and the 80 by 24 appendix in `docs/ui-design.md`)
already say what these nodes do; this phase makes the code agree with the tables rather than the
tables agree with the code.

## Requirements

Numbered so the tests can cite them.

1. A new helper, `apps/tui/src/keys/stops.ts` (new), exports `pressable(box, options)`. It sets
   `box.focusable = true` unless `options.disabled()` is true, registers one layer at priority 40 in
   `focus` target mode binding every `activate` key to `options.onPress`, adds `onMouseDown` that
   focuses through `focusRenderable` and then presses, and cleans up with the owner. It returns
   nothing. Priority 40 is the collection tier: a stop and a collection are both "the thing that has
   the keys", and the two never both have focus.
2. A focused control draws its focus. `pressable` exposes `focused(): boolean` read off
   `focusedRenderable()`, and each node draws its bracketed form in the `accent` tone with the
   `strong` role while focused. This is the caret's equivalent for a control, and it is the only
   thing that changes in the characters.
3. `Button` and `ConfirmButton` call `pressable` with `onPress`. `ConfirmButton` keeps its armed
   state through the shared `createArmedConfirm`; the second press confirms. `CopyButton` gets both
   for free because it draws a `Button`.
4. `Link` becomes a `box` holding its `text`, and is `pressable` with `onPress`. With `href` and no
   `onPress`, pressing prints the URL on the line below, which is what this host already does with a
   link it cannot open.
5. `Checkbox` and `ToggleButton` are `pressable`; press toggles through `onChange` or
   `onPressedChange`. Space and Enter both activate because both are `activate` keys.
6. `Chip` is `pressable` when it has `onPress` or `onRemove`. `activate` runs `onPress`; the `delete`
   intent runs `onRemove`. A chip with neither is text, as `conditional` says.
7. `Fold` is `pressable` on its header row; press toggles. Its children stay in reading order after
   it, so `↓` from an open fold's header enters its first child.
8. `Card` and `TableRow` are `pressable` only when given `onPress`.
9. `SegmentedControl` is a horizontal collection over its options through `createCellCollection`
   with `orientation: 'horizontal'`, so `←`/`→` change the value and `onChange` fires on move. One
   stop from outside, as `focusRoles.ts` says.
10. `Menu`'s trigger is `pressable`; press toggles open. `MenuList` draws its items as a `Rows`
    collection so `↓`/`↑` move and `activate` runs the item's `onSelect` and closes. The trap stays.
    `Select` and `Picker` inherit the behaviour because they draw a `Menu`. `Select` calls `onChange`
    with the chosen value. `Picker`'s filter `Input` takes focus when the menu opens, and `↓` from
    it enters the rows.
11. `Composer` binds `commit` on its `Textarea` at priority 40 and calls `onSubmit(value)` with the
    textarea's text. Its submit `Button` is `pressable` and does the same. `busy` and `disabled`
    refuse both.
12. `Textarea` gains `onSubmit?: (value: string) => void` on this host only if the shared prop type
    lacks it; check `packages/client-core/src/kit/components/primitives.tsx` first and use the
    shared type if it is there.
13. `MentionTextarea` and `PickerRow` suggestions: a `PickerRow` inside a suggestions list is an item
    of a `Rows`, so `↓` from the textarea enters the list and `activate` runs `onSelect`. The list
    closes when the textarea's word no longer matches.
14. `KeyValueEditor` needs nothing new: its cells are `Input`s and `Checkbox`es, which are stops
    after this phase.
15. `Rectangle`'s `pty` box stays as it is. It already realises the stop contract with its own
    intercept.
16. The footer's `activate` hint reads `press` on a plain stop and `open` on a row. That is one
    conditional in `apps/tui/src/chrome/bindings.ts` reading whether the focused renderable is an
    item. The fuller footer work is phase 6.

## Design notes

**Priority 40, focus mode, not focus-within.** A `Button` inside a `Row` must not answer Enter that
belongs to the row. `focus` mode binds to the exact renderable, and a row's collection layer is
`focus-within` on the container, so Enter on a row reaches the row and Enter on a button inside a row
reaches the button. This is the same split `collectionIntents.ts` § `onItem` draws on the DOM.

**Disabled is not focusable.** A disabled button is skipped by `↓` and by region entry. The DOM does
the same with `disabled` attributes. A reader should not land on something that will not press.

**Where pressed state shows.** `Button` already draws `strong` for `pressed` and `armed`. Focus uses
the same role in the `accent` tone. A focused armed button is `accent` and reads `[Delete?]`.

**One layer per control.** A pane with forty buttons registers forty layers. `@opentui/keymap`
handles that today for forty rows, and the engine's dispatch is by focused target, not by scanning
layers. If a measurement shows otherwise, the fallback is one global layer at 40 that reads
`focusedRenderable()` and looks up a `WeakMap<Renderable, () => void>` of presses, which is the shape
`collection.ts` already uses for rows. Start with the simple one.

**Do not touch `Row`.** Rows are items and their press already goes through the collection. The
helper is for nodes that are stops of their own.

## Files

Hints, verify before editing:

- `apps/tui/src/kit/asking.tsx`: `Button`, `ConfirmButton`, `Checkbox`, `ToggleButton`,
  `SegmentedControl`, `Select`, `Picker`, `PickerRow`, `Composer`, `MentionTextarea`, `CopyButton`.
- `apps/tui/src/kit/showing.tsx`: `Link`, `Chip`, `TableRow`.
- `apps/tui/src/kit/grouping.tsx`: `Fold`, `Card`, `Menu`, `MenuList`, `Menu.Item`.
- `apps/tui/src/keys/stops.ts` (new): `pressable`.
- `apps/tui/src/keys/collection.ts`: nothing, unless `SegmentedControl` needs `orientation` passed
  through `CellCollectionOptions`, which it should already accept.
- `apps/tui/src/chrome/bindings.ts`: the `press`/`open` word.

## Tests

- `apps/tui/src/kit/kit.test.tsx` gains one behaviour case per node in requirements 3 to 11: render
  the node inside a region, enter the region, press `RETURN` (and `SPACE` for `Checkbox`), assert
  the handler was called once and the frame shows the focused form. For `Select`: press, assert the
  list is on screen, `ARROW_DOWN`, `RETURN`, assert `onChange` got the second value and the list is
  gone. For `Composer`: type into the textarea, press `RETURN` with `ctrl`, assert `onSubmit` got the
  text.
- A coverage test in the same file: for every node in `NODE_FOCUS` with role `stop`, `collection`,
  or `conditional`, a behaviour case exists by name. The table cannot gain a stop that this host does
  not press.
- `apps/tui/src/panes.test.tsx` or a new `apps/tui/src/controls.test.tsx` (new): open the `pr` pane
  at 100 by 32, Tab to the pane strip, `ARROW_DOWN` into the PR strip, `ARROW_DOWN` again, assert the
  caret is on a control in the Details panel (the frame shows a bracketed control in the accent
  tone and `focusedRegion()` is the pane), press `RETURN`, assert the fixture transport recorded the
  request the control makes. The fixture in `apps/tui/src/fixture.ts` records requests; check its
  shape before writing the assertion.
- Agents: `ACORN_FIXTURE_DELAY_MS` on, open the `agents` pane, reach the composer, type, `ctrl+RETURN`,
  assert the send request was recorded.

## Acceptance

- Requirements 1 to 16 hold and every test above passes on a Node with FFI.
- `pnpm lint` and `pnpm --filter @acorn/tui test` are green.
- No `queueMicrotask` was added. Phase 1 removes them; this phase must not add one.
- The 80 by 24 appendix in `docs/ui-design.md` is unchanged, because the characters did not change
  except for the focused form, which the appendix does not draw.

## Not in this phase

- Where `↓` goes from a strip once panels hold stops (phase 2 decides; today's `focusStops` walk
  already finds focusable children, so the behaviour improves on its own).
- Nested Escape (phase 1 and 2).
- Footer words beyond `press`/`open` (phase 6).

## Doc moves when it ships

`docs/tui.md` § Rendering gains one paragraph naming `pressable` as the host's realisation of a stop,
beside the existing paragraph on `Rows`. `docs/ui-design.md` needs no change. This file shrinks to a
pointer.
