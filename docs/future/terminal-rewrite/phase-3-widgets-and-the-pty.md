# Phase 3: widgets and the pty

Status: built, in three slices, all 2026-09-04. The scroll viewport against `cf374cbd`, `Input` and
`Textarea` against `a6a9e330`, and the `pty` rectangle, its key encoder, the click hit test and the
parser's wiring against `27a9b1ab`. What building each slice found is at the bottom, newest section
last, and the last two sections of each are the ones to read first. Five goldens are held and each
is a measured difference under the layout pass rather than work; the list is in § The five goldens
that are left.

## Goal

The four node kinds a box and a text cannot be, drawn by our painter: the scroll viewport, `Input`,
`Textarea`, and the `pty` rectangle. Mouse events hit-test against the tree. The input parser from
phase 2 is wired into the dispatcher. At the end, every golden frame matches under
`ACORN_TUI_PAINTER=own`, and the keys, panes, chrome, and reachability suites pass under it.

## Why this phase

Phase 2 proves the painter draws a static tree the way OpenTUI did. A pane is not static: it scrolls,
it takes typing, and the one rectangle that defines an agent workspace is a terminal. Those four are
the only places the kit's components reach for something with state of its own, and they are the
places where the design has to make a decision rather than transcribe one.

They are also where OpenTUI's version earned its keep, so this phase is honest about what it
replaces. `ScrollBoxRenderable` owns an offset, a bar, wheel acceleration, and clamping;
`TextareaRenderable` is an edit buffer with word wrap; `EmbeddedTerminalRenderable` is Ghostty's
emulator with its own key encoder. The replacements are smaller because they only need what the kit
asks for, and the kit asks for little: the composer, the filter field, the palette's field, and a
`Rectangle kind="pty"`.

## Scope

In:

- **The scroll viewport.** A `scrollbox` node kind whose component (`apps/tui/src/kit/scrolling.tsx`,
  rewritten in place) owns `offset` as a signal and passes it as a prop. Layout measures the content
  child at unconstrained height and the viewport at its flex height; paint translates the content by
  `-offset`, clips to the viewport, and draws a one-column bar when content exceeds the viewport.
  `scrollBy` and `scrollTo` clamp to `[0, contentHeight - viewportHeight]`. `scrollChildIntoView`
  compares the child's rect to the viewport's rect from the *current* frame's layout, which is why
  the second reveal goes: the reveal runs after layout in the same frame that paints. Wheel events
  arrive from the parser, hit-test to the innermost viewport under the pointer, and move its offset.
- **`Input`.** An `input` node kind. The component in `apps/tui/src/kit/asking.tsx` owns `value`,
  `cursor`, and a horizontal `scroll` as signals and passes them as props; the dispatcher's typing
  hand-off calls an `edit(event)` function exported beside the component that returns the new model
  or `false` for a key it does not take. Paint draws the visible slice, the placeholder when empty,
  and writes the terminal cursor position when the node is focused. About 150 lines, most of them
  the key table: characters, Backspace, Delete, Left, Right, Home, End, Ctrl+A, Ctrl+E, Ctrl+U,
  Ctrl+W, and Return for `onSubmit`.
- **`Textarea`.** A `textarea` node kind over a model of ours, which spike 4 wrote and measured at
  89 lines beside a 44-line wrap function; `@codemirror/state` saves 26 of those and costs 47,922
  bytes in the eager graph, so it loses. Start from the spike's `wrap.js` and `plain.js`. The
  component owns the model, `edit(event)` handles insert, delete, the four arrows over visual lines,
  Home, End, word motions, and Return (newline; `ctrl+return` is `commit` and stays the dispatcher's),
  and paint draws the visible wrapped lines with the cursor. Home and End go to the visual line's ends,
  not the document's, which is a deliberate difference from `@opentui/core`'s
  `defaultTextareaKeyBindings`. The component holds the wrapped rows beside the model and rebuilds
  them when the text or the width changes, rather than per keystroke: a wrap of a 400-line note is
  163 microseconds. Selection and undo are out. Nothing under `apps/tui/src` reads either, and there
  is no way to copy a selection out. `Composer` and `MentionTextarea` in `asking.tsx` build
  on it as they build on `TextareaRenderable` today; their `plainText` reads become a `value()` read.
- **The `pty` rectangle.** A `pty` node kind whose component (`apps/tui/src/kit/rectangle.tsx`,
  rewritten in place) owns a headless xterm `Terminal` sized to the last rect. On `onSizeChange` it
  calls `term.resize`. It implements the `CellTerminal` interface `apps/tui/src/kit/pty.ts` already
  speaks (`write`, `onData`, `onResize`, `size`), so `pty.ts` does not change. Paint copies
  `buffer.active` cells into the rect with their fg, bg, bold, dim, underline, inverse, and the
  cursor when the rectangle is entered. A key encoder (new, beside the component) maps our `KeyEvent`
  to the bytes a terminal sends, honouring application cursor keys mode, bracketed paste, and the
  modifyOtherKeys or kitty state the emulator reports through its modes; the emulator's own `onData`
  carries responses (device attributes, cursor position reports) back to the PTY as today. The
  Escape-pair contract, the 400 ms window, the arming on Enter, and "entered is a fact about the
  screen" carry over verbatim from [tui.md](../../tui.md) § The Rectangle contract; `onScreen` is now
  a walk over our tree.
- **Mouse hit testing.** A `hit(x, y)` over the tree returning the deepest node whose rect contains
  the point. A press walks up to the nearest stop the store recognises and focuses it, as phase 1's
  design says; a wheel walks up to the nearest viewport. Nothing else is done with the pointer, per
  [tui.md](../../tui.md) § What the TUI never does.
- **Wiring the parser.** `apps/tui/src/keys/install.ts`'s host adapter (phase 1) subscribes to the
  parser's key events instead of `renderer.keyInput`. Focus in and out feed `setHostFocused` as the
  DEC 1004 events do today. Paste reaches the focused input or textarea as text.

  One thing to get right on the first attempt, because it fires everywhere at once. The parser asks
  for kitty flag 2, event reporting, which `../main.tsx` has never asked for: OpenTUI's
  `useKittyKeyboard: { disambiguate: true }` builds flags 1 and 4 and never 2, so no terminal has
  ever sent this app a key release. On a terminal that speaks the protocol, every key now arrives
  twice, once as `press` and once as `release`, and a subscription that does not filter fires every
  binding twice. `onKeyPress` takes `press` and `repeat`; `onKeyRelease` takes `release`; the typing
  hand-off in `install.ts § typeInto` takes `press` and `repeat` only, or a character is typed twice.
  A test at 80 by 24 that presses one key and counts one intent is the cheapest guard.
- **The golden comparison** now covers every golden, and `apps/tui/src/kit/kit.test.tsx`,
  `apps/tui/src/layouts/layouts.test.tsx`, `apps/tui/src/keys/keys.test.tsx`, `apps/tui/src/panes.test.tsx`,
  `apps/tui/src/chrome/chrome.test.tsx`, and `apps/tui/src/reachability.test.tsx` run under `own` with
  no skips.

Out: selection and copy inside the pty (OpenTUI's emulator had it; nothing in the kit exposes it;
`CopyButton` is the copy path). Sixel or kitty graphics. An `editor` rectangle that is anything other
than a box handing off to `$EDITOR`, which is [tui.md](../../tui.md)'s door left open and stays open.
Virtual `Rows` changes; the component stays the virtualiser it is, and the diff pane's windowing is
performance phase 9.

## Design

**Widgets are components with state, not nodes with behaviour.** This is the sentence that keeps the
node tree plain. A `scrollbox` node has an `offset` prop; the *component* has the signal, the key
handlers, and the clamp. Paint reads the prop. Nothing on the node knows how to scroll, so nothing on
the node can be in a state the component disagrees with. The same for `value` and `cursor` on an
input, the model on a textarea, and the `Terminal` on a pty (passed by reference as a prop, since
paint must read its buffer).

**The dispatcher hands a key to a component, not to a node.** Phase 1 calls `handleKeyPress` on an
OpenTUI renderable. Here the component registers its `edit` function with the store when it takes
focus (`stops.ts` already has the registration shape for a pressable), and the dispatcher calls it.
`isTyping` is "the focused node's kind is `input` or `textarea`", read off the node.

**xterm headless is the emulator because it is already here.** `apps/desktop`, `plugins/terminal`,
and `plugins/agents` depend on `@xterm/headless` 5.5.0, and
`plugins/agents/src/server/usage/processRunner.ts` shows the Node import shape (`createRequire` for the
CommonJS build). The desktop draws the same PTY through xterm.js in the browser, so a program's output
is parsed by the same parser on both hosts and looks the same. The one thing headless xterm lacks is a
keyboard, hence the encoder. The mapping is
documented in xterm.js's own `Keyboard.ts` for the browser build; ours covers what a terminal program
can receive, not what a browser can send.

**Cursor position is paint's.** One node at most is focused and typing; paint writes `CSI row;col H`
for its cursor after the frame and shows the cursor, and hides it otherwise. An entered pty draws the
emulator's cursor at its buffer position translated into the rect. OpenTUI's `setCursorPosition`
becomes two lines in flush.

## Code touched

- `apps/tui/src/kit/scrolling.tsx`, `apps/tui/src/kit/asking.tsx`, `apps/tui/src/kit/rectangle.tsx`:
  rewritten in place under the switch. While the switch exists each file has both implementations
  behind `__ACORN_PAINTER__`; phase 4 deletes one.
- `apps/tui/src/paint/` grows the four kinds' draw functions and the cursor write.
- `apps/tui/src/layout/` grows the unconstrained content measure for a viewport.
- `apps/tui/src/input/` grows nothing; the parser is complete from phase 2. The pty key encoder is
  `apps/tui/src/kit/ptyKeys.ts` (new).
- `apps/tui/src/keys/regions.ts`: `hit`, and the two hide-site `scheduleSettle` calls move into
  `setProperty('visible')`.
- `apps/tui/src/keys/install.ts`: the parser subscription.
- `apps/tui/src/keys/stops.ts`: registering an `edit` function.
- `apps/tui/package.json`: `@xterm/headless` added at the version the other three packages pin.

## Tests

- `apps/tui/src/kit/scrolling.test.tsx`: existing cases, plus a wheel over a viewport moves its offset
  and not the focus, and a reveal of a freshly mounted row reads the current frame's geometry (the
  case the second reveal existed for, now passing with one reveal).
