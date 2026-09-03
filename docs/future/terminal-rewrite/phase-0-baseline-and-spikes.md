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
  trust prompt), at both sizes: the character frame, the run frame as `{ text, width, fg, attributes }` per
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

All four are answered. Append any further answer here with its date.

### Spike 1 (2026-09-03)

Yes to all three, so phase 1 ships alone.

We ran this in a scratch renderer from `@opentui/core/testing`'s `createTestRenderer`, on Node
26.8.1 with `--experimental-ffi`, against no acorn code at all: a box with two `InputRenderable`s and
a `TextareaRenderable` under the root. The installed `@opentui/core` is still 0.5.9, and the two line
numbers in the question above are right. `TextareaRenderable` starts at line 8703 of `index.node.js`
and `InputRenderable` at 8949. `EmbeddedTerminalRenderable` starts at 8264 rather than 8403, and the
`keyrelease` handler its `focus()` registers is at 8416.

**An input takes keys with no focus at all.** `TextareaRenderable.handleKeyPress` reads
`this.traits.suspend` and the key, and nothing else. It never looks at `_focused` or `_focusable`.
We confirmed that by calling it: an input that was never focused went to `hi`, then `left` and `X`
gave `hXi`, so the cursor moves too, and backspace took it back to `hi`. A textarea we never focused
took `one`, Return, `two` and reported a visual cursor at row 1, column 3. With the renderer's focus
held by the *other* input, the unfocused one still went from `hi` to `hzi` and the focused one stayed
empty. The frame drew what the unfocused input holds. A node whose `focusable` we had cleared, and
which therefore could not be focused at all, still typed `yo`.

**The cursor is the one thing that needs the renderer's focus.** `EditBufferRenderable.renderCursor`
(`chunk-node-dcyj0dm5.js` line 6269) returns immediately unless `_showCursor && _focused`, so an
unfocused input draws its text and no caret. We spied on `renderer.setCursorPosition` to see it: one
call per frame naming the focused input's cell, and zero calls per frame with nothing focused. So
phase 1 keeps its one mirroring call to `renderable.focus()` for the caret, and that call needs the
node to still be `focusable`, because `Renderable.focus` (line 327) returns early on a node that is
not.

There is a second route if the mirror turns out to hurt. `setCursorPosition` is a member of the
public `RenderContext` (`types.d.ts` line 118) and a method on the renderer, and nothing overwrites a
hand-placed cursor: we set one, rendered three more frames with nothing focused, and no other call
came. We have not watched that reach a real terminal, only the calls, so treat it as the fallback
rather than the plan.

**A prepended listener runs first and `preventDefault` stops the routing.** More strongly than the
question assumes. `renderer.keyInput` and `renderer._internalKeyInput` are the same
`InternalKeyHandler` object, and its `emitWithPriority` (`chunk-node-zcz10bhr.js` line 1553) runs
every ordinary listener before any renderable handler and then checks `defaultPrevented` before
running the renderable ones. So we are ahead of the renderable routing whether we prepend or not;
prepending only orders us among the other ordinary listeners. We measured both halves. A prepended
listener fired before an earlier plain `on` listener, and a focused input took the key. When the
prepended listener called `preventDefault`, the other ordinary listener still fired and the focused
input's value did not change. Then we did the whole phase 1 move in one listener: prepend, call
`preventDefault`, call `handleKeyPress` by hand. An input with `focused === false` and nothing at all
in `renderer.currentFocusedRenderable` typed `kj`.

Two things phase 1 does not name yet, both from this spike.

The renderer moves focus on a click by itself. `dispatchMouseEvent` (line 9103) walks up from the hit
renderable and calls `focus()` on the first `focusable` ancestor, and `autoFocus` defaults to `true`.
We clicked an input and watched `currentFocusedRenderable` become it. With `autoFocus: false` in the
renderer config the same click focused nothing. Phase 1's plan to make clicks a hit test into the
store needs that flag turned off in `apps/tui/src/main.tsx`, or the renderer keeps a second opinion
about focus for exactly the case that made us do this.

`exitOnCtrlC`'s handler is an ordinary listener registered in the renderer's constructor and it does
not check `defaultPrevented`, so `preventDefault` will not stop it and only `stopPropagation` would.
`main.tsx` already sets `exitOnCtrlC: false`, so this costs us nothing; it is here so nobody turns it
back on and wonders.

One small thing for the regression test phase 1 owes: `value` is a getter on `InputRenderable` only.
On a bare `TextareaRenderable` it is `undefined`, and what the textarea holds has to be read from the
frame or from `editorView.getVisualCursor()`.

### Spike 2 (2026-09-03)

The synchronous entry, and the target is met with a lot of room: a warm pass over the 200-row tree
costs 0.19 ms when one row's text changed and 1.9 ms when all 200 did. Nothing we measured came near
5 ms, let alone 20, so the constraint-layout question in [refused.md](./refused.md) stays parked.

