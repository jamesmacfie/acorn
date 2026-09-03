# Phase 3: widgets and the pty

Status: the scroll viewport is built, 2026-09-04, against `cf374cbd`. `Input`, `Textarea`, the `pty`
rectangle, the parser's wiring and the click hit test are not started. What building the viewport
found is at the bottom, and the last two sections there are the ones to read first. Waits on phase 0's
spike 4 for the textarea.

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
`apps/tui/src/painter.ts` and `apps/tui/src/tree/frames.ts`, are seventeen and thirty lines with no
imports of their own. Both numbers are over the 870,000 B ceiling the check has been failing since
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