- `apps/tui/src/kit/kit.test.tsx`: the `Input`, `Textarea`, `Composer`, and `MentionTextarea` cases
  unchanged, plus cursor motion over a wrapped textarea and a paste into each.
- `apps/tui/src/kit/ptyKeys.test.ts` (new): every key the tiers name encodes to the bytes a real
  terminal sends in normal and application cursor modes, checked against a recorded table.
- `apps/tui/src/kit/rectangle.test.tsx` (new or existing cases moved): a pty rectangle draws what the
  emulator holds after a `write`, resizes the emulator on a layout change, hands Enter and Escape to
  the contract, and stops taking keys when hidden.
- The reachability suite under `own`, both sizes, all eleven invariants.
- `apps/tui/src/golden.test.ts` (new in phase 2): every golden matches.

## Docs owed

None until phase 4. The pty encoder's mode table is documented in its own file header.

## Done when

- Every golden matches under `own`.
- Every suite under `apps/tui/src` passes under `own` with no phase 3 skip markers left.
- `apps/tui/src/kit/pty.ts` is byte-identical to its state at `9e5d90ca`, which is the proof the
  `CellTerminal` seam held.
- A `$EDITOR` handoff (vim in an `editor` rectangle, per [editor.md](../../editor.md) § Editing in your
  own editor) works in a real terminal with the switch on, checked by hand and noted here with the
  terminal it was checked in.

## Verify before building

- Spike 4's answer is written in [phase-0-baseline-and-spikes.md](./phase-0-baseline-and-spikes.md).
- Confirm `@xterm/headless` is still 5.5.0 in the three packages and that `buffer.active.getLine(y)`
  and `getCell(x)` with `getFgColor`, `getBgColor`, `getFgColorMode`, `isBold`, `isDim`,
  `isUnderline`, `isInverse`, `getWidth`, and `getChars` are still the API; read the installed
  `typings/xterm-headless.d.ts`.
- Confirm `apps/tui/src/kit/pty.ts` still speaks `CellTerminal` with the four members, and that
  nothing else implements the interface.
- Confirm `apps/tui/src/kit/asking.tsx` still reaches `TextareaRenderable` only through `plainText`
  and the `onContentChange` and `onSubmit` props, so the textarea's surface is what this file says.
- Read [tui.md](../../tui.md) § The Rectangle contract and § Scrolling viewports in full first.

## What building it found (2026-09-04)

The first slice is built: the scroll viewport under our painter, the wheel that moves one, the second
reveal resolved, and Yoga's `flexShrink` default settled. `apps/tui/src/kit/scrolling.tsx` is
rewritten in place with both implementations behind `drawsOwn()` — 274 lines for the file, of which
the new viewport is 100 and the id walk beside it is 12, against architecture.md's budget of about
150. Two new files' worth of work outside it: `apps/tui/src/tree/hit.ts` (93 lines: the rectangle walk
and the wheel), and about thirty lines spread over the layout pass, the paint pass and the prop table.
`apps/tui/src/kit/scrolling.test.tsx` keeps all seven of its cases and gains two, and all nine pass
under both painters. Not built, and deliberately: `Input`, `Textarea`, the `pty` rectangle, the
parser's wiring, and focusing a clicked stop.

The shape held. A widget is a component with state and a node with a prop, the offset is one number,
and the clamp is one function. Fourteen things this file or
[architecture.md](./architecture.md) said turned out otherwise.

**The offset is applied in the layout read-back, not in paint.** § Scope says paint translates the
content by `-offset` and clips. Paint already clips every child to its parent's content box, so the
only thing missing was the translation — and putting it in `apps/tui/src/layout/pass.ts § readBack`
buys the same answer to three more questions. A rectangle is where a node is on the screen, so a
translated rectangle is what `scrollChildIntoView` compares, what the wheel's hit test walks, and what
the region store reads through `x` and `y`. Translating in paint alone would have left those three
reading a position nothing was drawn at. Paint's share of a viewport is therefore the bar and nothing
else.

**The bar is drawn over the viewport's last column rather than given one, and that is what keeps the
frame from oscillating.** OpenTUI's bar is a sibling of its viewport, so it costs a cell of layout
while it is visible — and that is a cycle: the content's height depends on the width it wraps at, the
width depends on whether the bar is showing, and whether the bar is showing depends on the height. A
frame that resolves that by iterating is a frame that can fail to settle. Overlaying costs the
rightmost column of a scrolling document and nothing else, and no golden in the set holds a visible
bar, so nothing measures the difference either way. The two characters and the thumb's size and place
are `apps/tui/src/kit/showing.tsx § THUMB`'s, because there is one bar in this app and it should look
like itself.

**A viewport is two nodes and the content box's props are the whole of the measure.** The viewport
takes the height its flex parent gives it and the content takes the height its own children need, so
`flexShrink={0}` on the content is what makes an overflow exist to scroll. Without it the content is
squeezed to the viewport and there is nothing below the fold, which is exactly the `overflow="scroll"`
failure this seam exists to avoid.

**`minHeight: '100%'` cannot say "at least as tall as the viewport" here, and it took the `editor`
golden to catch it.** OpenTUI's content box says it that way and it is right there; ours resolved the
percentage against the height the *grandparent* offered rather than the height the viewport ended up
with, so every content box came out one row taller than its viewport — a bar on every panel whose
content fits, and a row of scroll in every document that does not. `flexGrow={1}` says the same thing
in flex and measures right: the content is exactly the viewport's height while it fits, and its own
height once it does not. Worth knowing because the percentage is not obviously wrong and the frame it
draws is only wrong by one row.