We ran this on Node 24.11.0, the version `node-runtime.json` pins, with `yoga-layout@3.2.1` installed
in a scratchpad and no acorn code in the process at all.

**Both entries load, and the synchronous one is not synchronous.** There is one binary in the
package, `dist/binaries/yoga-wasm-base64-esm.js`: 120,919 bytes on disk, holding a 95,648-character
base64 literal that decodes to a 71,736-byte wasm module. Both entries reach it. `yoga-layout` is a
module that says `await loadYoga()` at the top level and exports the result, and `yoga-layout/load`
is the same call left for the caller. So the choice is not sync against async, it is where the same
await happens. Importing `yoga-layout` took 19.5 to 24.8 ms over five fresh processes, and
`yoga-layout/load` took 2.6 to 3.3 ms to import plus 17.0 to 17.9 ms in `loadYoga()`. Loading it
takes the process from 41.5 MB resident to 61.8 MB.

Take the synchronous entry. `apps/tui` is `"type": "module"` and `main.tsx` already awaits at the top
level from line 66 down, so the top-level await costs nothing there. The one thing it forbids is
`require()` from CommonJS, which fails with `ERR_REQUIRE_ASYNC_MODULE`; nothing in `apps/tui`
requires anything, so this is a note for whoever writes a CommonJS test helper, not a constraint.

**The tree.** 1,708 Yoga nodes: a `list-detail` at 120 by 40 with a 32-cell list column and a
`flexGrow` 1, `minWidth` 0 detail column, each inside a `Panel` (`flexShrink` 0, `flexGrow` 1,
`flexBasis` 0, `border` 1), the list holding a virtual `Rows` (`flexGrow` 1, `flexBasis` 0,
`flexShrink` 1) of 200 `Row`s and a 38-cell scrollbar column, and a 30-line detail. Each `Row` is
`showing.tsx` line 136 exactly: a `flexDirection` row box with `gap` 1, `flexShrink` 0, `overflow`
hidden and a `paddingLeft`, holding the `flexShrink` 0 caret cell, the title box at `flexShrink` 1
and `minWidth` 16, a `flexGrow` 1 spacer, and the meta box at `flexShrink` 20. Three text children
under each row, each with a measure function returning one line at the string's length capped by the
width Yoga offers.

| | 200 rows, 1,708 nodes | 36 rows, 396 nodes |
| --- | --- | --- |
| Build: create plus setters | 2.4 to 3.3 ms | 0.5 ms |
| First pass on a fresh tree | 4.8 ms | 0.9 ms |
| Warm, nothing dirty | 0.001 ms | under 0.001 ms |
| Warm, one row's text changed | 0.19 ms median, 0.21 p95 | 0.046 ms median |
| Warm, every row's text changed | 1.9 ms median, 2.1 p95 | 0.34 ms median |

The very first pass in a process is 10.5 ms rather than 4.8, which is wasm warm-up and happens once.
The 36-row column is the number that matters day to day: `Rows` windows a virtual list to what fits,
so a 40-row terminal mounts about 36 of them however long the list is, and 200 is the case where
somebody passes a list without `virtual`. Marking every text dirty and re-laying out 200 rows is
2 ms, and that is the whole of a refetch that replaced the list. A resize of the 200-row tree by one
cell, with nothing marked dirty, is 0.14 ms.

One honesty note. In the first run, one pass out of 200 took 2,291 ms. It has not reproduced in
3,900 further passes across four runs, no garbage collection pause over 5 ms was recorded in the run
that watched for them, and the p99 in a 3,000-pass run is 0.25 ms. We are calling it the machine. It
is written down in case phase 2 sees it again.

**Every setter the design names exists, and the list is three short.** `setHeight`, `setMinHeight`,
and `setOverflow` are missing from the list in the question above, and the kit sets `height`,
`minHeight`, and `overflow` (nine times) today. `setMaxHeight` is the other way round: it is on the
list and nothing in `apps/tui` sets `maxHeight`. `rowGap` and `columnGap` are `setGap` with a
`Gutter`, not setters of their own.

The count checks out. Scanning every `.tsx` under `apps/tui/src` for opening tags gives 154 `<box>`
(the review said 153) and 6 `<text>`, carrying 24 distinct props between them once `ref`, `title`,
and the event handlers are set aside. 21 of those map to a Yoga setter: `flexDirection`, `flexGrow`,
`flexShrink`, `flexBasis`, `flexWrap`, `gap`, `rowGap`, `columnGap`, `paddingLeft`, `paddingRight`,
`paddingTop`, `marginTop`, `marginBottom`, `width`, `height`, `minWidth`, `minHeight`, `alignItems`,
`overflow`, `border`, and `visible`. The other three are `borderStyle` and `borderColor`, which are
paint, and `wrapMode`, which is an input to the measure function.

