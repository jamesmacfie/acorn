# Phase 0: baseline and spikes

Status: not started. Nothing waits on anything; this is the first phase.

## Goal

Two things exist at the end of this phase that do not exist now. A golden set: the character frame
and the coloured-run frame of every first-party pane, the shell, and each overlay, at 80 by 24 and
120 by 40, captured from the current OpenTUI renderer and committed. And four written answers to the
questions [architecture.md](./architecture.md) leaves open, each from a spike of a day or less.

Nothing in this phase changes what a reader sees. Its whole value is that phases 2 and 3 can say
"matches the golden" instead of "looks right", and that phase 1 does not start on a premise nobody
tested.

## Why this phase, and why first

The kit's terminal projection is specified in prose, one sentence per node in
[ui-design.md](../../ui-design.md) § Every node at 80 by 24, and tested by intent: `Badge` draws
`[text]`, a `Fold` draws `▸ label`. That is the right test for a kit that people keep changing,
because a snapshot of every cell fails on every spacing decision and names no broken promise
([testing.md](../../testing.md) § Test layers). It is the wrong test for a painter swap, where the
promise *is* every cell. A rewrite that drifts one column on `Table` truncation or one row on a
`Sections` breakpoint would pass every intent test and still change what every reader sees.

So the goldens are a temporary instrument. They are captured once from the renderer we are leaving,
compared against by the renderer we are building, and deleted in phase 4 once the intent tests are
running against the new painter. They are not a new test tier and they do not survive the programme.

The spikes are first because [architecture.md](./architecture.md) makes four claims it cannot prove
from reading: that OpenTUI's input widgets take keys without holding the renderer's focus, which is
what lets phase 1 ship on its own; that `yoga-layout`'s WebAssembly build runs under Node 24 and lays
out the widest pane fast enough; that a width measure exists that agrees with what OpenTUI drew; and
that `@codemirror/state` can be the textarea's model without a view. Each is a day of work to answer
and a month of work to be wrong about.

## Scope

In:

- A capture script that drives the existing harness, not the renderer directly, so it uses the same
  settle rules `apps/tui/src/panes.test.tsx` uses. For each of the eight surfaces the reachability
  suite names (the browse rail, the six panes the pane sweep opens, the rail with the cheat sheet
  open) plus each overlay (palette, inbox, workspace switcher, project switcher, quit confirmation,
  trust prompt), at both sizes: the character frame, the run frame as `{ text, fg, attributes }` per
  span, and the focused node's path from the root as a list of `(kind, index)` pairs. Written to
  `apps/tui/golden/` (new) as one JSON file per surface per size, committed.
- The fixture in `apps/tui/src/fixture.ts` with `ACORN_FIXTURE_DELAY_MS` set to the value
  `apps/tui/src/browseSlow.test.tsx` uses, so the captured state is the one a reader sees after
  queries resolve, not the one a zero-latency fixture produces.
- A comparison helper (new, beside the harness) that takes a live frame and a golden and reports
  differences as `row:col expected/actual` with three lines of context, so a mismatch is readable.
  Phases 2 and 3 use it; phase 4 deletes it.
- Four spikes, each in a throwaway file under the scratchpad or a branch, each ending with a
  paragraph appended to this file under **Spike answers**.
- The reachability suite pinned as the acceptance property for every later phase: its eleven
  invariants listed here with the one that changes wording (9) marked.

Out: any change to a component, a layout, or the keys. Any new dependency added to
`apps/tui/package.json`; a spike installs into the scratchpad.

## The spikes

### Spike 1: do OpenTUI's inputs take keys without the renderer's focus?

Phase 1 wants the region store to be the only focus owner while OpenTUI still paints. The one thing
that seems to need the renderer's own focus is typing: `InputRenderable` and `TextareaRenderable`
(`@opentui/core` 0.5.9, `index.node.js` around lines 8703 and 8949) receive keys because the renderer
routes `keypress` to `currentFocusedRenderable`. `EmbeddedTerminalRenderable.focus()` (around line
8403) also registers a `keyrelease` handler and sends a focus-in sequence to the emulator.

Answer three questions in a scratch renderer:

1. Does calling `input.handleKeyPress(keyEvent)` directly, with `input.focused === false`, update
   its value and cursor? Read `TextareaRenderable.handleKeyPress` and try it.
2. Does the cursor draw only while `focused` is true? If so, phase 1 keeps one call to
   `renderable.focus()` for the cosmetic cursor and treats it as paint state, never as truth. If the
   cursor can be positioned another way (`ctx.setCursorPosition` is what the emulator calls), say so.
3. Does `renderer.keyInput`'s `keypress` reach a listener registered with `prependListener` before
   the renderer's own routing, and does `preventDefault()` on the event stop that routing? The
   keymap's OpenTUI adapter does exactly this (`@opentui/keymap/src/opentui.js` line 72), so the
   answer is almost certainly yes; confirm it.

If 1 and 3 are yes, phase 1 ships alone. If 1 is no, phase 1 folds into phase 3 and the programme
loses its early win but nothing else.

### Spike 2: yoga-layout under the repo's Node

Install `yoga-layout@3.2.1` in the scratchpad. On Node 24.11.0:

1. Import the synchronous entry and the `yoga-layout/load` entry. Record which loads, how long the
   wasm takes to instantiate, and the size of the wasm.