**A `flexGrow` child needs the content box to have a height, so the grow is load-bearing twice
over.** A virtual `Rows` asks its parent how tall it is and windows to that; inside a box only as tall
as its children a `flexGrow` child gets nothing, and the list drew no rows at all. That was the first
cut of this file, and `apps/tui/src/kit/scrolling.test.tsx § moves a virtual list window with the
wheel` is the case that says so.

**`flexShrink` is settled, and it is the rule the old painter derived rather than the 1 phase 2
tried.** `Renderable.setupYogaProperties` in @opentui/core 0.5.9 reads: an explicit `flexShrink`
wins; otherwise it is 0 where a numeric `width` or `height` was given and 1 everywhere else. That is
now `apps/tui/src/layout/props.ts § flexShrinkFor`, re-derived in `setProperty` whenever any of the
three props lands, because they arrive one at a time and in whatever order the JSX spelled them. The
kit is written against exactly this: 153 of its boxes say `flexShrink={0}` out loud and none says 1.

**And the `ConfirmButton` layout that never settles does not reproduce.** Both its cases pass in
about a tenth of a second with a blanket 1, as does every other case in this package, so whatever
phase 2 met is not in the tree at `cf374cbd` — either it was another edit of that slice or it was the
`minHeight: '100%'` content box above, which is a genuine feedback loop and was written the same
afternoon. What a blanket 1 does get wrong is measurable and a golden caught it: `changes` at 120
draws its list column at `width={split.size()}`, a numeric width, and a blanket 1 let the column
shrink from 30 cells to 22 — 74 differences that the derived rule takes to 16. So the default is
derived, three things in the package need it (a `TableRow`'s caret marker, both halves of a `Sections`
strip, and that split column), and the question is closed.

**The second reveal is gone under our painter and it is a branch rather than a deletion.** Under
`own` the reveal runs once, on the `frame` event, which is between the layout and the paint of one
frame: the geometry it reads is the geometry the reader is about to see, and the synchronous reveal in
`setFocus` is skipped. Under OpenTUI both stay exactly as they were, because that painter ships today
and its `frame` is the render loop's rather than ours. Phase 4 deletes the branch with the painter.
`apps/tui/src/kit/scrolling.test.tsx § reveals the caret in a list that has only just mounted` passes
under both, and the new case beside it says something the old one could not: the revealed row lands
exactly at the edge it came in from, which is the promise one reveal can make and two never could,
because the second was correcting the first.

**`scrollChildIntoView` takes an id, so the component owns a walk.** The store names the child by
`node.id` because OpenTUI's method took a string, and ours mints an id per node
(`apps/tui/src/tree/compat.ts`), so the viewport searches its own subtree for it. Twelve lines, and
they are the only place the reveal touches the tree.

**The viewport's five members go on the node as property descriptors.** `scrollBy`, `scrollTo`,
`scrollChildIntoView`, `scrollTop`, `scrollHeight` and `viewport.height` are what the rest of the app
asks a viewport for, and two of the callers reach it through the tree rather than through the
component: the store's reveal, and `DiffPane`, which reads the offset and the height off the box its
`onBox` was handed. So the component installs the same object it binds its keys to. Descriptors
rather than a spread, because `Object.assign` copies what a getter answers rather than the getter, and
before the first layout that is nought.

**`offset` cannot be a JSX attribute while the switch exists.** tsc types every intrinsic in this
package against OpenTUI's closed prop shapes whichever painter the build picked
([phase 2](./phase-2-the-painter.md) § The ten-line colour adapter), and `ScrollBoxOptions` has no
`offset`. So the component writes it into `node.props` from an effect, which lands where an attribute
would land and asks for the frame `setProperty` would have asked for. It is in `NOT_YOGA` all the
same, because paint reads it.

**A wheel event's shape is load-bearing and the order of the walk is too.** `Rows virtual` reads
`event.scroll.direction` and `event.scroll.delta` and calls `stopPropagation`, so the wheel our
`wheelAt` delivers is OpenTUI's `MouseEvent` cut down to those members. The walk is the hit node
upwards, each node's own handler, and the first viewport on the way up moves its offset — which is
what lets a virtual list take the wheel before the viewport under it does, and lets `DiffPane`'s box
*above* the viewport read an offset that has already moved. One notch is three rows, with no
acceleration.

**A viewport inside a parent with no height of its own draws nothing, and the two Yoga builds
disagree about why.** Given a column parent whose own height is `auto`, ours has a `flexBasis: 0`
child contribute its basis — nought — so the box is nought tall and everything inside it is clipped;
OpenTUI's contributes the child's content, so the same tree comes out a row tall. No `Config` knob in
yoga-layout 3.2.1 reproduces it: web defaults, every errata and the web-flex-basis experimental
feature were each tried, and OpenTUI's factory is `Node.createForOpenTUI()` on the Zig side, which
this build cannot construct. Two kit cases put a viewport straight inside a `Stack` and are held for
it; nothing in the app does, because every viewport it draws is inside a `Panel` or a grown column,
where the two builds agree.

**The footer asked "is this a viewport" with an `instanceof` too.** `apps/tui/src/chrome/bindings.ts
§ focusedKind` is the row that tells a reader the arrows scroll here rather than move, and a plain
object is not an instance of `ScrollBoxRenderable`, so a viewport holding the keys advertised the
wrong words. It asks `apps/tui/src/keys/regions.ts § isViewport` now, which is exported for it, and
phase 4 deletes that function's first half.

**`apps/tui/src/invariants.test.ts` insists the string `overflow="scroll"` appears in
`apps/tui/src/kit/scrolling.tsx`, and the only place it appears is a comment.** The invariant reads as
being about JSX — a clip may only be spelled in the viewport seam — and it is satisfied by this file's
header prose saying what a clip is not. A rewrite that dropped the sentence would fail an invariant
about a prop it does not use.

### The four the viewport unblocked, and why none of them matches yet

`pr` and `changes` came off `apps/tui/src/golden.test.ts § PHASE_3` at both sizes, because the two
throw sites phase 2 named — `viewport.viewport.height` in `apps/tui/src/kit/showing.tsx` and
`box.viewport.height` in `apps/tui/src/kit/scrolling.tsx` — are both answered. All four still differ,
and by three different things, none of them the viewport:

- **`pr` at both sizes** reaches `area.setText` in `apps/tui/src/kit/asking.tsx § Textarea` before it
  draws anything, and `PanelBody` catches it and draws `! pr area.setText is not a function` in place
  of the pane. So the frame says nothing about the painter and the surface waits for the `Textarea`
  slice. This is a correction: phase 2 read `pr` as held by a scrollbox's `viewport`, and it is held
  by both.
- **`changes` at 80** differs by one row, and the row is the pane's own header. Our `flush` turns the
  event loop until the tree stops asking for frames, which drains the fixture's delayed answers, so
  `ChangesHeader` is on screen; the old painter's flush settles a step earlier and the golden holds
  that screen. Checked rather than assumed: the same comparison run against the *old* painter with
  `ACORN_FIXTURE_DELAY_MS` set reports 0 differences, and the same pane dumped without the delay draws
  the header under both painters. So it is the capture's depth of settling, not a painter difference,
  and it is the same hazard `ACORN_FIXTURE_DELAY_MS` exists to expose.
- **`changes` at 120** is down from 74 differences to 16 with the `flexShrink` default derived, and
  each of the 16 is one cell: on every row that overflows its column, the last child keeps a cell
  under OpenTUI that it loses here — the `⧉` of a copy button, a status glyph, two characters of a
  file name. Both painters squeeze the same rows by the same total; they differ in how the negative
  free space rounds across the children. That is the two Yoga builds again rather than anything above
  them, and it wants a look at `pointScaleFactor` from somebody with a spare afternoon.

**So no `#00AAFF` run was corrected in this slice.** The correction rule reads the colour off the live
frame at the same column, which needs a frame whose characters line up, and none of these four lines
up yet. The 164 runs in the twelve held goldens are still owed, and the count is unchanged.

### Test results (2026-09-04)