**A node inserted after a pass reads `NaN` for its size, not zero.** This is the one answer that came
back the opposite way from the question. Its left and top are 0, but `getComputedWidth` and
`getComputedHeight` both return `NaN`, and so does `getComputedLayout()` for the same two fields. A
node that was never attached to anything reads the same way. So the fault
`apps/tui/src/renderGuard.ts` guards is Yoga's, not OpenTUI's, and it survives the move to wasm
unchanged. The problem is the same size after the move. What phase 2 gets is a better place to put
the answer: one clamp in the function that reads a rectangle back, instead of two prototype patches
on somebody else's class.

Two things that clamp has to know. Zero is not a marker for unmeasured, because an empty auto-sized
box legitimately lays out at height 0 and a `DISPLAY_NONE` subtree legitimately reads 0, 0, 0. And a
computed left can be negative: an overflowing child under `alignItems: center` reported left -15 at
width 40 inside a 10-cell parent. The kit sets `alignItems` once and `justifyContent` never, so this
is a corner, but clamping a negative left to 0 moves the run rather than clipping it, and paint
should clip.

**Yoga rounds to whole cells by itself.** The default point scale factor is 1, so 101 split three
ways came back 34, 33, 34 with edges that meet and no gap. With the factor set to 0 the same split is
33.667 three times. The invariant in [architecture.md](./architecture.md) § 2, four finite
non-negative integers, is therefore Yoga's own output for the size half, and the read-back only has
to fix the `NaN`.

**The wasm side aborts where the Zig side threw, in one case.** Inserting a child into a node that
has a measure function prints `Cannot add child: Nodes with measure functions cannot have children.`
and `Aborted()` to stderr and throws. Two differences from OpenTUI's version of this: the throw is a
catchable JavaScript error, and the module survives it, which we checked by creating another node and
laying it out afterwards. But those two lines go to stderr, which in a TUI paints straight over the
frame, so it is not free. A `text` node is a leaf to Yoga, which is what phase 2 already says when it
gives `#text` and `span` no Yoga node of their own. It deserves an assertion in the reconciler rather
than a discovery in a pane.

Last small thing for phase 2's freeing rule. `free()` on a node still attached to a parent does not
throw and leaves the parent holding a freed pointer, so the unlink has to come first.
`freeRecursive()` on the 1,708-node root took 1.25 ms.

### Spike 3 (2026-09-03)

`Intl.Segmenter` with a hand table of the East Asian Width `W` and `F` ranges. It agrees with what
OpenTUI drew on 118 of the 125 things we measured, `string-width` on 114. The count is not the
argument, though. The two measures fail in opposite directions, and `string-width` fails on the
glyphs the kit puts on the screen every frame.

We ran this in a scratch renderer from `@opentui/core/testing`'s `createTestRenderer`, on Node 26.8.1
with `--experimental-ffi`, against no acorn code: a flex row holding a text node with the string and
a second text node holding a marker on a blue background, so `captureSpans` says which column the
marker starts at. The corpus is 125 items: every one of the 59 distinct values in
`apps/tui/src/kit/glyphs.ts`, the eleven box characters a `single` border draws, nine block
characters including the `█` and `░` of `Meter`, the ten braille frames of `SPINNER`, eight other
marks the source spends, the twenty fixture strings, and nine strings we wrote ourselves, because
`apps/tui/src/fixture.ts` is pure ASCII and has neither a combining mark nor an East Asian character
anywhere in it.

**Every measure agrees on every string the fixture draws.** All twenty are ASCII, so `string-width`,
the segmenter, and even `String.length` return what OpenTUI laid out. The goldens as this phase
captures them therefore do not depend on the choice at all, and neither does the acceptance property.
The whole disagreement is in `glyphs.ts`. `String.length`, which is what `ellipsise` and `pad` in
`apps/tui/src/kit/cells.tsx` truncate by, gets 113 of the 125 right for the same reason: it is wrong
on every wide character, wrong on every astral one because a surrogate pair counts twice, and wrong
on every combining mark, and the fixture has none of the three.

**Six characters in `glyphs.ts` are two cells wide, and the file's own rule says they are not.** The
comment at the top says every glyph there is one cell wide and calls it a rule rather than a
coincidence. It is not true. `☰`, `🗀`, `🗎`, `🗒`, `🗃` and `🖵` each lay out and paint at two cells
under the renderer we have, and they carry 13 of the 73 names: `list`, `archive`, `folder`,
`folder-plus`, `folder-tree`, `folder-x`, `file-text`, `file-diff`, `file-cog`, `notepad-text`,
`database`, `monitor` and `app-window`. Five of those names are live on surfaces this phase captures:
the trust prompt asks for `list`, `file-text`, `database` and `folder-tree`
(`packages/client-core/src/host/trust/permissions.ts` lines 34 to 42), and the notes tab asks for
`notepad-text`. The ban the comment prescribes is honoured, for what it is worth: nothing in the
table matches `\p{Emoji_Presentation}`. It just does not catch the characters that are actually wide.

