# Phase 0: every control is a stop

Shipped 2026-09-02. Depends on nothing. Every later phase assumes this one has landed, because there
is no point routing focus to controls that cannot be pressed.

The requirements below are as designed, with the eight places the code and the design disagreed marked
`Changed:` and the reason beside each, per this folder's own rule. What a reader can and cannot do
after this phase is in [What landed](#what-landed) at the end. `docs/tui.md` §§ Rendering and The
adapter own the behaviour from here.

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
   nothing.

   Changed: the layer is at 41, not 40. The premise was that "a stop and a collection are both the
   thing that has the keys, and the two never both have focus". They do: a `Button` inside a `Row` is
   inside the row's `focus-within` layer as well as its own `focus` layer, so both match the same
   Enter, and at equal priority `@opentui/keymap` breaks the tie on registration order
   (`compareLayers`) — which is whichever of a container's ref and its children's refs the reconciler
   runs first. One above the collection makes the answer the same either way, and 41 is still below a
   `Tabs` strip at 45.

   Also added: `options.on`, a map of the other intents a stop answers, each saying whether it took
   the intent. `Chip`'s `delete` needs it (requirement 6), `SegmentedControl` and `Grid` route a whole
   collection through it (requirement 9), and phase 2 binds `next`/`prev` there.
2. A focused control draws its focus: its bracketed form in the `accent` tone with the `strong` role.
   This is the caret's equivalent for a control, and nothing else about the characters changes.

   Changed: `focused()` is not `pressable`'s, because requirement 1 has it return nothing and a `ref`
   callback cannot return a signal either way. The same module exports `stop(options)`, which returns
   `{ ref, focused }` and calls `pressable` for you; every node in the kit uses that one. The role and
   tone are one helper rather than a spread condition at twenty call sites: `litControl` in
   `apps/tui/src/kit/roles.ts`, which also folds in `strong` for a pressed or armed button and `muted`
   for a disabled one.

   Two nodes have no brackets to light. A focused `Card` draws its own frame in the accent tone, and
   its stripe column where compact density draws no frame. A focused `TableRow` draws `›` after its
   cells rather than before them: a table's columns line up across rows, and a caret cell in front of
   the first one would move every column of the focused row.
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
10. `Menu`'s trigger is `pressable`; press toggles open. `↓`/`↑` move in the open list and `activate`
    runs the item's `onSelect` and closes. The trap stays. `Select` and `Picker` inherit the behaviour
    because they draw a `Menu`. `Select` calls `onChange` with the chosen value. `Picker`'s filter
    `Input` takes focus when the menu opens, and `↓` from it enters the rows.

    Changed: `MenuList` does not draw a `Rows`, because it cannot. Its children are whatever opened
    it — a run of options, a filter field over a list of rows, a plugin's own nodes — and a `Rows`
    needs the items, while `MenuList` is handed a tree. So the list's items are ordinary stops and
    `MenuList` walks them: `moveStopIn(box, delta)` in `stops.ts` over `stopsIn`, at priority 36,
    above the trap's swallow at 35 and below a collection at 40 so a caller who did draw a real `Rows`
    inside a menu keeps its arrows. It binds twice. The bare letters `j` and `k` keep the typing gate,
    because `j` in a picker's filter is a `j`; the arrows lift it, because a list under a field is the
    only thing an arrow there could mean. That is the same exception the palette takes above the trap.

    Also changed: the trigger state gains `focused: () => boolean`, this host's addition to the shared
    `{ open, toggle }` pair. The box the keys are bound to is the menu's, so a trigger cannot work out
    for itself whether it has them. `Menu` also takes `disabled`, which `Select` and `Picker` pass.

    `Select`'s options are a local `Option` component rather than bare `Line`s, and `Picker`'s rows
    carry their own pick as a closure, because the two forms of `PickerProps` identify a row
    differently: the data form by `id` through `onPick`, the callback form by the caller's own opaque
    item through `onSelect`. `MenuList` also calls `takeFocus`, so the keys go into the open list and
    return to the trigger when it closes.
11. `Composer` binds `commit` on its `Textarea` and calls `onSubmit(value)` with the textarea's text.
    Its submit `Button` is `pressable` and does the same. `busy` and `disabled` refuse both, in one
    place: `send()`, which reads the buffer rather than the prop, so a caller who draws a composer
    without wiring `onInput` still sends what is in front of the reader.

    Changed, and it is the largest change in the phase: `commit` did not exist on this host. A legacy
    terminal sends one byte, `\r`, for Return with Ctrl held and Return without it, so `ctrl+return`
    never reached the engine as a chord — a probe against the real adapter confirmed it arrives as a
    plain `return`. `main.tsx` now asks for the kitty keyboard protocol's `disambiguate` flag, which is
    what makes the two distinguishable, and both test harnesses ask for the same protocol. A terminal
    that does not know the request ignores it. `docs/tui.md` § The adapter owns this.

    Also added: `MentionTextarea` passes `onSubmit` through to the same binding. The agents composer is
    a `MentionTextarea` rather than a `Composer` and wants the same send; the shared prop calls it
    "Enter without a modifier", which is the DOM's chat-style Enter, and in a terminal Enter in a text
    field is a newline and nothing else can be.
12. `Textarea` gains `onSubmit?: (value: string) => void`. The shared `TextareaProps` in
    `packages/client-core/src/kit/components/primitives.tsx` has no submit at all — on the DOM a
    composer's Enter is a `keydown` the caller reads — so this is the host's, with the reason written
    beside it. Its `ref` prop is also called now, having been decorative: a `Composer` reads the
    buffer's text when its submit button is pressed and there is no other way to ask.
13. `MentionTextarea` and `PickerRow` suggestions: `↓` from the textarea enters the list and
    `activate` runs `onSelect`, which completes the word being typed. The list closes when the
    textarea's word no longer matches.

    Changed: a suggestion is a stop rather than an item of a `Rows`, for requirement 10's reason. And
    the `↓` that reaches it is the one arrow key in the kit bound past the typing gate, through a new
    `whileTyping` option on `bindKeys`. The shape is what earns it: the field is the typing target and
    the list under it is the field's own, so `↓` cannot mean "type a ↓" and there is nothing else for
    it to reach. Completing splices by replacing the trailing word, where the DOM half splices by
    cursor offset — there is no cursor to ask here, and it is the same edit for every case the active
    mention recogniser finds, because that is the word it found.
14. `KeyValueEditor` needs nothing new: its cells are `Input`s and `Checkbox`es, which are stops
    after this phase.
15. `Rectangle`'s `pty` box stays as it is. It already realises the stop contract with its own
    intercept.
16. The footer's `activate` hint reads `press` on a plain stop and `open` on a row. That is one
    conditional in `apps/tui/src/chrome/bindings.ts` reading `focusedItem()`, a new one-line export
    from `regions.ts` over the item registry the row marks itself in. The fuller footer work is
    phase 6.

17. Added, because the goal sentence covers it and requirements 3 to 13 missed it: `Grid` answers the
    collection intents. It is the exception `focusRoles.ts` writes down — a grid's rows are strings
    rather than renderables, which is what makes its arithmetic possible — so the grid is the one stop,
    the arrows move the `selected` index the caller holds, and the window follows. `SegmentedControl`
    takes the same shape for the same reason, which is why requirement 9's `createCellCollection`
    became `createCollectionIntents` with `land: () => {}` and `onItem: () => false`: there is nothing
    per option to focus inside one run of text, and splitting the run into a renderable per option
    would have changed the characters the appendix draws.

18. Added: `focusStops` in `regions.ts` is exported as `stopsIn`, which is phase 2 requirement 2's
    name arriving early. `MenuList` is the one caller outside the module. Phase 2 adds the collection
    and parent rules to the same function.

## Design notes

**Focus mode, not focus-within.** A `Button` inside a `Row` must not answer Enter that belongs to the
row. `focus` mode binds to the exact renderable, and a row's collection layer is `focus-within` on the
container, so Enter on a row reaches the row and Enter on a button inside a row reaches the button.
This is the same split `collectionIntents.ts` § `onItem` draws on the DOM. Requirement 1 says why the
priority is 41 rather than 40.

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

## Tests as written

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
- Agents: dropped, and folded into the two above. The agents pane's `detail` region only exists once
  a session is open, so the case would be a five-press walk through a slow pane to assert what the
  kit's `MentionTextarea` case and the pull request's comment case already assert between them: that
  `commit` in a mention field calls `onSubmit`, and that a composer's send reaches the transport.

What landed, against those:

- `apps/tui/src/kit/kit.test.tsx` gained a second tier, `every control is a stop`: 23 behaviour cases
  over 20 nodes, each drawn as the whole body of a pane so region entry lands the keys on it, plus the
  coverage test. `renderCells` gained `runs()` and modifiers on `press()`, because a focused `[Save]`
  has the same characters as an unfocused one and the answer is only in the colours.
- The coverage test carries `NOT_DRIVEN_HERE`, eight nodes with a reason each, and the reason has to be
  one of two kinds: there is no handler to press (`Section`, `Timeline`, `ChipRow`, `Log`), or the keys
  are driven in a named suite of its own (`Rows`, `Tabs`, `Sections`, `DocumentTabs`). It also fails on
  a stale excuse, for a node that is no longer a stop.
- `apps/tui/src/controls.test.tsx` (new) is the worked example as far as this phase takes it: the
  `pr` pane at 100 by 32, Tab to the strip, `↓` into the pane, `↓` onto the merge-method `Select` with
  the frame showing it in the accent tone and the footer saying `enter press`, then Enter opening the
  method list. Its second case walks right to Comments, down into the composer, types, and asserts the
  `POST` the fixture recorded.
- `apps/tui/src/fixture.ts` gained `recordedRequests()` and `_resetRequests()`, reset by
  `bootFixture`. The design said the fixture records requests; it did not.

## Acceptance

Met, 2026-09-02.

- Requirements 1 to 18 hold. `pnpm --filter @acorn/tui test` is 217 tests over 24 files, green;
  `pnpm lint` is green over all 31 packages; `tools/arch` and `packages/client-core` are green.
- No `queueMicrotask` was added.
- The 80 by 24 appendix in `docs/ui-design.md` is unchanged.

## What landed

What a reader can do that they could not before: reach the first stop inside any panel and press it.
`↓` from a strip enters the panel under it, because `Tabs` already asked `moveFocusFrom` for the next
stop in the region and there was never a stop there to find. On the pull request that is the
merge-method `Select` in Details, the first `Chip` in Labels, and the composer's field in Comments,
and the comment sends with `ctrl+⏎`.

What they still cannot do: reach the *second* stop in a panel. `[Merge]` is the stop after the
`Select`, and nothing binds `next`/`prev` on a plain stop yet. That is phase 2 requirement 3, and it is
deliberately not pulled forward: the walk has to know where a panel ends, or a `↓` inside an open
`Select` would step out of the overlay into the pane behind it. `moveStopIn` scopes that walk to a box
for exactly this reason, and phase 2 generalises it with the parent rule and the viewport rule
together. So the phase's goal sentence overstates today's build: merge, approve and request-changes are
focusable and press when focused, and a reader reaches them once phase 2 lands.

Two things found on the way and left alone, both outside this phase:

- An OpenTUI `textarea` raises one content change as it mounts, with the text it was built with, so a
  pane wired to `onInput` hears an edit nobody made. Harmless, because the value it reports is the
  value it was given, and pre-existing.
- The pull request and agents composers draw their send hint as `⌘↵`, a chord this host cannot press,
  because the hint is a pane's own `Kbd`. Phase 6 owns the footer's words and should take the hints
  with it, through one shared helper rather than a string per call site.

## Not in this phase

- Moving between two stops inside a panel (phase 2 requirement 3).
- Nested Escape (phases 1 and 2).
- Footer words beyond `press`/`open` (phase 6).

## Doc moves, done

`docs/tui.md` § Rendering gained two paragraphs, on `pressable` and on `litControl` with the coloured
frame read-back. § The adapter gained one on the kitty keyboard protocol, beside the paragraph on
spelling chords with `ctrl`. `docs/ui-design.md` needed no change. This file stays as the record of
what the requirements said and where the code disagreed, and goes with the folder at phase 6.