`pnpm --filter @acorn/tui test` on Node 26.8.1 with the switch at its default: 451 passing, 2 failing,
28 skipped, against a baseline of 449 and the same 2 — the two extra passes are this slice's two new
cases, which run under both painters. The two failures are `walks into a command group on return and
back out of it on escape` and `draws a search and an input in the same rectangle as the list`, both in
`apps/tui/src/chrome/chrome.test.tsx`, both another session's in-flight palette work.
Two more reds appeared in a run taken while a golden comparison was using the other cores —
`apps/tui/src/diffLong.test.tsx` timing out at 120 seconds against its own 83-second case, and
`apps/tui/src/kit/kit.test.tsx § is a parent stop` cascading off it — and both pass on their own. Worth
knowing before blaming a diff: this suite spawns a renderer per case and its long cases sit close
enough to their timeouts that a busy machine reds them.

On Node 24.11.0 with `ACORN_TUI_PAINTER=own`, no FFI and no flag: 419 passing, 34 failing, 28 skipped,
against 405 passing, 44 failing and 30 skipped before the slice. Everything this slice owns is green —
`apps/tui/src/golden.test.ts` is 16 passing and 12 skipped, `apps/tui/src/kit/kit.test.tsx` is 95
passing and 16 skipped (up from 93 and 18: `DiffPane` and `TableRow` run now),
`apps/tui/src/layouts/layouts.test.tsx` is 20 for 20, `apps/tui/src/kit/scrolling.test.tsx` is 9 for 9
where it was 0 for 7, and every unit suite passes. The 34 that remain are the same files that were red
before it — the chrome, panes, keys, reachability, smoke, browse, controls, extensions and spatial
suites — and each of them waits on typing, a field's content or a click, which is the rest of this
phase. Three of them went green as a side effect of the viewport and are not counted anywhere else.

`pnpm --filter @acorn/tui lint` is clean. `tools/arch` fails only its pre-existing `docPaths` case
over dotfile paths in three other docs.

`apps/tui/scripts/check-startup-graph.mjs` measures the eager closure at 929,039 B under `own` and
935,065 B under `opentui`, against 921,137 B and 928,320 B before the slice. Both grew by about 7 KB
and it is this slice's own prose: the build does not minify, and `apps/tui/src/kit/scrolling.tsx` went
from 95 lines to 274 in a file that was already in the graph. Nothing new is reachable from `App` —
`apps/tui/src/tree/hit.ts` is only reached through `apps/tui/src/ownRenderer.ts`, which the composition
root still reaches through one `import()`, and the two modules the component does import statically,
`apps/tui/src/painter.ts` (deleted in phase 4) and `apps/tui/src/tree/frames.ts`, are seventeen and
thirty lines with no imports of their own. Both numbers are over the 870,000 B ceiling the check has been failing since
before this programme.

### What the next slice must know

- **The offset is the read-back's**, so `Input`, `Textarea` and `pty` should look at
  `apps/tui/src/layout/pass.ts § A viewport moves its children` before inventing a second way to move
  cells. A widget that scrolls its own content horizontally — a field wider than its box — is the same
  shape one axis over, and the honest place for it is the same function.
- **`apps/tui/src/tree/hit.ts` already has the walk a click needs.** `hit(root, x, y)` answers the
  deepest node under a cell; what is missing is `focusClicked` calling it, which is
  `apps/tui/src/keys/regions.ts § Clicks are hit tests` and two kit cases in
  `apps/tui/src/kit/kit.test.tsx § PHASE_3`.
- **`isTypingTarget` in `apps/tui/src/keys/install.ts` is still two `instanceof`s**, and it is the
  reason nothing types under our painter. `apps/tui/src/keys/regions.ts § isViewport` is the pattern:
  ask the kind as well, export it if a second caller needs it, and let phase 4 delete the class half.
  The footer's `focusedKind` needed exactly that treatment this slice.
- **A widget's imperative API goes on the node from the component's `ref`,** as property descriptors,
  and the shape to copy is `apps/tui/src/kit/scrolling.tsx § api`. An `Input` owes `value`, a
  `Textarea` owes `setText` and `plainText`, and both are read off the node by components that never
  learn which painter drew them.
- **A new prop cannot be a JSX attribute while the switch exists** unless OpenTUI's own prop types
  carry it. `value` and `placeholder` already are; anything new is a `node.props` write from an effect,
  the way `offset` is.
- **The two Yoga builds differ in two measured ways**, and neither is above the layout pass: a
  `flexBasis: 0` child's contribution to an auto-height parent, and how negative free space rounds
  across the children of an overflowing row. Both are recorded above with what was tried. If a widget
  frame comes out one cell or one row off, look there before looking at paint.

## What building the fields found (2026-09-04)

The second slice is built: `Input` and `Textarea` under our painter, the model under both, and the
typing hand-off that reaches them. `apps/tui/src/kit/asking.tsx` is rewritten in place with both
implementations behind `drawsOwn()`: the shared half, `ownField`, is 83 lines of code in 131, and the
two JSX bodies over it are 16 and 18. Two new files beside it, `apps/tui/src/wrap.ts` (71 lines of
code in 154: the wrap, the two offset-to-cell functions, and the cache paint and Yoga share) and
`apps/tui/src/kit/field.ts` (150 in 265, of which the key table is 33). Paint's share is 28 lines of
code in 68. Against a budget of about 135 for the model plus the wrap and about 150 for the input:
221 for the model and the wrap together, 117 for the components, so over on the first and under on
the second, and the overrun is the wrap turning out to be a file with two other owners rather than
the textarea's own.

Spike 4's design held without a change: a plain string, two offsets beside it, one 44-line wrap, no
`@codemirror/state`. Selection and undo stayed out and nothing missed them. Fourteen things this file,
[architecture.md](./architecture.md) or the spike said turned out otherwise.

**The two key tables are one table, and the whole of the difference is a flag.** § Scope budgets a key
table for the `Input` and another for the `Textarea`. `InputRenderable` is `TextareaRenderable` with
`height: 1` and one binding changed — Return submits instead of inserting a newline — so `edit` takes
a `newline` boolean and the tables collapse. Two would have been the same twenty lines written twice
and would have drifted the first time somebody added a chord. The flag does a second job for free:
"does Return insert one" and "does this field wrap" are the same question, so the same parameter
decides whether `scroll` counts cells or rows.

**Up and Down come out inert on a one-row field by returning `false`, not by being left out.** The
spike's model clamps a vertical move to the ends of the document when there is no row to move to;
[tui.md](../../tui.md) § The five key groups says the move group goes inert in a field except inside a
multi-line one. Answering "there is no such row" with `false` satisfies both and is what lets one
table serve both fields: a handler that changed nothing says so, and the key bubbles the way every
other declined intent does.

**Nothing typed under our painter for a second reason, and it is upstream of the one the last slice
named.** `isTypingTarget` being two `instanceof`s was real and is fixed — `apps/tui/src/keys/regions.ts
§ isField` now answers it, and the footer's `focusedKind` reads the same function. But even with the
predicate right, the store would never have given a field the keys: `focusable` on a node is
`props.focusable ?? kind === 'scrollbox'` (`apps/tui/src/tree/compat.ts`), no component asks a field to
be focusable, and `EditBufferRenderable` sets the flag on itself. So the accessor's default is a set of
three kinds now. Worth knowing because the two faults look identical from the reader's seat and fixing
either alone changes nothing.

**A field's height is a prop, and it has to be, because the height decides a second thing.**
`InputRenderable`'s constructor hands `height: 1` to the textarea it extends, and Yoga's shrink
default is derived from a *numeric* height (`apps/tui/src/layout/props.ts § flexShrinkFor`), so a
height written straight to the Yoga node would have left every field shrinking in an overflowing row —
which is `KeyValueEditor`'s row of two of them. It cannot be a JSX attribute either:
`InputRenderableOptions` omits `height` outright. So `apps/tui/src/tree/node.ts § INTRINSIC` is what a
kind arrives with, applied through `setProperty` in `createElement` so the prop, Yoga and the derived
shrink all see it. One entry, and the mechanism is worth more than the entry: it is where the `pty`
rectangle's own defaults go.