**The disagreement table.** OpenTUI is the column the goldens are drawn in. `@xterm/headless` 5.5.0
is in the repo already and phase 3 adopts it for the `pty` rectangle, so we wrote each character into
a headless terminal and read `getWidth()` off the cell, which makes it a third opinion rather than
another library call.

| Character | Names in `glyphs.ts` | OpenTUI | `string-width` | Segmenter and EAW | `@xterm/headless` |
| --- | --- | --- | --- | --- | --- |
| `☰` U+2630 | `list` | 2 | 2 | 2 | 1 |
| `🗀` U+1F5C0 | `archive`, `folder`, `folder-plus`, `folder-tree`, `folder-x` | 2 | 1 | 1 | 1 |
| `🗎` U+1F5CE | `file-text`, `file-diff`, `file-cog` | 2 | 1 | 1 | 1 |
| `🖵` U+1F5B5 | `monitor`, `app-window` | 2 | 1 | 1 | 1 |
| `🗒` U+1F5D2 | `notepad-text` | 2 | 2 | 1 | 1 |
| `🗃` U+1F5C3 | `database` | 2 | 2 | 1 | 1 |
| `▶` U+25B6 | `play` | 1 | 2 | 1 | 1 |
| `☑` U+2611 | `square-check`, `list-checks` | 1 | 2 | 1 | 1 |
| `⚠` U+26A0 | `triangle-alert` | 1 | 2 | 1 | 1 |
| `⌨` U+2328 | `keyboard` | 1 | 2 | 1 | 1 |
| `☺` U+263A | `user-round` | 1 | 2 | 1 | 1 |
| `👁` U+1F441 | `eye`, `eye-off` | 1 | 2 | 1 | 1 |
| `🏷` U+1F3F7 | `label` | 1 | 2 | 1 | 1 |
| `नमस्ते` | none | 4 | 3 | 3 | n/a |
| `🇳🇿` | none | 2 | 2 | 1 | n/a |

Each half of that table is one class, not a scatter.

`string-width` 7.2.0 asks `emojiRegex().test(character)` before it looks at East Asian Width, and
`emoji-regex` 10.6.0 matches a bare text-presentation emoji, so `▶`, `☑`, `⚠`, `⌨`, `☺`, `👁` and
`🏷` all come back 2. Nothing else agrees: not the standard, not OpenTUI, not xterm. Those seven
carry nine names and they are on the rail, the footer and half the rows in the app. Taking
`string-width` would widen nine names by a cell each against the goldens on day one.

OpenTUI's misses are the other way. It widens the astral pictographs whatever East Asian Width says.
We scanned U+1F300 to U+1F6FF, U+1F900 to U+1FAFF and U+2000 to U+2BFF a code point at a time and the
overshoot is contiguous: U+1F53E to U+1F5FF, U+1F650 to U+1F67F, U+1FA00 to U+1FA6D and more, 279
code points where OpenTUI says 2 and both candidates say 1. That is the class the five astral glyphs
above fall into.

`☰` is its own small thing. Unicode 16 moved U+2630 to U+2637 to `W`, so the standard, our table and
`string-width` all say two cells, and xterm's Unicode 6 table says one. Any terminal with an older
width table draws it in one cell. It is a glyph whose width the layout cannot predict, which is the
exact hazard the comment in `glyphs.ts` was written about, arriving through a property that comment
does not test.

**So phase 2 should change the six glyphs rather than special-case them.** Matching OpenTUI on the
five astral ones means copying a measurement that xterm, `string-width` and the standard all
contradict, and phase 3 puts an xterm-measured `pty` rectangle on the same screen, so the two halves
of one frame would count cells differently. Pick one-cell replacements, recapture the goldens for the
trust prompt and the notes tab, and the disagreement column disappears. `☰` goes with them for the
same reason.

**OpenTUI's own two answers disagree about combining marks, so there is no single column count to
match there.** Its layout measures grapheme clusters and its paint writes one cell per code point. We
saw it four times. `José Martínez` written with combining acutes lays out at 13 and paints 15,
pushing the marker two columns right and overwriting the two cells it lands on. `ȩ́` lays out at 1 and
paints 3. `नमस्ते` lays out at 4 and paints 6. The New Zealand flag lays out at 2 and paints 4. So
any accented name in real data draws a column too wide per mark and clobbers whatever is beside it,
which is a fault of the renderer we are leaving rather than a behaviour to preserve. The new painter
should take the layout answer, which is what both candidates give. Nothing in the fixture reaches
this, which is why nobody has seen it.