2. Build the widest first-party tree by hand: 200 rows in a `list-detail` at 120 by 40, each row a
   box with three text children. Set the props `apps/tui/src/kit/showing.tsx` sets on `Rows` and
   `Row`. Time `calculateLayout` on it cold and warm, and time it again after changing one row's
   text and re-measuring.
3. Confirm the API surface the design needs: `setFlexDirection`, `setFlexGrow`, `setFlexShrink`,
   `setFlexBasis`, `setGap`, `setPadding`, `setMargin`, `setBorder`, `setWidth`, `setMinWidth`,
   `setMaxHeight`, `setAlignItems`, `setFlexWrap`, `setDisplay`, `setMeasureFunc`,
   `calculateLayout`, `getComputedLeft`, `getComputedTop`, `getComputedWidth`, `getComputedHeight`,
   `free`. Note any prop the kit uses that has no setter.
4. Confirm a node inserted after a layout pass and read before the next one reports zero, not
   `NaN` or `undefined`, from the computed getters. This is the fault `apps/tui/src/renderGuard.ts`
   guards; the design says the guard becomes a clamp in one function, and this confirms what it clamps.

Record the numbers. A layout pass under 5 ms warm for the 200-row tree is the target; over 20 ms
reopens the constraint-layout question in [refused.md](./refused.md) early.

### Spike 3: which width measure agrees with OpenTUI

OpenTUI measures text with its own Zig grapheme code. The goldens are drawn by it, so the new painter
must measure the same way or every line with a wide glyph shifts.

1. Collect every glyph `apps/tui/src/kit/glyphs.ts` emits, the box-drawing and block characters the
   borders and `Meter` use, the braille cycle `Spinner` uses, and twenty representative strings from
   the fixture including one with combining marks and one with an East Asian character.
2. Measure each with `string-width` (in the lockfile) and with `Intl.Segmenter` plus a hand table for
   East Asian Width `W` and `F` ranges.
3. Compare against the column each occupies in a golden frame.

Pick whichever agrees on all of them. If neither does on some glyph, list the glyph; phase 2 decides
whether to change the glyph or special-case it.

### Spike 4: can `@codemirror/state` be the textarea model?

`apps/tui/package.json` already lists `@codemirror/state`. It is pure data: an `EditorState` with a
`Text` document, a `selection`, and `Transaction`s that move both. What it does not have without
`@codemirror/view` is word wrap, because wrapping is a view concern.

1. Build an `EditorState` from a five-paragraph string. Apply the transactions for insert, delete,
   cursor left and right, Home, End, and word left and right using `@codemirror/commands` if it is
   pure (check its imports; if it pulls `@codemirror/view` the answer is no for this route and the
   spike stops).
2. Write a 30-line wrap function over `state.doc` lines at a column width, returning visual lines
   with their document offsets, and map the cursor to a visual line and column.
3. Implement cursor up and down over the visual lines and back to a document offset.

If this comes in under about 150 lines and every operation the composer needs is present, phase 3
uses it. If `@codemirror/commands` drags the view in, phase 3 writes the model, budgeted at about
400 lines, and the spike file's wrap function is its start.

## The acceptance property

`apps/tui/src/reachability.test.tsx` walks every stop on eight surfaces at eighty presses each and
checks these after every press. They are the programme's acceptance test, unchanged in meaning:

1. At most one caret is drawn.
2. Focus is on a node still on screen.
3. The word the footer puts beside each bare key is what that key does there.
4. The keys have not reached out of the open dialog.
5. Every stop `_allStops()` declares was landed on.
6. `h` and `l` on every kind of focused thing did what the footer said.
7. Escape out of each surface ends in the rail.
8. No line is wider than the terminal.
9. **The renderer and the store agree about which renderable has the keys.** This one changes in
   phase 1 to "the focused node is in the tree and on screen", because after phase 1 there is no
   second owner to agree with.
10. A hidden subtree holds no focus.
11. An entered rectangle stops taking keys the moment it goes off screen.

(The numbering here is this file's; the test names them by sentence.)

## Code touched

- `apps/tui/src/capture.tsx` grows the golden mode, or a sibling script beside it does. It already
  prints one frame at a fixed size against the fixture on a machine with no TTY, which is most of the
  job.
- `apps/tui/src/harness.tsx` exports whatever the capture needs to read the focused path. Nothing in
  it changes behaviour.
- `apps/tui/golden/` (new).
- This file, under **Spike answers**.

## Tests

None new. The goldens are data, not tests, until phase 2 compares against them.

## Docs owed

None. This phase is scaffolding and its record is this file.

## Done when

- `apps/tui/golden/` holds one file per surface per size, and re-running the capture on the same
  commit produces byte-identical files, which is the check that the capture is deterministic.
- Each of the four spikes has a written answer below, with numbers where the spike measured.
- The four answers have been folded into [architecture.md](./architecture.md) where they change a
  sentence there, and into the phase file they gate.

## Verify before building

- Confirm `apps/tui/src/capture.tsx` still runs against the fixture without a TTY and still takes a
  pane name. Read at `9e5d90ca`.
- Confirm `ACORN_FIXTURE_DELAY_MS` is still the knob `apps/tui/src/browseSlow.test.tsx` uses, and
  what value it uses.
- Confirm the eight reachability surfaces are still the eight named in
  [testing.md](../../testing.md) § Test layers.
- Confirm the installed `@opentui/core` is still 0.5.9 before reading line numbers from its
  `index.node.js`; 0.5.10 is on npm and a `pnpm install` may have moved them.

## Spike answers

Not yet run. Append each answer here with its date.