**A `textarea` is a Yoga leaf with a measure function, and that was measured rather than read.**
Nothing in `@opentui/core` calls `setMeasureFunc` for an edit buffer, so the honest expectation was a
zero-height box. A textarea stacked between two lines of text moves the line below it down one row per
line of content, so the renderable is as tall as its wrapped rows whatever the source says, and that
is why a `Textarea` without `grow` is exactly as tall as what is in it. Ours says it with a measure
function (`apps/tui/src/layout/measure.ts § measureField`) and matches row for row, wide characters
included.

**The wrap cache cannot live in the layout module, and the check that would have caught it does not
look at bare imports.** `apps/tui/src/layout/measure.ts` imports `MeasureMode` from `yoga-layout`,
which is a runtime value, so a static import of that module from `apps/tui/src/kit/asking.tsx` — which
`main.tsx` reaches eagerly — put the whole own-painter layout module and Yoga's wasm binary into the
startup closure of the **OpenTUI** build: 41 KB of chunk and an `await loadYoga()` before a frame the
loaded Yoga will never lay out. `apps/tui/scripts/check-startup-graph.mjs` walks relative chunk edges
and `yoga-layout` is left external, so the byte count moved by 41 KB and never named the cause. The
cache is in `apps/tui/src/wrap.ts` instead, which imports `./width` and a type. Exactly the trap
`apps/tui/src/ownKeys.ts` was split out to avoid, one module over.

**The component wraps with the pure function rather than reading the cache paint reads, and that is
the safer of the two.** The cache is keyed by the `value` prop the component itself writes from an
effect, so a read of it inside a keystroke would depend on Solid having already flushed that effect —
true today, and a trap for the next person. `wrapRows(text, width)` is pure, so the component's answer
and paint's are the same answer by construction rather than by ordering, and the cost is the one wrap
spike 4 budgeted per keystroke. The cache still earns its keep: it is what makes a frame that moved
nothing wrap nothing.

**A field needs no invalidator, and the reason is where its text comes from.** A run's characters are
its `#text` children, which the reconciler patches, so `invalidateRun` has to be called. A field's are
one prop the cache reads on the way in, so a value that changed is a key that does not match. What the
component still owes is `markDirty` on the Yoga node, because Yoga will not call a measure function it
does not believe is stale — and only for a `textarea`, because marking a node that has no measure
function aborts the wasm module.

**The caret is the terminal's own and it belongs on the buffer, so that the diff can leave it
unsaid.** § Design says paint writes `CSI row;col H` after the frame. Putting the position on the
`Buffer` as one nullable pair instead means the flush compares it like everything else: a frame that
moved nothing writes nothing, caret included, and a frame where the caret alone moved writes six
bytes. `DECTCEM` — `CSI ?25h` and `CSI ?25l` — is the other half, and hiding it on every frame with no
focused field is what stops a caret parking in the corner of a list.
`apps/tui/src/input/terminal.ts`'s enter sequence already hides the caret, so the buffer's initial
`null` matches the terminal's real state and the first frame says nothing it need not.

**Two colours had to be said out loud, not one.** Phase 2 corrected 352 runs of `#00AAFF`, OpenTUI's
default `focusedBorderColor`. A field has a second: `TextareaRenderable`'s `placeholderColor` defaults
to `#666666`, which is no more one of the sixteen slots than the blue was and comes from no theme
either. The fix is the same shape as the one the components already carry for `textColor` — the kit
names the slot, so both painters read it — and it is a prop rather than a decision in paint, which is
what keeps the role vocabulary in `apps/tui/src/kit/roles.ts` and out of the painter.

**`Composer` and `MentionTextarea` needed no change at all**, which is one better than § Scope
expected: it says their `plainText` reads become a `value()` read. The last slice's own advice was
right instead — a widget's imperative API goes on the node from the component's `ref` — so
`plainText`, `setText`, `insertText`, `handleKeyPress` and `handlePaste` are installed as property
descriptors and every caller above the field is one piece of code. The dispatcher's hand-off gets the
same benefit: `typeInto` still calls `node.handleKeyPress?.(event)` and does not know which painter
answered.

**A harness key had nowhere to put the character it types.** `ownKeyEvent` set `sequence` to the key's
*name*, so Space typed the word "space" and a capital typed a lower-case letter — the case having
moved into the modifier, which is right for a binding and useless for a field. `sequence` now carries
what the key types and is empty for a key that types nothing, which is what
`apps/tui/src/input/events.ts § KeyEvent` already says about `text`: what a Return does inside a field
is the model's decision from the name, not a character the terminal invents. Nothing else in the
package read `sequence`.

**A paste is a second hand-off and it is ours alone.** OpenTUI's renderer delivers a paste to the
renderable *it* has focused, and the caret mirror has focused the same field, so that route works
today and a second listener would paste twice. `apps/tui/src/keys/install.ts § pasteInto` is therefore
registered only under our painter. It is the one place in this slice branching on the switch for a
reason other than "there are two implementations", and phase 4 leaves it.

**`apps/tui/src/layout/measure.ts` was committed with two NUL bytes in it and git had stopped
diffing the file.** They are the separators in `measuredRun`'s cache key, where two spaces were
plainly meant, and they arrived in the previous slice — almost certainly out of the same
heredoc-through-python tooling this slice used. The file reads as binary to git, so its diff has been
`Bin 5003 -> 8222 bytes` rather than lines. Replaced with spaces; the key is internal and nothing
holds it. Worth checking a new file for once per slice, because nothing else in the suite notices.

### The eight the fields unblocked, and the five that are left

Seven of the eight match cell for cell and the eighth does not, and none of the five surfaces still
held is held by a widget:

- **`browse`, `palette` and `pr` at both sizes, and `notes` at 80 by 24** match, run for run, after
  their `#00AAFF` and `#666666` runs were corrected. `pr` was the surface phase 2 read as a viewport
  and the last slice re-read as a `Textarea`'s `setText`; with `setText` on the node it draws the pane
  rather than the message.
- **`agents` at 80 by 24 differs by six rows of content, and the painters agree about every one of
  them.** Measured rather than argued: the old painter driven through this same harness, with
  `ACORN_FIXTURE_DELAY_MS` set, draws exactly the cells ours does on all 24 rows, and both differ from
  the golden — our `flush` turns the loop until the tree stops asking for frames, which drains the
  fixture's delayed answers, so a "NEEDS YOU" section the capture never saw is on screen. That is the
  same hazard as `changes` at 80 and it is now the stronger statement: the capture is the shallower
  screen, not the painter a different one. The seven rows of that surface that *do* line up carry its
  blue, so they were corrected and only the six content rows are held.
- **`agents` and `notes` at 120 by 40 differ by one cell on rows that overflow their column**, which
  is the second of the two recorded Yoga-build differences and not the painter's: the last child of a
  squeezed row keeps a cell under OpenTUI that it loses here. On `agents` it knocks on, because the
  cell it loses is enough for the composer's hint to stop wrapping, which moves four rows up by one.
  The old painter through this harness matches the golden on both, which is what says it is the
  layout and not the settling.

**137 runs were corrected in this slice**, in ten files, by phase 2's rule: read the colour off the
live frame at the same column, and refuse it unless it is one of the sixteen slots or the terminal's
own foreground. 132 were `#00AAFF` and all 132 took the accent slot; five were `#666666` and all five
took the palette's grey. Per file: `browse` 12 blue and 1 grey at each size, `palette` 22 and 1 at
each size, `notes` 12 and 1 at 80 and 12 blue at 120, `pr` 12 blue at each size, `agents` 12 blue at 80
and 4 at 120. The correction runs row by row rather than per file, which is what made `agents` at 80
correctable at all. What is left uncorrected is 32 blue and 4 grey: `changes` at both sizes, which is
not this slice's, and the rows of `agents` at 120 and `notes` at 120 whose characters do not line up.