**The premise that `string-width` is already ours is wrong.** It is in `pnpm-lock.yaml` once, at
7.2.0, and `@opentui/core` is the only thing that depends on it. It leaves the tree with OpenTUI in
phase 4, so choosing it means a new direct dependency on `apps/tui`, not the reuse the design
assumed. The hand table is about 120 ranges and 60 lines, and it is the file the disagreements above
get argued in.

**The emoji ban stays, and this spike cannot tell you whether it could ever go.** Everything we
measured is a library or a headless emulator. We never drove a real terminal, and what a real
terminal does with `🗀` is the entire question the ban exists for. What the spike does settle is that
the test is wrong: `\p{Emoji_Presentation}` passes all 73 names and misses all six wide ones. Phase 2
should replace it with an assertion that the painter's own measure returns 1 for every value in
`GLYPHS`. That catches the six, it needs no Unicode property, and it fails on the day somebody adds
a seventh.

**Cost, for the paint loop.** Both measures are dominated by `Intl.Segmenter`: 3.2 microseconds per
string for the segmenter and the table, 3.9 for `string-width`, over the fixture's strings. At a few
hundred runs a frame that is around a millisecond, against the 5 ms budget spike 2 measured for
layout. Returning `String.length` when the string is `[\x20-\x7e]*` costs 0.03 microseconds and
gives the same answer on all 125 items, so put that branch in front and the cost stops mattering.

**One thing this phase's capture has to change.** `captureCharFrame` emits one character per grapheme,
not one per column, so `你|` comes back as two characters with the marker at index 1 and a golden
held as characters alone cannot see a column shift at all. `captureSpans` carries `width` on every
span, which is the column count. The run frame in **Scope** above must keep it, or the goldens will
not catch the fault they exist to catch.

### Spike 4 (2026-09-03)

It can, and phase 3 should not. The model is 63 lines of code over `@codemirror/state` and 89 lines
over a plain string, and the 26 lines the library saves cost 47,922 bytes in the eager graph and keep
alive one of the nineteen `@codemirror/*` packages [phase 4](./phase-4-cut-over.md) is trying to
delete. Write the 26 lines.

We ran this on Node 24.11.0, the version `node-runtime.json` pins, against `@codemirror/state` 6.7.1
and `@codemirror/commands` 6.11.0 from the repo's own store, with no acorn code in the process. We
wrote the model twice, once each way, against one test file of 40 assertions covering insert, both
deletes, delete word backward, character and word motion, Home, End, up and down over visual lines, a
goal column, grapheme stepping over a combining mark, and the four things the kit asks a textarea for.
Both models pass all 40.

**`@codemirror/commands` pulls the view in, and the pure half is the wrong half.** Line 2 of its
`dist/index.js` is `import { EditorView, Direction } from '@codemirror/view'`, and lines 3 and 4 add
`@codemirror/language` and `@lezer/common`. So the route is closed, as the question said it would be.
What the question did not anticipate is where the package splits. 43 of its commands are
`StateCommand` and take a state; 59 are `Command` and take an `EditorView`. Of the eight operations
the spike asks for, the view side holds four: `cursorLineStart`, `cursorLineEnd`, `cursorGroupLeft`
and `cursorGroupRight` all call `view.moveToLineBoundary` or `view.moveByGroup`, which need laid-out
DOM. `cursorCharLeft` and `deleteCharBackward` are view-side too, and only their `Logical` twins are
not. So Home, End and both word motions have to be written by hand even in a world where importing
the package were free. The model is ours whichever way this went.

**What `@codemirror/state` alone is worth is four things.** `findClusterBreak` steps a grapheme;
`charCategorizer` sorts a character into word, space, or other, which is what a word motion stops
between; `Text` carries `lines`, `line(n)` and `sliceString`, which is a line index; and
`SelectionRange` carries `assoc` and `goalColumn`. That last one is the only place the library told us
something we would have got wrong. A soft wrap gives one document offset two homes, so End on a
wrapped row and Home on the next row are the same number, and without `assoc` saying which side the
cursor is on, End followed by Home does not come back. CodeMirror has the field because it has the
problem. We copied the idea into the plain model as two fields on an object.

**One trap, because it is silent.** A transaction spec reads a bare `SelectionRange` as
`{ anchor, head }` and drops `assoc` and `goalColumn` with no error. `state.update({ selection: range })`
loses them; `state.update({ selection: EditorSelection.create([range]) })` keeps them, and a later
change maps them through correctly.

**The wrap function is 44 lines of code in 56, and it is not the hard part.** `wrapDoc(doc, width)`
returns every visual line as `{ from, to, line }` in order, breaking after the last space that fits
and hard-breaking a word too long for the row. `toVisual(doc, rows, pos, assoc)` gives the row and
column of an offset and `fromVisual(doc, rows, row, col)` gives it back. Up and down are then four
lines each. It knows nothing about CodeMirror: it asks a document for `lines`, `line(n)` and
`sliceString`, and a plain string satisfies that in 23 lines.

**Spike 3's measure is load-bearing here, and it needs its fast path extended.** Our five-paragraph
document has a Japanese paragraph, and at 40 columns it wraps into a 27-column row and a 40-column
row. The 40-column row holds 20 characters. `String.length` would have put 40 characters on it and
overrun the terminal by 20 cells, which is the fault spike 3 exists to prevent, arriving through
wrapping rather than through truncation. But the ASCII branch spike 3 recommends for `stringWidth`
matters more in the cluster walk than in the width call, because the wrap pass runs the walk over
every line it touches. Putting the branch in `clusters` too took a wrap of a 400-line note from
1,946 to 163 microseconds and a wrap of a composer draft from 7.0 to 0.6.

**The two routes, measured the same way.**

| | over `@codemirror/state` | over a string |
| --- | --- | --- |
| The model | 63 lines of code in 85 | 89 lines of code in 104 |
| The wrap function, shared | 44 in 56 | 44 in 56 |
| The width measure, the painter's anyway | 64 in 78 | 64 in 78 |
| New bytes in the eager graph | 47,922 minified, 15,982 gzipped | 0 |
| A keystroke on a composer draft | 1.6 microseconds | 1.4 |
| A keystroke on a 400-line note | 110 microseconds | 99 |

Both come in under the 150-line bar the question set, so by the letter of it phase 3 uses
`@codemirror/state`. We think that reads the bar wrong. The choice is not 150 lines against 400, it is
26 lines against 48 kilobytes.

**The premise that the package is already ours is half true.** It is in `apps/tui/package.json`, but
the only thing under `apps/tui/src` that imports it is `kit/editor.ts` line 21, and that is an
`import type`, erased at build. This host runs no CodeMirror at all. The library reaches the built
output only as bytes in a lazy chunk, because `EditorPane.tsx` imports `basicSetup`, `EditorState` and
`EditorView` directly, and `editor.ts` already writes that down as its ceiling. `kit/asking.tsx` is
imported by `main.tsx`, so a textarea over `EditorState` would put `@codemirror/state` in the eager
graph for the first time, against the 870,000 byte ceiling in
`apps/tui/scripts/check-startup-graph.mjs`. Phase 4 then has to argue with itself: its dead-dependency
list names all nineteen `@codemirror/*` packages, and this route saves one of them for 26 lines.

**What the composer needs is less than either model has.** Fifteen first-party call sites draw a
`Textarea`, a `Composer` or a `MentionTextarea`, eleven of them in plugins and four in client-core.
Between them they pass `value`, `onInput`, `onChange`, `placeholder`, `rows`, `size`, `label`,
`assist`, `mono`, `grow`, `disabled`, `onSubmit` and `onBlur`. No prop names a cursor and no prop
names a selection. On this host the reads are narrower still: `plainText` twice in
`apps/tui/src/kit/asking.tsx`, once for `Composer`'s send and once for the `commit` layer, and
`setText` once for a value written in from outside. Nothing
under `apps/tui/src` reads a selection, sets one, or asks for undo. The DOM `MentionTextarea` calls
`setSelectionRange` to put the caret after a completion; the terminal half says out loud that it
cannot and replaces the trailing word instead.

So the genuinely required list is: insert a character, insert a newline, backspace, the four arrows
over visual lines, the whole value out, and a whole value in. Delete forward, Home, End, both word
motions and delete-word-backward are not required by any caller. They are required because
`defaultTextareaKeyBindings` (`@opentui/core` 0.5.9, `index.node.js` line 8636) binds them today, so a
reader has them and would notice losing them. Selection and undo are in that table too, and shift with
an arrow really does select right now, but nothing can get a selection out again: `CopyButton` is the
copy path and phase 3 already puts selection inside the `pty` out of scope. A selection you can make
and cannot use is not worth carrying, and undo over a three-row draft is not either. Both our models
have `selectAll` and shift-extension anyway, because once the cursor is a range they cost two lines.

One difference from that table phase 3 should keep rather than match. OpenTUI binds Home and End to
`buffer-home` and `buffer-end`, the whole document, with Ctrl+A and Ctrl+E as the line boundaries and
Meta+A and Meta+E as the visual-line ones. Our model puts Home and End on the visual line, which is
what phase 3's `Input` paragraph already specifies for the single-line case and what a reader means by
the key. No golden frame records a cursor press, so nothing in phase 0's capture disagrees.

**One thing phase 3 has to do that the spike did not.** `edit` recomputes the wrap on every motion,
because that is what makes it a model rather than a cache. At 163 microseconds for a 400-line note
that is affordable per keystroke and wasteful per frame, so the component should hold the rows beside
the model and rebuild them when the document or the width changes.