The rule needs a live frame, and the recipe is five lines: write `live` to
`apps/tui/golden/live-<name>.json` from `apps/tui/src/golden.test.ts` beside the `compare` call, run
the suite under `own`, then walk the two files together taking the live colour wherever the golden
holds a hex and the row's characters match. Left out of the tree deliberately — a test that writes
files is a test with a side effect — but phase 4 will want it once more.

**`notes-80x24`'s one non-deterministic span is accepted rather than compared.** Phase 0 asked for
this: the file flips a single `inverse` bit on the word `Scratchpad` across runs, because at 80 the
notes pane sometimes opens with no row marked as current, and both states are where the screen comes
to rest. `apps/tui/src/golden.test.ts § RACES` drops that one bit from that one run on both sides, so
everything else about the span is still compared. A golden that cannot be trusted about one bit should
not become a golden nobody checks.

**The held list is keyed by name and size now, because the reasons stopped agreeing across the two.**
At 80 the harness settles deeper than the capture did and at 120 the Yoga builds round a squeezed row
differently, and one entry per surface could only say one of them.

### Test results (2026-09-04)

`pnpm --filter @acorn/tui test` on Node 26.8.1 with the switch at its default: **475 passing, 2
failing, 28 skipped**, against 451, 2 and 28 before the slice. The 24 extra passes are this slice's new
cases, all of which run under both painters. The two failures are `walks into a command group on
return and back out of it on escape` and `draws a search and an input in the same rectangle as the
list`, both in `apps/tui/src/chrome/chrome.test.tsx`, both another session's in-flight palette work
and both failing before this slice.

On Node 24.11.0 with `ACORN_TUI_PAINTER=own`, no FFI and no flag: **488 passing, 8 failing, 9 skipped**,
against 419 passing, 34 failing and 28 skipped before the slice. Everything this slice owns is green.
`apps/tui/src/kit/kit.test.tsx` is 110 passing and 4 skipped, up from 95 and 16: the eleven field cases
run, three new ones join them, and the four still held are the two Yoga-build cases and the two mouse
ones. `apps/tui/src/golden.test.ts` is 23 passing and 5 skipped, up from 16 and 12.
`apps/tui/src/kit/field.test.ts` is new and 17 for 17. `apps/tui/src/paint/paint.test.ts` gains four
field cases and is 23 for 23. `apps/tui/src/browse.test.tsx`, `apps/tui/src/controls.test.tsx`,
`apps/tui/src/extensions.test.tsx`, `apps/tui/src/spatial.test.tsx`, `apps/tui/src/panes.test.tsx` and
`apps/tui/src/smoke.test.tsx` are green where they were red.

The eight that remain under `own`, each checked on its own:

- **Five in `apps/tui/src/reachability.test.tsx`, all at 80 by 24, and all of them pre-existing.**
  Measured against the tree at `a6a9e330`: seven failed there and five fail now, so this slice took
  `pr` and `editor` green and introduced none. Each of the five reports whole rail regions the walk
  never landed on — `changes` names a `Menu` row, `context` names two `BoxRenderable`s that are a
  region's frame of last resort — so it is region reachability at that width rather than anything a
  field does. Three of the five gained one owed stop, and it is the filter field inside a region the
  walk already could not reach. Not chased; the next slice or phase 4 owns it, and the cheap first
  question is why a rail region at 80 by 24 is not in the Tab cycle under this painter.
- **Two in `apps/tui/src/keys/keys.test.tsx`**, both the `pty` rectangle — `renderable.write is not a
  function` and a size the emulator was never told. The next slice.
- **One in `apps/tui/src/chrome/chrome.test.tsx`**, `walks into a command group on return and back
  out of it on escape`, which is one of the two failing under the default switch and is not this
  slice's. Its pair, `draws a search and an input in the same rectangle as the list`, fails under the
  default switch and came out red in one run under `own` and green in the next, so treat it as flaky
  under this painter rather than as a difference between them.

An earlier full run under `own` also red-ed `apps/tui/src/diffLong.test.tsx`, timing out at 120 seconds
against its own 83-second case, and `apps/tui/src/golden.test.ts § draws palette-80x24 cell for cell`,
timing out at 200 seconds while a golden comparison had the other cores. Both pass on their own and
neither appeared in the run above. That is the timeout cascade this suite has had all along: check
alone before blaming a diff.

`pnpm --filter @acorn/tui lint` is clean under both switch values. `tools/arch` fails only its
pre-existing `docPaths` case over dotfile paths in three other docs, and `@acorn/client-core` its
pre-existing icon census.

`apps/tui/scripts/check-startup-graph.mjs` measures the eager closure at 957,638 B under `opentui` and
954,069 B under `own`, against 935,065 B and 929,039 B before the slice: both grew by about 23 KB, and
it is this slice's own source — the build does not minify, `apps/tui/src/kit/asking.tsx` went from 646
lines to 909 in a file already in the graph, and `wrap.ts` and `field.ts` are reached from it. Both
numbers are over the 870,000 B ceiling the check has been failing since before this programme. The
41 KB and the eager `await loadYoga()` that the first cut of this slice added to the *OpenTUI* build
are gone, and the finding above says how they got there.

### What the last slice must know

- **`isTypingTarget` is answered and `apps/tui/src/keys/regions.ts § isField` is where.** An entered
  `pty` is the other typing target and a stricter one — every key is its input, chords included, until
  Escape — and it deliberately does not go through that predicate: the rectangle takes the keys before
  dispatch instead ([tui.md](../../tui.md) § The Rectangle contract). So the rectangle adds a route
  rather than a case to `isField`.
- **The hand-off is two listeners now, and the paste half is ours alone.**
  `apps/tui/src/keys/install.ts § typeInto` and `§ pasteInto` are the shapes the parser's key and paste
  events should arrive at when they are wired: `typeInto` already filters nothing by `eventType`, so
  the `press`-and-`repeat` filter § Scope warns about belongs on the subscription rather than here, and
  a key arriving twice would type twice.
- **A widget's imperative API on the node is the pattern, twice proved.** `scrollBy` and friends for
  the viewport, `handleKeyPress`, `handlePaste`, `plainText`, `setText`, `insertText` and `value` for a
  field, all as property descriptors from the component's `ref`. A `pty` owes `write`, `onData`,
  `onResize` and `size`, which is the `CellTerminal` interface `apps/tui/src/kit/pty.ts` already
  speaks, and `apps/tui/src/keys/keys.test.tsx` fails today with `renderable.write is not a function`
  for exactly that reason.