**Where it lives.** The spike's scratchpad folder holds `width.js` (spike 3's measure, with the
cluster fast path added), `wrap.js` (the function phase 3 starts from), `model.js` (over
`@codemirror/state`), `plain.js` (over a string), `run.js` and `run-plain.js` (the same 40 assertions
against each), and `bench.js`. `wrap.js` and `plain.js` are the two phase 3 should copy. They are
scratch files outside the repo, so copy them into `apps/tui/src/kit/` in phase 3 rather than
importing them.

## The golden set (2026-09-03)

Captured. 28 files in `apps/tui/golden/`, one per surface per size, 984 KB between them, about five
minutes a run on a warm machine. They are left as files rather than committed.

**The determinism check, honestly.** 27 of the 28 reproduce byte for byte. One does not:
`notes-80x24` flips a single `INVERSE` bit on the word `Scratchpad`, and the flip is not a settling
problem. Five runs went INVERSE, plain, plain, plain, INVERSE, and a back-to-back pair came out
identical on all 28 before a third run disagreed, so both states are where the screen comes to rest.
`Row selected` is what draws that bit (`apps/tui/src/kit/showing.tsx` line 167 through the `match`
role), so what varies is whether the notes list ends up marking the note it is showing. That is a
fault a reader meets, not an artefact of the capture, and it is worth its own look: at 80 by 24 the
notes pane sometimes opens with no row marked as current. Phase 2 should hold that one span as an
accepted difference until somebody chases the race.

**What each file holds.** `{ surface, width, height, frame, runs, focus }`. `frame` is
`captureCharFrame()` split by line. `runs` is `captureSpans()` as `{ text, fg, attributes, width }`
per span, one array per line, and `width` is there because spike 3 said the goldens are blind to a
column shift without it. `focus` is the path from the root down to whatever has the keys, as
`(kind, index)` pairs, where the kind is the renderable's class name and the index is its place among
its parent's children — an id is minted per render and would differ on every run, so the tree's shape
is what a golden can hold.

**Where the code is.**

- `apps/tui/src/captureGolden.tsx` drives the harness over the surface list and writes the files.
  `pnpm --filter @acorn/tui golden` is `vite build` and then
  `node --experimental-ffi dist/captureGolden.js`, so it wants the Node 26 floor like everything else
  that draws. A sibling of `capture.tsx` rather than a mode of it: that one prints a frame for a
  person to read and this one writes data for phases 2 and 3, and they share only the harness.
- `apps/tui/src/golden.ts` holds the frame shape, the reader that takes one off a live screen, and
  `compare`, which reports each difference as `row:col expected/actual` with three lines either side
  and the run difference with the column the run starts at. It sits beside
  `apps/tui/src/golden.test.ts` (new in [phase 2](./phase-2-the-painter.md)), and
  [phase 4](./phase-4-cut-over.md) deletes both with the goldens.
- `apps/tui/vite.config.ts` gains the entry and `apps/tui/package.json` the `golden` script.
- `apps/tui/src/harness.tsx` gains `width` on its `Span` and passes it through `spans()`. That is the
  only change to it this phase made.

**The fourteen surfaces.** The reachability suite's eight, in its order, and then the six overlays it
does not open: `browse`, `agents`, `pr`, `changes`, `notes`, `context`, `editor`, `help`, `palette`,
`inbox`, `workspace`, `project`, `quit`, `trust`. Each waits for the same string the sweep waits for,
and the overlays are then opened by their key, which is `?`, `ctrl+k`, `n`, `w`, `p` and `q`. `trust`
is the one nobody opens by hand, so its bundle is seeded into the queue instead.
`ACORN_FIXTURE_DELAY_MS` is 50, which is `apps/tui/src/browseSlow.test.tsx`'s value. That test also
sets `ACORN_FIXTURE_PULLS` to 40 and the capture does not: forty pull requests is that test's own
scrolling case, not the screen a reader opens on.

**Getting there took five runs, and the four things that moved are the useful part.** A capture that
waits for a string is not a capture that waits for the screen.

1. `help-120x40` held OpenTUI's own debug console, `Console (Focused)` and a copy button, drawn over
   the middle of the frame. The harness deactivates and hides that console once during the boot
   settle, and anything that logs afterwards pops it back. What logged is the notes pane's debounced
   title save: `apps/tui/src/fixture.ts` answers no note-title route, so `setTitle` raises
   `ApiError: 404` about 800 ms after the pane lands. The capture now deactivates and hides the
   console immediately before it takes the frame. Anything else that reads a live frame off this
   renderer wants the same two lines.
2. `palette-120x40` had a `✓ Note saved` toast above its footer on one run and not the next.
   `notesModel.ts` flushes its debounced save in `onCleanup`, so tearing the notes render down fires
   a request whose toast lands in whichever render is up when it answers. Toasts are module state
   with no reset, so the capture clears them through `activeToasts` and `dismissToast` before the
   frame.
3. `trust-80x24`'s topbar said `acorn · 0 tasks` on one run and `acorn > acorn · 1 task` on the next:
   the prompt is up before the shell behind it has filled. That surface now waits for the task count
   and then for the prompt.
4. `notes-80x24` differed in one bit on one word, which is the one left over. We first read it as a
   frame taken a beat early, so `readFrame` now takes the frame twice and keeps going until two
   reads in a row agree, bounded at ten. That was worth doing on its own account and it did not fix
   this: a third run disagreed with an identical pair, so the screen settles to either state rather
   than passing through one on the way to the other. See the determinism note above.

**Two notes on goldens changing later, neither of them a painter fault.**

Spike 3 and [phase 2](./phase-2-the-painter.md) § Width both say the goldens for the trust prompt and
the notes tab are recaptured after the six wide glyphs become one-cell characters. They are not: no
golden holds a wide glyph. We grepped all 28 files for `☰`, `🗀`, `🗎`, `🗒`, `🗃` and `🖵` and none
appears in any frame. `GLYPHS` is read in one place, `apps/tui/src/kit/showing.tsx` line 519, and
nothing on these fourteen surfaces asks it for one of the six. The trust prompt interpolates
`line.icon` straight into a `Line` (`apps/tui/src/plugins/TrustPrompt.tsx` lines 70 and 77), so a
permission would draw the Lucide *name* as words rather than a glyph — and the fixture's bundle asks
for no permissions, so the prompt draws no permission lines at all. The pane strip lost its marks
when the rail lost its icons (`apps/tui/src/chrome/Shell.tsx` lines 65 and 66), so the notes pane's
declared `notepad-text` never reaches a cell. Phase 2 should still make the swap, for the reason
spike 3 gives. What it should not expect is a golden to move because of it.

The other one is a clock. `pr-80x24` and `pr-120x40` both hold `689mo ago`, which is the fixture's
`updatedAt: 0` measured against the wall clock. It rolls over about once a month, so a comparison run
weeks after this capture sees a three-character span change on two files. Left alone rather than
frozen: pinning a "now" into `apps/tui/src/fixture.ts` would change what every other test sees, and
the alternative is one line in phase 2's accepted-difference list.

**Two things about the overlay goldens.** An overlay is a sibling of the pane row rather than a
dialog over it, and the row collapses to nothing while one is up, so an overlay golden is the topbar,
the modal and the footer with no rail and no pane behind it. That holds for the cheat sheet too, the
one the sweep opens over the browse rail. Fourteen of the 28 files therefore say nothing about the
shell's own columns, and phase 2 should not read a matching `palette-120x40` as evidence that the
rail lays out.

**What the verify list turned up.** Three of the four premises hold outright.
`ACORN_FIXTURE_DELAY_MS` is still the knob and 50 is still `browseSlow.test.tsx`'s value; the eight
reachability surfaces are still the eight [testing.md](../../testing.md) § Test layers names; and the
installed `@opentui/core` is still 0.5.9, so spike 1's line numbers stand.

`apps/tui/src/capture.tsx` runs against the fixture with no TTY and does take a pane name, but not
the way its own comment says to ask. `pnpm --filter @acorn/tui capture -- notes` puts `--` in
`argv[2]` and `notes` in `argv[3]`, so the script read `--` as the pane, found no contribution for
it, and drew whatever the task's saved layout puts first. It has looked like the argument being
ignored for as long as the comment has been there. The comment now says
`pnpm --filter @acorn/tui capture notes` and the script skips a bare `--`.

The one premise that did not hold is in **Code touched** above: `apps/tui/src/harness.tsx` needed no
new export for the focused path. `focusedRenderable` is already exported from
`apps/tui/src/keys/regions.ts` and the path is a walk up `parent` from there. What the harness did
need was the `width` spike 3 asked for, which the list did not anticipate.

**One more thing about the palette pair.** `palette-80x24` and `palette-120x40` were recaptured
after the concurrent command-palette work landed in the same tree, so they match the tree as it
stands rather than the tree the other 26 were taken from. Any surface that work touches again wants
`pnpm --filter @acorn/tui golden` re-run before phase 2 leans on it.

**One thing outside this phase that a later one will hit.** `pnpm --filter @acorn/tui build` fails on
the startup budget, and it fails at `HEAD` with every change here stashed: the eager closure is
875,265 B against the 870,000 B ceiling in `apps/tui/scripts/check-startup-graph.mjs`. The new entry
adds 66 B of that, because the two notification modules it imports were already in the closure.
`apps/tui/src/startupGraph.test.ts` builds its own fixture dist, so the suite is green either way.