- **The caret is on the buffer and the pty's is a second writer of it.** `apps/tui/src/paint/paint.ts
  § drawField` sets `buffer.cursor` for the focused field; an entered rectangle sets it from the
  emulator's own cursor translated into the rect. At most one of the two can be true at a time,
  because at most one thing has the keys, but nothing enforces that — the last writer in the paint
  walk wins, and the walk order is the tree's.
- **`scroll` is the prop a widget slides its own content with**, cells or rows depending on the kind,
  clamped by the component so the caret is inside the box. A `pty` does not want it: the emulator owns
  its own scrollback and its viewport is the rect.
- **`INTRINSIC` in `apps/tui/src/tree/node.ts` is where a kind's own defaults go**, applied through
  `setProperty` so Yoga and the derived `flexShrink` see them. One entry today.
- **The five held goldens are two measured differences and no work**, and `apps/tui/src/golden.test.ts
  § PHASE_3` says which is which per size. Neither is above the layout pass. If phase 4 wants all 28,
  the honest routes are to re-capture the two that the harness out-settles and to spend an afternoon
  on `pointScaleFactor` for the three that round a squeezed row differently.

## What building the pty found (2026-09-04)

The last slice is built: the `pty` rectangle over `@xterm/headless`, the key encoder beside it, the
click hit test, and the input parser wired into the dispatcher. `apps/tui/src/kit/rectangle.tsx` is
rewritten in place with both emulators behind `drawsOwn()` — 399 lines where it was 235, of which 188
are code, and the two emulators' own halves are 34 lines of code in 60 and seven in 24. One new file
of its own, `apps/tui/src/kit/ptyKeys.ts`, which is 107 lines of code in 232 and of which the byte
tables are 44. Paint's share is 50 lines of code in 92, the click is 26 in 47 at the bottom of
`apps/tui/src/tree/hit.ts`, and the frame scheduler grew a hold, which is 24. Against
[architecture.md](./architecture.md)'s budget of about 150 for the encoder: 107, and the tables are
most of it. Two new test files beside them, `apps/tui/src/kit/ptyKeys.test.ts` and
`apps/tui/src/ownRenderer.test.ts`, and six cases added to `apps/tui/src/paint/paint.test.ts`.

The shape held. An emulator is a component's, a node carries a reference to it, and paint copies one
cell per cell. `apps/tui/src/kit/pty.ts` is byte-identical to its state at `9e5d90ca` — the same blob
hash, `8df7dcf7` — which is the proof the `CellTerminal` seam held. Eleven things this file,
[architecture.md](./architecture.md) or § Verify before building said turned out otherwise.

**`ctx.consume()` was a no-op under our painter, and the rectangle is the only thing in this app that
would ever have noticed.** `@opentui/keymap`'s `handleKeyEvent` asks the *event* whether an intercept
took the key — `if (event.propagationStopped) return` — and `apps/tui/src/ownKeys.ts § ownKeyEvent`
had `stopPropagation: () => {}` with no flag behind it. Its twin `defaultPrevented` was implemented,
one line above. So an entered rectangle sent every key to the program inside it and then let the app's
own bindings answer the same key: F6 walked out of the rectangle it had just taken, and
`ACORN_TUI_KEYS_TRACE` said `binding-handled` for a key an intercept had consumed. Two slices went by
without it showing because nothing else in this app intercepts — a layer is held off by priority and
never has to stop anything.

**`buffer` is behind `allowProposedApi` in `@xterm/headless` 5.5.0, and the buffer is the whole of
what paint reads.** `_checkProposedApi` throws from the getter, which here is from inside the paint
walk, so the process ends rather than drawing an empty box. § Verify before building is right about
every member it lists; the flag in front of them is the part nobody had written down. "Proposed"
means the shape may change in a major version rather than that it is unfinished, and `apps/desktop`
and `plugins/agents` read the same buffer through the same flag at the same pinned version.

**A write is the first thing in this tree that produces cells later rather than now, and
`frameRequested` had no way to say so.** Everything else is synchronous: an operation changes the tree
and the next turn draws it. xterm parses on a queue of its own, so a harness that draws as soon as
nothing is asking drew the screen from before the output. Measured rather than reasoned about: in a
bare Node process the parse lands on the eighth turn of `setImmediate`, and inside a test it had not
landed after the harness's twenty turns, which go by in two milliseconds — a zero-delay timer is a
millisecond, so a loop over `setImmediate` cannot outwait one however many turns it is given. So
`apps/tui/src/tree/frames.ts` grows a hold: a source that knows a frame is owed and cannot yet ask for
one takes one, `frameRequested` stays true until it lets go, and both harnesses wait the holds out
after their loop (§ framesSettled). It is the only mechanism in this programme that exists because
something outside the tree is slow.

**A node leaving the tree told nobody, and both classes of reachability failure were that.**
[architecture.md](./architecture.md) § 5 says `removeNode` tells the store and the landing pass runs.
It was never built, and under this painter nothing is destroyed, so there was no second signal to fall
back on. Two halves, one per failure class:

- `apps/tui/src/tree/compat.ts § removed` marks the top of a removed subtree and `insertNode` unmarks
  it, which is what `Suspense` handing the same object back looks like. `apps/tui/src/keys/regions.ts
  § onScreen` asks the question at the *end* of its parent walk, where it costs nothing, because only
  the top of a removed subtree is ever unlinked. Without it whole detached subtrees answered "on
  screen" from nowhere at all, and that is the five failures at 80 by 24: the reachability property
  filters the stops it owes by `onScreen`, so a stop a re-render had replaced was still owed.
- `removeNode` asks for a landing pass where the keys are no longer in the tree, and that is the seven
  at 120 by 40: a filter field the walk had replaced went on holding them and nothing looked again.
  Gated on `onScreen(focusedRenderable())` rather than fired on every removal, because a pass per
  removal would reveal the focused node in its viewports on every re-render — and read untracked,
  because `removeNode` runs inside whatever computation was updating the tree.

**`pty` type-checks as an intrinsic without being declared anywhere the OpenTUI build can see, and
that is what lets both emulators sit in one component.** `OpenTUIComponents` in `@opentui/solid` 0.5.9
is an interface with a string index signature, so `ExtendedIntrinsicElements` accepts any tag at all
and gives it `any` props. That is why `embedded_terminal` compiles today and why `<pty>` compiles
beside it, so the rectangle is one component with a ternary in its JSX rather than two components over
a duplicated intercept. The rule the last slice recorded still holds for the kinds OpenTUI names
itself: `scrollbox`, `input` and `textarea` have closed prop shapes, and a new prop on one of those is
still a `node.props` write from an effect, which is what `terminal`, `focused` and `onSizeChange` are
here.

**The emulator's modes are two, not four.** § Scope and [architecture.md](./architecture.md) both ask
the encoder to honour "the modifyOtherKeys or kitty state the emulator reports through its modes".
`IModes` in `@xterm/headless` 5.5.0 reports ten modes and neither of those is among them, so there is
nothing to honour and a chord is encoded the legacy way: the C0 byte for Ctrl, an `ESC` prefix for
Alt. The two that are there and matter are application cursor keys and bracketed paste. Application
keypad is reported and deliberately ignored, because our parser already names a keypad key after the
key it duplicates, so by the time a key reaches the encoder there is nothing left to tell apart.

**The emulator is loaded on the first rectangle rather than imported.** `createRequire` was going to
be needed anyway — the package ships one CommonJS bundle whose named exports Node's ESM loader cannot
see, which is the shape `plugins/agents/src/server/usage/processRunner.ts` already uses — and making
the call lazy costs one `??=`. It is worth the `??=`: this module is in `App`'s eager graph, so a
static import would put a whole terminal emulator into the startup of the build that draws its
terminals with OpenTUI's.

**A click is delivered the way a wheel is, and the store's half was already installed.**
`apps/tui/src/keys/regions.ts § focusClicked` sits on the root's `onMouseDown` under both painters and
walks up from `event.target`; what was missing was anything calling it.
`apps/tui/src/tree/hit.ts § pressAt` is that, and it is the old painter's order at both ends: the
deepest node under the cell, then each ancestor's own handler, so a stop's handler presses what was
clicked and the root's handler focuses it. `MouseButton.LEFT` is nought and is spelled out here rather
than imported, because this module deliberately reaches no OpenTUI.

**The paste gate had to come off `isTypingTarget`, and that is not a loosening.** An entered rectangle
is a typing target and a stricter one, and it deliberately does not go through that predicate — it
takes its keys by intercepting above every layer. So `apps/tui/src/keys/install.ts § pasteInto` asks
whether the focused node has a `handlePaste` rather than whether it is a field, and the two things
that install one are a field and a rectangle's box. Under the old painter the rectangle installs no
paste encoder at all, so nothing there answers and the shipping painter gains nothing it did not have.

**A chord types nothing, so the encoder reads the key's name where the text is empty.** The obvious
reading of `sequence` is "the character this key produced", and for Ctrl+C and Alt+B our parser
deliberately leaves it empty: a terminal that sent `ESC` first has already decided the key is not a
character (`apps/tui/src/input/parser.ts § character`). Reading the text alone therefore sent a shell
nothing at all for every chord, and the first cut of the encoder's own test hid it, because the test
built its keys through a helper that always filled the text in. The table has three rows spelled the
way the parser actually sends them now, beside the three spelled the way the harness does.

**The 256-colour cube is arithmetic, and it had to be done in paint.** A `Color` on this host is the
terminal's own, one of the sixteen slots, or a 24-bit triple, and a program inside a rectangle is free
to ask for any of 256. The first sixteen stay slots, which is the whole point of the type; above that
`apps/tui/src/paint/paint.ts § paletteColor` turns the cube and the grey ramp into triples, which is
what a terminal that takes 24-bit colour can draw and is no worse on one that cannot.

### The five goldens that are left

Every one of the 28 was compared with the held list emptied. Twenty-three match cell for cell and run
for run, and the five that do not are the same five by name that the field slice left, for the same
two reasons. This slice closed none of them and added none, which is what "neither is above the layout
pass" means in practice. The counts moved by one or two either way, because both reasons are about how
far a screen has settled and neither is stable to the cell. Each is listed with what would close it,
because phase 4 has to report this list, and `apps/tui/src/golden.test.ts § PHASE_3` carries the same
sentences where a reader running the suite will find them:

| Golden | Differences | Why | What would close it |
| --- | --- | --- | --- |
| `changes-80x24` | 23 | The pane's own header row. Our flush turns the loop until the tree stops asking for frames, which drains the fixture's delayed answers, so `ChangesHeader` is on screen; the old painter's flush settles a step earlier and the capture holds that screen. Measured: the old painter through this harness reports no differences against the golden, so the difference is between the two harnesses' settling rather than between the two painters' cells. | A re-capture, or a phase 4 that no longer has two flushes to disagree. |
| `agents-80x24` | 12, over six rows | The same settling one step further on, and here the evidence is stronger: the old painter through this harness draws exactly the cells ours does on all 24 rows, and both differ from the golden. So the capture is a screen neither painter produces through this harness. | A re-capture. Nothing in either painter is wrong. |
| `changes-120x40` | 15 | Two things. Every row that overflows its column loses a cell the old painter keeps — the `⧉` of a copy button, the `−` of a diff count — because the two Yoga builds round negative free space differently. And some of the border runs still hold `#00AAFF`, which phase 2's correction could not reach on rows whose characters do not line up. | An afternoon on `pointScaleFactor`, then the colour correction over what is left. |
| `agents-120x40` | 10 | The same rounding, on the header row, and it knocks on: the cell it loses is enough for the composer's hint to stop wrapping, which moves four rows up by one. | The same afternoon. |
| `notes-120x40` | 4 | The same rounding, on two overflowing rows, with no knock-on. | The same afternoon. |


**Recapturing under our own painter was considered and refused.** It would close two of the five in a
minute, and it would make those two files mean something different from their twenty-six siblings
without saying so anywhere a reader of the file would look: every golden in the set was captured from
the painter we are leaving, and that is the whole of what makes a match a statement. The honest
recapture for the two that differ by settling is under the *old* painter through this harness, which
is where they were measured, followed by phase 2's colour correction over the runs that come back
holding `#00AAFF`. Phase 4 deletes the set anyway, so that is one afternoon's work at the moment it
is worth least.

### Test results (2026-09-04)

`pnpm --filter @acorn/tui test` on Node 26.8.1 with the switch at its default: **559 passing, 2
failing, 31 skipped**, against 475, 2 and 28 before the slice. The 84 extra passes are this slice's
new cases — 78 in `apps/tui/src/kit/ptyKeys.test.ts` and six in `apps/tui/src/paint/paint.test.ts` —
and the three extra skips are `apps/tui/src/ownRenderer.test.ts`, which is about a renderer the
default build does not have. The two failures are `walks into a command group on return and back out
of it on escape` and `draws a search and an input in the same rectangle as the list`, both in
`apps/tui/src/chrome/chrome.test.tsx`, both another session's in-flight palette work and both failing
before this slice.

On Node 24.11.0 with `ACORN_TUI_PAINTER=own`, no FFI and no flag: **583 passing, 2 failing, 7
skipped**, against 488, 8 and 9 before it. Everything this phase owns is green.
`apps/tui/src/reachability.test.tsx` is 23 for 23 with `ACORN_TUI_WIDE` set, which is eight surfaces
at both sizes and all eleven invariants — the acceptance property, which was 11 for 23 before the
slice. `apps/tui/src/keys/keys.test.tsx` is 12 for 12, including all four `pty` cases.
`apps/tui/src/kit/kit.test.tsx` is 112 passing and 2 skipped, up from 110 and 4: the two mouse cases
run, and the two left are the Yoga-build pair that was never phase 3's.
`apps/tui/src/paint/paint.test.ts` is 29 for 29, `apps/tui/src/kit/ptyKeys.test.ts` 78 for 78,
`apps/tui/src/ownRenderer.test.ts` three for three, and `apps/tui/src/golden.test.ts` 23 passing with
five skipped.

The two that remain under `own`, each checked on its own:

- **`walks into a command group on return and back out of it on escape`**, which is one of the two
  failing under the default switch and is not this slice's.
- **`draws many frames without re-collecting, and re-collects when the keys move`**, which asks for at
  most eight collects after a Tab and saw nine in a full run. It passes on its own three times in a
  row, so it is the same load-dependent family as the timeout cascade this suite has always had:
  check alone before blaming a diff.

`pnpm --filter @acorn/tui lint` is clean under both switch values. `tools/arch` is 54 for 55 and the
one red is its pre-existing `docPaths` case over dotfile paths in three other docs; every boundary
rule passes, including the two new edges — `apps/tui/src/tree/renderer.ts` reaching the store, and the
store reaching `apps/tui/src/tree/compat.ts`.

`apps/tui/scripts/check-startup-graph.mjs` measures the eager closure at 978,482 B under `opentui` and
970,037 B under `own`, against 957,638 B and 954,069 B before the slice: 21 KB and 16 KB more. It is
this slice's own source, because the build does not minify —
`apps/tui/src/kit/rectangle.tsx` went from 235 lines to 399 in a file already in the graph,
`apps/tui/src/kit/ptyKeys.ts` is reached from it, and the store now reaches
`apps/tui/src/tree/compat.ts` and `apps/tui/src/tree/node.ts`, which is 12 KB of the OpenTUI build's
share and no Yoga, because `node.ts` imports `yoga-layout` as a type alone. The emulator itself is in
neither number: `@xterm/headless` is left external and is loaded on the first rectangle. Both numbers
are over the 870,000 B ceiling the check has been failing since before this programme.

### What phase 4 must know

- **`apps/tui/src/kit/pty.ts` never changed**, and its blob hash is still `8df7dcf7`. Both emulators
  answer the same four members, so the file that plumbs a rectangle to its channel has no idea which
  painter drew it, and phase 4 deletes one emulator without touching it.
- **The `own` half of `rectangle.tsx` is 34 lines of code and the OpenTUI half is seven**, and the
  shared half — the arming, the intercept, the Escape pair, the listener lists, the footer's answer —
  is neither. Deleting the OpenTUI half is deleting `handedNative`, the `extend` call, the
  `EmbeddedTerminalRenderable` import, `Inside.paste`'s sentence about it, and the ternary in the JSX.
- **`propagationStopped` is why the intercept works**, and if the harness ever stops constructing its
  events through `apps/tui/src/ownKeys.ts § ownKeyEvent` that flag has to come with it. There is no
  test that would catch its absence other than the rectangle's own four.
- **A hold is the seam for anything else that produces cells late** (`apps/tui/src/tree/frames.ts §
  holdFrame`). One thing takes one today. Anything that parses, fetches or decodes on a queue of its
  own belongs there rather than in a longer loop in the harness.
- **`removeNode` telling the store is what makes the reachability property pass**, and it is the half
  of architecture.md § 5 that had not been built. Phase 4's rewrite of the store against `Node`
  directly should keep both halves: the mark on the removed subtree's top, and the landing pass where
  the keys have left the tree.
- **The two hide-site `scheduleSettle` calls did not move into `setProperty('visible')`**, which
  § Code touched asks for. They still work where they are, and moving them would change the painter
  that ships for no gain while both exist. It is a one-line move once there is one painter.
- **The `$EDITOR` handoff in a real terminal has not been checked by hand**, which § Done when asks
  for. Everything it needs is built — the encoder sends what vim expects in both cursor modes, the
  rectangle's Escape pair reaches normal mode, and `apps/tui/src/kit/pty.ts` opens the channel at the
  right size — but a person has to run it in a terminal and write down which one.
