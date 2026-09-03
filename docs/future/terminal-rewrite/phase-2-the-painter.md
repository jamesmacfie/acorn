# Phase 2: the painter

Status: built, 2026-09-04, against `fc01ec22`. The node tree, the width measure, the layout pass,
the colour type, the paint pass, the input parser, the build switch and the golden comparison are all
in the tree. Under `ACORN_TUI_PAINTER=own` the new painter draws the whole app and 16 of the 28 phase
0 goldens match cell for cell and run for run on the Node the repo pins, with no FFI and no flag; the
other 12 are held for phase 3 and each is held by a widget's own content. Nothing changes for a
reader: the switch defaults to `opentui`. What building each part found is at the bottom, and the
last section is the one to read first. Independent of phase 1.

## Goal

A second painter exists beside OpenTUI's, selected at build time by `ACORN_TUI_PAINTER=own`, and
draws every golden frame from phase 0 that contains no scroll viewport, input, textarea, or pty
rectangle, cell for cell. It is four folders under `apps/tui/src`: the node tree Solid mutates, the
Yoga pass over it, the cell buffer with its diff and flush, and the input parser. None of the 75 kit
components, seven layouts, or chrome files change more than an import.

## Why this phase, and why as a switch

[review.md](./review.md) § 2a through § 2c are the rendering fault class, and every one of them is a
property of OpenTUI's `Renderable`: it has a lifecycle (destroyed a tick after detach), it has
behaviour (a `text` refuses a bare child, a `span` drops props), and it reads its size from Yoga
without clamping. The design in [architecture.md](./architecture.md) § 1 to § 3 replaces the
renderable with a plain object and moves every behaviour into a paint pass that reads the tree. A
plain object cannot be destroyed too early, cannot refuse a child, and has whatever size the layout
function wrote.

The switch is what makes this phase safe to build over weeks. Both painters compile from the same
component source because the components speak intrinsic JSX (`<box>`, `<text>`, `<span>`) with flex
props, and the only thing that decides which painter receives those calls is the alias for
`@opentui/solid` in `apps/tui/vite.config.ts`. Point the alias at our reconciler module and the whole
app draws through the new painter; point it back and nothing has changed. The goldens are the judge.
The test suite runs against both while the switch exists, which is the only way to know the new
painter is a painter and not a different kit.

## Scope

In:

- **The node tree** in `apps/tui/src/tree/` (new): the `Node` type, the nine universal-renderer
  operations, `render`, `Dynamic`, and the JSX namespace types for the intrinsics and their props.
  The module is the alias target for `@opentui/solid`, so it must export the same names the six
  importing files use: `Dynamic`, `render`, and `extend` (which becomes a no-op that registers
  nothing, because our kinds are fixed; `apps/tui/src/kit/rectangle.tsx` calls it once for the
  embedded terminal and phase 3 removes that call).
- **The layout pass** in `apps/tui/src/layout/` (new): Yoga node creation and freeing tied to
  `createElement` and `removeNode`, the prop-to-setter table, the text measure function, and the
  read-back that writes each node's rectangle and clamps it to finite non-negative integers.
- **The paint pass** in `apps/tui/src/paint/` (new): the `Cell` and `Buffer` types, the tree walk
  with clipping, box backgrounds and borders (which sides, in the glyphs `borderCell` in
  `packages/client-core/src/kit/tokens/roles.ts` returns for a border role; today every border is
  OpenTUI's `single` style and the role decides the sides), text runs with wrap and truncation, the
  previous-frame diff, the flush with synchronized output, and the frame scheduler.
- **The input parser** in `apps/tui/src/input/` (new): the terminal open and close sequences
  (alternate screen, raw mode, kitty keyboard with `disambiguate`, SGR mouse, DEC 1004 focus
  reporting), the byte parser producing our `KeyEvent`, `MouseEvent`, `FocusEvent`, `PasteEvent`,
  and a `SIGWINCH` resize. In this phase the parser exists and is tested against recorded byte
  sequences; it is wired into the dispatcher in phase 3 when the widgets that need it exist.
- **Colour and attributes**: `apps/tui/src/appearance.ts` and `apps/tui/src/kit/roles.ts` lose their
  `RGBA` and `TextAttributes` imports for a `Color` type of ours (an index 0 to 15, an RGB triple, or
  `default`) and a bitmask of ours. `spanStyle` merges into `textStyle` because a span takes the same
  props as a text.
- **Width**: `ellipsise` and `pad` in `apps/tui/src/kit/cells.tsx` measure with `Intl.Segmenter` and
  the East Asian Width table spike 3 chose. `☰` in `apps/tui/src/kit/glyphs.ts` becomes a one-cell
  character, because it measures two today and the file's own comment says it does not. The other
  five spike 3 named need nothing: they are already one cell to our own measure, and what was wide
  was OpenTUI's. No golden is recaptured for any of it, because none holds one of the six. The emoji
  ban in that file stays, and its `\p{Emoji_Presentation}` test
  becomes an assertion that the painter's measure returns 1 for every value in `GLYPHS`, which is the
  check that would have caught those six.
- **The switch**: `ACORN_TUI_PAINTER` read in `apps/tui/vite.config.ts` and `apps/tui/vitest.config.ts`
  to pick the alias target, defaulting to `opentui`. `main.tsx` picks `createCliRenderer` or our
  `openTerminal` from the same define.
- **The golden comparison** running in a test file that is skipped unless the switch is `own`, so
  the default suite is unaffected until phase 4.

Out: the scroll viewport, `Input`, `Textarea`, the pty rectangle, and mouse hit testing, all phase 3.
Deleting anything, phase 4. Any change to a component's props or output; a component that needs one
to draw the same cells under both painters has found a bug in the painter, not in the component.

## Design

### The node

```ts
type Node = {
  kind: 'box' | 'text' | 'span' | 'scrollbox' | 'input' | 'textarea' | 'pty' | '#text'
  props: Record<string, unknown>
  parent: Node | null
  children: Node[]
  yoga: YogaNode | null           // null for '#text' and 'span', which are measured by their text parent
  rect: { x: number; y: number; w: number; h: number }   // last layout, clamped
  text?: string                   // '#text' only
}
```

That is the whole type. Focus, visibility semantics, scroll offsets, and edit state are not on it:
focus is the store's, visibility is `props.visible` read by layout as `DISPLAY_NONE`, scroll offset
and edit state arrive in phase 3 as props the widget components own.

### The operations

`createElement(kind)` makes a node and, for kinds that lay out, a Yoga node. `createTextNode(text)`
makes a `#text`. `insertNode(parent, node, anchor)` links the node, inserts the Yoga child at the
matching index, and marks the frame dirty. `removeNode(parent, node)` unlinks, removes the Yoga child,
and marks dirty. It does not free the Yoga node, because Solid's `Suspense` may hand the node back;
the Yoga node is freed when the *owner* is disposed, which `createElement` learns by calling
`onCleanup` under the current owner, the same trick `apps/tui/src/kit/reconciler.ts` uses today for
`tieDestroyToOwner`. A node created outside an owner frees on remove. `setProperty(node, name, value)`
stores the prop, applies it to Yoga if the table has a setter for it, and marks dirty. `replaceText`
updates a `#text` and marks its nearest `text` ancestor's Yoga node dirty so it re-measures.
`getParentNode`, `getFirstChild`, `getNextSibling`, `isTextNode` read the fields.

A `#text` directly under a `box` is legal. Paint draws it as a one-line default-styled run at the
box's content origin. That is the orphan-text override made unnecessary rather than moved.

### Layout

One `calculateLayout(cols, rows, LTR)` on the root per dirty frame. The read-back walks the tree,
reads the four computed values, adds the parent's absolute origin, clamps, and writes `rect`. A
`text` node's measure function wraps or truncates its concatenated children (its own `#text` and
`span` children, in order) at the width Yoga offers, using `wrapMode` (`word` or `none`) exactly as
`apps/tui/src/kit/cells.tsx` § `Line` passes it, and returns lines by the width measure. Measurement
results are cached on the node keyed by the width and the text so a frame that moved nothing measures
nothing. The no-shrink rule ([tui.md](../../tui.md) § What the TUI never does) is honoured by the same
props it is honoured by today; nothing about it moves into the engine.

### Paint

`paint(root, buffer)` walks depth first. Each node's clip is the intersection of its rect with its
parent's clip. A `box` fills its background if it has one, draws its border in the style and colour
`apps/tui/src/kit/roles.ts` computed, and recurses into the content rect. A `text` draws the lines
its measure produced, each run with the fg, bg, and attribute bits of the `span` or `text` that owns
it. A `#text` under a box is one run. `visible === false` is skipped entirely, which is also what
Yoga does with `DISPLAY_NONE`, so the two agree without a rule.

The buffer is a flat array of cells. A wide glyph writes itself at its first cell and a continuation
marker at the second, so diff and flush treat the pair as one. Flush compares the two buffers row by
row, groups changed cells into runs, and writes for each run a cursor position (`CSI row;col H`) and
the styled text, with an SGR only where the style changes from the previous cell written. The whole
write is inside `CSI ? 2026 h` and `CSI ? 2026 l`. After flush the buffers swap and the new back
buffer is cleared. A resize clears both and forces a full frame.

Colour output: `default` is `39` or `49`; an index is `30 + i` or `90 + (i - 8)`; RGB is `38;2;r;g;b`.
Attributes are `1`, `2`, `4`, `7` set and their `22`, `24`, `27` resets. That is the whole SGR
vocabulary the kit needs.

### Scheduling

Every operation that changes the tree calls `requestFrame()`, which sets a flag and, if none is
pending, `setImmediate(frame)`. `frame()` runs layout if any Yoga node is dirty, paints, flushes,
clears the flag. This is at most one frame per event-loop turn, which coalesces a burst of signal
writes into one paint the way OpenTUI's `requestRender` does. There is no timer and no frame rate.

### Input

`openTerminal(stdin, stdout)` writes the enter sequences and returns `{ cols, rows, close, events }`.
The parser is a state machine over bytes: ground, ESC, CSI with parameters, SS3, OSC (for replies we
do not act on), and a lone-ESC timeout of the length OpenTUI's parser uses. It emits `KeyEvent`
(`name`, `text`, `ctrl`, `shift`, `alt`, `super`, `press | release | repeat`), `MouseEvent` (`x`, `y`,
`button`, `action`, modifiers), `FocusEvent` (`in | out`), `PasteEvent` (text), and `ResizeEvent`.
Kitty's `CSI u` form and its release events are decoded when the terminal answered the request; the
legacy forms are decoded always. The names match the spellings `apps/tui/src/keys/tiers.ts` and the
intent table already use (`up`, `down`, `return`, `escape`, `pageup`, `pagedown`, `home`, `end`,
`tab`, `f6`), so no binding is respelled.

### What each workaround becomes

| Today | After |
| --- | --- |
| `apps/tui/src/kit/reconciler.ts` `insert` override (orphan text) | Not needed; a `#text` under a box paints |
| `apps/tui/src/kit/reconciler.ts` `createElement` override (destroy race) | Not needed; nothing destroys on detach |
| `apps/tui/src/renderGuard.ts` prototype patches | The clamp in the layout read-back, one function |
| `apps/tui/src/renderGuard.ts` listener cap | Not needed; no `selection` event |
| `apps/tui/src/kit/roles.ts` `spanStyle` | Merged into `textStyle` |
| `apps/tui/src/appearance.ts` "always name a colour" | `default` emits `39`; the comment goes |
| `apps/tui/src/main.tsx` console overlay suppression | Not needed; no overlay |
| `apps/tui/src/kit/render.tsx` `RAW_KEYS` | Not needed; the harness pushes a `KeyEvent` |

## Code touched

- `apps/tui/src/tree/` (new), `apps/tui/src/layout/` (new), `apps/tui/src/paint/` (new),
  `apps/tui/src/input/` (new).
- `apps/tui/vite.config.ts`, `apps/tui/vitest.config.ts`: the switch and the alias target.
- `apps/tui/src/main.tsx`: pick the renderer by the define; the version check stays until phase 4.
- `apps/tui/src/appearance.ts`, `apps/tui/src/kit/roles.ts`, `apps/tui/src/kit/cells.tsx`: the colour
  type, the merged style, the width measure. These compile under both painters, so the colour type
  needs an adapter to `RGBA` while the switch exists; it is ten lines and phase 4 deletes it.
- `apps/tui/package.json`: `yoga-layout` added; nothing removed yet.

## Tests

- `apps/tui/src/tree/tree.test.ts` (new): the nine operations against a hand-built tree; `Suspense`
  removing and re-inserting the same node keeps its Yoga node; disposing the owner frees it.
- `apps/tui/src/layout/layout.test.ts` (new): the prop table covers every flex prop the kit uses
  (grep the kit for `flexDirection=` and friends, assert each has a setter); a node inserted after a
  pass reads a zero rect, because the read-back clamps the `NaN` width and height spike 2 measured
  coming out of Yoga; the measure cache hits on an unchanged text.
- `apps/tui/src/paint/paint.test.ts` (new): a box with each border style; a wrapped text; a wide
  glyph occupies two cells and one flush run; a diff of a one-cell change emits one cursor move and
  one run; a full clear after resize.
- `apps/tui/src/input/parser.test.ts` (new): recorded byte sequences for each key the tiers name in
  both kitty and legacy forms, SGR mouse press and wheel, focus in and out, a bracketed paste, a lone
  Escape after the timeout.
- `apps/tui/src/golden.test.ts` (new, skipped unless the switch is `own`): every phase 0 golden
  without a widget matches character for character and run for run. Failures print the comparison
  helper's `row:col` report.
- `apps/tui/src/kit/kit.test.tsx` and `apps/tui/src/layouts/layouts.test.tsx` run under both switch
  values in CI. Under `own`, the cases that draw a widget skip with the phase 3 marker.

## Docs owed

None until phase 4, because nothing a reader can run changes. The phase file records the spike
numbers that decided the Yoga entry and the width measure.

## Done when

- Under `ACORN_TUI_PAINTER=own`, every widget-free golden matches.
- The kit and layout suites pass under both switch values, with the widget cases skipped under `own`.
- The eager closure under `own` is measured with `apps/tui/scripts/check-startup-graph.mjs` and the
  number is written here beside the `opentui` number.
- No file under `apps/tui/src/tree`, `apps/tui/src/layout`, `apps/tui/src/paint`, or `apps/tui/src/input`
  imports from `@opentui/*`.

## Verify before building

- Spike 2 and spike 3 answers are written in [phase-0-baseline-and-spikes.md](./phase-0-baseline-and-spikes.md).
- Confirm `solid-js/universal` is still exported by the catalog's `solid-js` (it is at 1.9.13) and
  that `vite-plugin-solid` still takes `generate: 'universal'` and `moduleName`.
- Confirm the six files importing `Dynamic` from `@opentui/solid` still do, and whether any new file
  imports something else from it, so the module exports everything the alias must satisfy.
- Tally the props handed to `<box>` and `<text>` again (the review's tally at `9e5d90ca` is 21
  distinct props) so the layout table is complete on the day it is written.
- Read [ui-design.md](../../ui-design.md) § Every node at 80 by 24 and [panes.md](../../panes.md)
  § Layout model first; a golden mismatch is judged against those sentences, and where a golden
  disagrees with the sentence, the sentence wins and the golden is corrected with a note.

## What building it found (2026-09-03)

The first part is built: `apps/tui/src/tree/` (the `Node` type, the renderer operations, `render`,
`Dynamic`, `extend`, the JSX types), `apps/tui/src/width.ts` (the measure), and
`apps/tui/src/layout/` (Yoga's lifetime, the prop table, the text measure, the read-back). Three test
files beside them, 36 cases, all of which pass on Node 24.11.0 with no FFI and no flag, which is the
first time anything in this package's suite has drawn without one. `yoga-layout` is at 3.2.1 in
`apps/tui/package.json` and nothing was removed.

The shape held. The node is a plain object, the operations are about ninety lines of code, the clamp
is one function, and the six workarounds § What each workaround becomes lists against those three
folders are absences rather than replacements. Twelve things the file or
[architecture.md](./architecture.md) said turned out otherwise.

**The nine operations are ten.** `RendererOptions` in solid-js 1.9.13 wants `createElement`,
`createTextNode`, `replaceText`, `isTextNode`, `setProperty`, `insertNode`, `removeNode`,
`getParentNode`, `getFirstChild` and `getNextSibling`. Both [architecture.md](./architecture.md) § 1
and § The operations above say nine while listing all ten of them.

**Six importing files is seven, and only three of them want `Dynamic`.** `apps/tui/src/main.tsx`,
`apps/tui/src/harness.tsx` and `apps/tui/src/kit/render.tsx` import `render`;
`apps/tui/src/plugins/TreeHost.tsx`, `apps/tui/src/plugins/SourcePanel.tsx` and
`apps/tui/src/kit/host.tsx` import `Dynamic`; `apps/tui/src/kit/rectangle.tsx` imports `extend`. An
eighth file, `apps/tui/src/kit/reconciler.ts`, re-exports the whole package, so the slice that moves
the alias has that to delete as well as to point.

**A rectangle is four finite integers, of which two are non-negative.** The invariant in
[architecture.md](./architecture.md) § 2 says all four are non-negative, and a computed left cannot
be: an overflowing child under `alignItems: center` reports -15, and clamping that to 0 slides the
run sideways instead of letting paint clip it. So the read-back clamps the size half only and leaves
a position alone once it is finite. `apps/tui/src/layout/layout.test.ts` pins both halves.

**An unmeasured size clamps to zero, not to the one cell `renderGuard.ts` chose.** That 1 was for the
Zig side, which took a `u32` and threw on `NaN` from inside the render loop, so a one-cell box was
the cheapest thing that would not crash. Our paint has no such door, and a zero rectangle paints
nothing, which is the honest answer for a node Yoga has never measured. The clamp asks
`Number.isFinite` and never `=== 0`, because an empty auto-sized box and a `DISPLAY_NONE` subtree
both read zero legitimately.

**`removeNode` cannot be the move.** § The operations says `insertNode` links the node and
`removeNode` unlinks it, which is right, but Solid inserts a still-parented node when it moves one,
and routing that through `removeNode` frees the Yoga node of anything created outside an owner. The
unlink is now its own function and only `removeNode` decides whether to free.

**`extend` had to keep the tag as well as become a no-op.** § Scope says `extend` registers nothing
and that `apps/tui/src/kit/rectangle.tsx` calls it once. It does not say what happens to the tag it
registered: the transform still emits `<embedded_terminal>`, and an unmapped tag now throws. So
`apps/tui/src/tree/node.ts` maps that tag to the `pty` kind until phase 3 removes the call.

**The prop tally holds at 24 and 21, but `maxWidth` is set after all.** Re-scanned at `c0903659`:
159 `<box>` tags, of which 153 are outside the tests, and 6 `<text>`, carrying 24 distinct props once
`ref`, `title`, `titleAlignment` and the handlers are set aside. 21 map to a Yoga setter and the other
three are `borderStyle`, `borderColor` and `wrapMode`, exactly as spike 2 measured. The one
correction is `maxWidth`: spike 2 says nothing in `apps/tui` sets it, and
`apps/tui/src/kit/scrolling.tsx` sets `minWidth` and `maxWidth` to `'100%'` inside the scrollbox's
`contentOptions`. Percentages are therefore live in the table, and so is `maxWidth`.

**A per-edge border width outlives an `Edge.All` reset.** Setting `border` to `['left']` and then to
`false` left the box still charging a cell on its left, because `setBorder(Edge.All, 0)` does not
clear a width written to a named edge. The setter writes all four edges by name. `Rule` is the only
caller that passes an array today, and its box is the divider between two regions, so the cell it
kept would have been visible.

**Two things about Yoga's JavaScript API, for whoever writes the next test.** `getChild(index)`
returns a fresh wrapper around the same pointer on every call, so a node's Yoga child cannot be
recognised by identity and the tree test tags each box with a distinct `flexGrow` instead. And
`getBorder(edge)` answers `NaN` for an edge whose width arrived through `Edge.All`, so a border
assertion has to read `getComputedBorder` after a pass.

**A `text` node's rectangle is not its run's width.** A column container stretches its children
across, so a seven-cell run inside a nine-cell box has `rect.w` of 9 and a measured width of 7. Paint
needs both: the box to clip to, the run to place. They come from the rectangle and from the measure
cache respectively, which is why `measuredRun` is exported.

**Only one of the six wide glyphs is wide to our measure.** § Scope says `☰`, `🗀`, `🗎`, `🗒`, `🗃`
and `🖵` become one-cell characters. Five of them already are, to `Intl.Segmenter` and the East Asian
Width table, without a line changing in `apps/tui/src/kit/glyphs.ts`: what was wide was OpenTUI's
measure, not the characters. So the work in that file is `☰` alone, which Unicode 16 moved to `W`.
No golden needs recapturing for any of it. Phase 0 grepped all 28 for the six characters and none
holds one: the trust prompt interpolates the Lucide *name* as words and the fixture's bundle asks for
no permissions anyway, and the pane strip lost its marks when the rail lost its icons. Re-checked
against the committed set while reviewing this slice, and still none.
`apps/tui/src/width.test.ts` holds spike 3's whole column, and its
`GLYPHS` case asserts that `list` is the only name left over, so it turns green on the day the
character changes. Spike 3's numbers reproduced exactly on Node 24.11.0, including the Devanagari
cluster count of 3 and the flag at 1.

**`apps/tui/src/keys/tiers.test.ts` greps every non-test file in the package.** It looks for a bare
number after a closing bracket, which is how a keymap priority spelled outside the tier table looks,
and a `reduce` with a `0` seed reads as one. So does a comment quoting the shape. Worth knowing before
the paint pass, which will want a seeded reduce more than once.

### The paint pass (2026-09-03)

The second part is built: `apps/tui/src/colour.ts` (the `Color` type) and `apps/tui/src/paint/`
(the cells, the tree walk, the diff, the flush and the frame scheduler), with
`apps/tui/src/paint/paint.test.ts` beside them, 19 cases, all of which pass on Node 24.11.0 with no
FFI and no flag. Nothing in the running app changed: the alias still points at OpenTUI's reconciler
and nothing yet calls `openScreen`. Two edits outside the folder, both of them one line of substance:
`apps/tui/src/tree/jsx.ts` narrows its `Color` placeholder to the real type, and
`apps/tui/src/layout/props.ts` gains `backgroundColor` in `NOT_YOGA`.

The shape held again. The walk is one function per kind, the diff is one loop, and the SGR vocabulary
is the three colour forms and the four attributes [architecture.md](./architecture.md) § 3 names, with
no terminfo layer behind them. Twelve more things the file or that one said turned out otherwise.

**`borderCell` is in `apps/tui/src/kit/roles.ts`, not in client-core.** § Scope sends the reader to
`packages/client-core/src/kit/tokens/roles.ts` for it. What is there is the `border` role table, and
the table is smaller than the sentence implies: of its five values only `surface` is a box at all,
`control` is an underline attribute rather than a border, `divider` and `stripe` are single
characters, and `none` is nothing. `borderCell` is the terminal-side reader of that table, and
`boxBorder` beside it answers `borderStyle: 'single'` for every box in the app, unconditionally.

**So there is one border style, and the sides are the whole of the variation.** The test § Tests asks
for, "a box with each border style", is a box with each set of sides: four edges with corners, one
top edge, one left edge, and none. Paint holds one glyph set rather than a table keyed by style,
because a table with one row is flexibility nobody asked for; a second set is a second const and a
lookup on `borderStyle` on the day a style pack wants one.

**A corner belongs to two edges, not to a side.** A corner is drawn only where both edges that meet
it are drawn, which is what keeps a `Rule` a line: `border={['top']}` draws `──────` and not
`┌─────┐`. Neither file says this, and getting it wrong would have put a corner glyph on every
divider in the app.

**Bold and dim share the SGR reset `22`.** § Paint lists "`1`, `2`, `4`, `7` set and their `22`,
`24`, `27` resets", which reads as four symmetrical pairs. It is three: clearing bold clears dim and
clearing dim clears bold, so whichever of the two is still wanted has to be said again after the
reset. It is the only asymmetry in the vocabulary and `paint.test.ts` pins it.

**`39` and `49` are written less often than the design implies.** Each flush ends with `0m`, so the
next one begins from a known state, and a run in the terminal's own colour then needs no sequence at
all. The two codes are for a cell that follows a coloured one inside the same flush. The reset is at
the end rather than the beginning for exactly that reason, and it is also what stops a crash trace
after the frame coming out bold red.

**A run must not carry a background.** § 3 says a cell is a grapheme, a foreground, a background and
a mask, and that a text draws its runs — which reads as every run writing all four. If it does, a
word drawn over a box's background punches a hole in it. So a write's `bg` is optional and absent
means "keep the background that is already there", which makes `default` a colour rather than an
absence in the one place the difference is visible.

**Nothing in the kit passes a `backgroundColor`.** Paint fills one where it is given and the prop is
now in `NOT_YOGA`, but no box in `apps/tui` or client-core sets one: a terminal has no surface to
paint and a role that wants emphasis says `inverse`. So the "box backgrounds" half of § Scope has no
caller, and phase 3's selected row is the first thing that would.

**A `span`'s colour still arrives in one object rather than as props.** § Scope has `spanStyle`
merging into `textStyle` in this phase, and that has not happened yet, so `../kit/roles.ts` still
answers `{ fg, bold, dim, underline, inverse }` for a span. Paint reads both shapes. Reading only
`fg` and `attributes` would have been the tidier module and would have reproduced the exact fault
this phase exists to end, which is a span drawing in its parent's colour.

**Wrapping consumes the space it broke at, so paint has to find each line again.** The measure hands
back lines and paint needs a style per stretch of each line, and the offset that joins the two is
not carried anywhere: the space or the newline the wrap ate is in the run and on neither line. Each
line is a contiguous slice of the run, so its offset is found by looking for it from where the last
line ended. Reconstructing it is what keeps `measuredRun` the only answer about where the breaks
are; a second opinion here would be a colour out on every wrapped paragraph with a styled word in it.

**Clipping is unconditional, which is a deliberate departure.** A child is clipped to its parent's
content box whatever `overflow` says, where CSS and OpenTUI clip only when it says `hidden` or
`scroll`. There is no `position` setter in the prop table at all, so the only way for a child to be
outside its parent is to overflow it, and a run drawn over a sibling is never what we want. The
early-out on an empty clip is also what makes an off-screen subtree free rather than merely
invisible.

**"Layout if any node is dirty" is every frame.** § Scheduling has the frame testing a dirty flag
before laying out. There is nothing to test: a frame only exists because an operation on the tree
asked for one, and every one of those operations is a change Yoga has to be told about. Yoga keeps
the finer flag itself and re-measures only the nodes it marked, so the check would be ours to
maintain and Yoga's to make anyway.

**A resize needs an explicit erase.** "A resize clears both and forces a full frame" is not enough on
its own: with the previous frame blanked, the diff emits the cells the new frame draws and says
nothing about the ones it does not, so the old frame's corner stays on screen. The flush writes
`CSI 2 J` on the frame after a resize, and on the first frame of all, where what is on the alternate
screen is not ours either.

One thing that is not a correction but is worth writing down. The `Color` type went to
`apps/tui/src/colour.ts`, beside `apps/tui/src/width.ts` rather than inside `apps/tui/src/paint/`,
because `apps/tui/src/tree/jsx.ts` types the props that carry one and `apps/tui/src/appearance.ts`
will produce them, and neither of those should import from paint. And the attribute bits are
OpenTUI's values on purpose — bold 1, dim 2, underline 8, inverse 32, with its italic and blink left
as gaps — so the mask needs no translating while both painters run and no golden changes when the kit
stops importing `TextAttributes`.

### The input parser (2026-09-03)

The third part is built: `apps/tui/src/input/` — `events.ts` (the five event types), `names.ts`
(every key name this client can produce), `parser.ts` (the state machine and the decoders) and
`terminal.ts` (the open and close sequences, raw mode, the stdin read and `SIGWINCH`) — with
`apps/tui/src/input/parser.test.ts` beside them, 69 cases, all of which pass on Node 24.11.0 with no
FFI and no flag. Nothing in the running app changed: `main.tsx` still builds OpenTUI's renderer and
nothing yet calls `openTerminal`. No file outside the folder was touched.

The shape held a third time. It is a state machine and two tables, there is no terminfo layer and no
capability detection beyond reading the reply to the one question we ask, and `RAW_KEYS` in
`apps/tui/src/kit/render.tsx` is an absence rather than a replacement — a harness that constructs a
`KeyEvent` has no spelling to get wrong. Twelve more things the file or
[architecture.md](./architecture.md) said turned out otherwise.

**The lone-ESC timeout is 20 ms, and OpenTUI writes it down twice.** `DEFAULT_TIMEOUT_MS` in its
`lib/stdin-parser.ts` is 20, and its renderer passes `timeoutMs: 20` to the parser explicitly at
0.5.9 rather than taking the default. `ESC_TIMEOUT_MS` in `apps/tui/src/input/parser.ts` is that
number and `parser.test.ts` asserts it, because a shorter wait turns a slow Down arrow into an Escape
and a longer one makes leaving a modal feel stuck.

**`useKittyKeyboard: { disambiguate: true }` never asked for event types, so a release has never been
possible.** OpenTUI's `buildKittyKeyboardFlags` sets 1 for `disambiguate` and 4 for `alternateKeys`
unless either is explicitly false, and sets 2 only for `events: true`, which `apps/tui/src/main.tsx`
does not pass. Today's flags are therefore 5, and no terminal has ever sent this app a key release.
So "matching what `main.tsx` does today so no capability is lost" and "its release events decoded"
cannot both hold by copying the request: ours asks for 7, which is 1, 2 and 4. 8, report all keys as
escape codes, is still refused — it would route every letter through `CSI u` for the benefit of
knowing somebody let go of `j`.

**A gate on the kitty decode cannot fail safe, so there is none.** § Design and § 4 both say the
`CSI u` form is decoded "when the terminal answered the request". A terminal that speaks the protocol
and leaves the query unanswered would then have every key it sends that way dropped, and those keys
include Escape and Ctrl+Return, which is the whole reason we asked. Nothing else in any terminal's
vocabulary ends a CSI sequence with `u`, so the sequence arriving *is* the answer.
`kittyAnswered()` became a fact the parser reports — set by the reply to `CSI ? u` or by the first
such key — rather than a switch it obeys.

**A bracketed paste is a sixth state, and the five the file names are not enough.** Ground, ESC, CSI,
SS3 and OSC parse a vocabulary; the bytes between `CSI 200 ~` and `CSI 201 ~` are somebody's file and
may contain anything, an ESC included. Running the machine over them turns a pasted shell transcript
into arrow presses. So the paste state reads raw bytes and looks only for its closing bracket, which
is also the only place the parser cares where a sequence *started*.

**A state machine over a stream has to be resumable, not restartable.** A terminal is free to deliver
`ESC [ 6 ~` in four writes. The first cut kept the unread bytes and restarted the scan at index 0,
which read the retained ESC a second time and emitted a spurious Escape before the Up that followed —
the exact fault the timeout exists to prevent, reintroduced by the buffering. The read cursor and the
start of the sequence in progress are parser state, not locals of the scan, and two cases pin it.

**`R` cannot be a cursor key and `M` cannot be one either.** `CSI 1;2 R` is Shift+F3 in one reading
and a cursor position report in another, and the ambiguity is thirty years old; OpenTUI's own
`keyName` table leaves `[R` out for that reason and we do the same, since we never ask for a
position. `CSI M` is the X10 mouse encoding. So the letter table is A to F, H, P, Q, S and Z, and
`SS3 M` — the keypad's Enter, which is `return` — is a second one-row table rather than a row in the
first.

**Three control characters live inside the Ctrl+letter range, and the order of the two tests is a
keyboard.** Backspace is 8, Tab is 9 and Return is 13, which are also Ctrl+H, Ctrl+I and Ctrl+M.
Nothing in the app binds those three chords and every reader presses those three keys, so the named
table is asked first and the range second. The other order costs three keys silently.

**A key name is lower case with the case carried by `shift`, and `intentKeys` is why.** `last` is
bound to `shift+g`, so a parser reporting `G` would produce a chord string of `G` and the binding
would never fire. The same table binds `?` as itself and not as `shift+/`, so a printable character
is reported as the character it is and only a letter's case moves into the modifier.

**`meta` in a binding string is Option, and the parser must not spell it.** `intentKeys` spells
`nextPane` as `ctrl+meta+right`, because `packages/client-core/src/kit/keys/keymap.ts` maps acorn's
`alt` onto the keymap's `meta` — the one word the two vocabularies disagree about. Our event carries
`alt`, and that translation belongs in the phase 3 keymap host, which is where the desktop's
equivalent already lives. Written down so nobody adds a `meta` field to the event to make a table
match.

**`openTerminal` cannot return `cols` and `rows` as fields.** § 4 has it handing back
`{ cols, rows, close, events }`. A number read at boot is wrong the moment somebody drags the window,
and `SIGWINCH` is the only notice there is, so the size is a function and the new pair rides on the
resize event. `events` became `on(listener)` returning its own unsubscribe, which is the shape every
other subscription in this client has.

**"SGR mouse" is three requests, not one.** 1006 is the coordinate encoding and says nothing about
what is reported: 1000 asks for press and release, and 1002 adds motion while a button is held, which
is what a splitter drag needs. 1003, any motion, is refused — nothing here wants hover and it is a
report per cell the pointer crosses. The mode also has to be popped in the reverse order on the way
out, or a reader's shell prints `<35;80;24M` when they move the mouse.

**The enter sequence has two requests the file does not list.** § Scope names the alternate screen,
raw mode, kitty, SGR mouse and DEC 1004, and then asks for a `PasteEvent`, which needs
`CSI ? 2004 h`. Hiding the cursor is the other: with the cursor left visible it parks wherever the
last run of the frame ended, and there is nothing for it to sit on until phase 3 draws a field.

One thing that is not a correction. The parser owns its own timer and unrefs it, so a half-read
sequence is never the reason this process stays alive; and `openTerminal` takes a stdin and a stdout
of its own minimal shape, so the whole of `terminal.ts` is tested with an `EventEmitter` and an array
— including that every mode is asked for and every mode is popped, which is the sort of thing that is
otherwise only ever verified by a reader's shell going strange.

### Test results (2026-09-03)

`pnpm --filter @acorn/tui test` on Node 26.8.1: 447 passing, 2 failing. The two are
`walks into a command group on return and back out of it on escape` and `draws a search and an input
in the same rectangle as the list`, both in `apps/tui/src/chrome/chrome.test.tsx`, both another
session's in-flight palette work, and both failing on their own commits. The baseline for the tree
and layout slice was 323 passing and those same 2, and for the paint slice 378; the 124 new cases are
`apps/tui/src/width.test.ts` (9), `apps/tui/src/tree/tree.test.ts` (14),
`apps/tui/src/layout/layout.test.ts` (13), `apps/tui/src/paint/paint.test.ts` (19) and
`apps/tui/src/input/parser.test.ts` (69). On the repo's own Node 24.11.0 all 124 pass with no flag,
which is the whole of the new work drawing and reading on the Node the repo pins.
`pnpm --filter @acorn/tui lint` is clean.

### What the next slice must know

- Nothing calls `openTerminal` yet. The two halves compose rather than nest: `openTerminal` owns the
  modes and the reading, `openScreen` owns the cells, and the wiring is four lines written out at the
  top of `apps/tui/src/input/terminal.ts`. Close the screen before the terminal, so the last frame is
  written while the alternate screen is still ours.
- The events do not reach the dispatcher until phase 3, and the adapter that turns a `KeyEvent` into
  the string the engine matches on is that phase's: `alt` becomes `meta`, and nothing else moves.
- `apps/tui/src/input/parser.test.ts` § `no key is respelled` reads `intentKeys`, `BARE_KEYS` and the
  `HOST_KEYS` block of `apps/tui/src/keys/install.ts` and insists every key they name is produced,
  under that name, from a recorded sequence in both forms. A key added to any of those three tables
  fails the test until somebody records its bytes, which is the point.

### The switch, the colour, the width and the goldens (2026-09-04)

The last part is built and the new painter draws the real app: `ACORN_TUI_PAINTER` in
`apps/tui/vite.config.ts` picks the alias target for `@opentui/solid`, `apps/tui/src/painter.ts`
carries the same answer as a define, `apps/tui/src/appearance.ts` and `apps/tui/src/kit/roles.ts`
deal in our `Color` and our attribute bits, `apps/tui/src/kit/cells.tsx` measures with
`apps/tui/src/width.ts`, and `apps/tui/src/golden.test.ts` compares the frames. Four shim files came
with it, each with phase 4 written on it: `apps/tui/src/colourCompat.ts` (ten lines of `Color` to
`RGBA`), `apps/tui/src/tree/compat.ts` (the `Renderable`-shaped view of a node the region store
walks), `apps/tui/src/ownKeys.ts` and `apps/tui/src/ownRenderer.ts` (a `CliRenderer`-shaped handle on
a screen, so the keyboard can be installed on it).

**Sixteen of the 28 goldens match cell for cell and run for run, on Node 24.11.0, with no FFI and no
flag.** Those are `context`, `editor`, `help`, `inbox`, `workspace`, `project`, `quit` and `trust`, at
both 80 by 24 and 120 by 40, and the focus path of all 28 matched first time. It is the first time
this package has drawn the whole app on the Node the repo pins. The other 12 are held for phase 3 and
every one of them is held by a widget's own content.

The shape held a fourth time. No component changed its props or its output to make a frame match:
every edit outside the painter is one § Scope asked for — the merged `textStyle`, the width measure,
the one glyph — except `onSizeChange`, and that was a prop the components already passed and the
layout pass was not calling. Seventeen more things the file or
[architecture.md](./architecture.md) said turned out otherwise.

**Not one golden in the set is widget-free, so the rule that was meant to choose them chooses
nothing.** § Goal and § Scope both scope this file to "every golden frame from phase 0 that contains
no scroll viewport, input, textarea, or pty rectangle". Walking the retained tree of all 28 under the
old painter says every one of them holds a `ScrollBoxRenderable` and 24 of them hold an
`InputRenderable`: every panel that scrolls is a `scrollbox`, and every overlay is drawn over a shell
whose browse pane carries a filter field. The finer question is the one that had an answer — which
surfaces our painter draws cell for cell anyway — and it turns out a `scrollbox` whose content fits is
a box, which our paint pass already draws, and a `ScrollViewport` in a panel that is not overflowing
is exactly that. So the list in `apps/tui/src/golden.test.ts § PHASE_3` is by measurement, and what
is on it is a rectangle with content of its own rather than a rectangle.

**`onSizeChange` is load-bearing, and the layout pass was not calling it.** Eight components in this
package choose a form from the width they were given, and every one of them reads it from that prop:
`apps/tui/src/chrome/Rail.tsx § railCells` takes a third of the shell,
`apps/tui/src/chrome/Footer.tsx` cuts its hints to the row it has, `list-detail` stacks below 80
cells. Each reads the zero its `ref` saw before the first layout and waits to be told otherwise.
Without the call the rail drew at its 20-cell floor instead of 24 and the footer cut every hint to
nothing, which is 46 differences from two missing calls. `apps/tui/src/layout/pass.ts` now collects
the nodes whose size changed and calls them after the whole read-back, because a handler writes a
signal and a signal written mid-walk is a tree changing while it is being measured.

**The two captures do not group runs the same way, and neither is wrong.** OpenTUI's `captureSpans`
emits one run per text renderable, so a row of six tab labels in one colour comes back as eleven runs
with nothing between them; ours reads the cells and merges. `compare` in `apps/tui/src/golden.ts`
now joins adjacent runs of equal style on both sides before comparing, which is what makes "run for
run" a question about the screen rather than about the renderer — a reader cannot tell the two
groupings apart, and a joined run keeps the columns its parts had. It was 22 differences per surface
on frames whose characters were identical.

**Every golden holds a colour no role in this app ever chose, and the goldens are corrected.** 352
runs across all 28 files are `#00AAFF`, which is the default `focusedBorderColor` of OpenTUI's
`BoxRenderable`. `apps/tui/src/keys/regions.ts § paintCaret` calls `node.focus()` on whatever the
store focused, and a focused box then draws its own colour instead of the `borderColor` the role
handed it. [ui-design.md](../../ui-design.md) § Roles, and what each host makes of them is what
decides it: a `tone` on a terminal is "default, and the palette's grey, accent, green, yellow and
red", and "a theme stays 40-odd colours, and on a terminal it is 16 of them plus bold". `#00AAFF` is
none of the sixteen and comes from no theme. So the sentence wins and the goldens are corrected to
the colour `apps/tui/src/kit/roles.ts § boxBorder` returned, which is two answers and both come
straight from the source: the accent slot where a panel is lit, because `apps/tui/src/panel.tsx`
asks for `tone: 'accent'` when focus is within it, and the terminal's own foreground on an overlay,
because `apps/tui/src/kit/grouping.tsx`'s `Modal` asks `boxBorder('surface')` and names no tone. 188
runs in 16 files were corrected — 48 to the accent slot and 140 to the default foreground — and the
164 in the twelve files phase 3 owes were left alone, because a column cannot be corrected against a
frame whose characters do not line up yet. The one hazard this leaves is that
`apps/tui/src/captureGolden.tsx` would put the hex straight back, so it says so at the top.

One limit of the instrument comes out of the same correction, and it is worth saying because it is
easy to read the goldens as proving more than they do. A run frame holds a colour as three channels,
because OpenTUI had no way to say "the terminal's own", so the 140 corrected runs are stored as
`1, 1, 1`. That is the same three numbers an explicitly white border would store. So a golden cannot
tell `default` from white, which is precisely the distinction `apps/tui/src/colour.ts` exists to
make: these files check the geometry and the sixteen slots, and the white-on-white class is checked
by `apps/tui/src/paint/flush.ts`'s own cases instead. Nothing to fix, since phase 4 deletes the
goldens and the intent tests become the specification again, but not a gap to discover twice.

**A `render` under our painter hands the disposer back, and nothing was calling it.**
`@opentui/solid` disposes the Solid root from inside `renderer.destroy()`; ours returns the dispose
and leaves the lifetime to the caller, which is the right shape and a trap for a harness written
against the other one. The symptom is worth writing down because it names nothing useful: every case
after the first fails with "Cannot use a keymap after its host was destroyed", thrown from the
previous test's footer effect re-running against a torn-down engine. Both harnesses now dispose the
root and then the surface.

**`hasFfi` was the wrong question in 22 test files.** The gate every drawing suite spells is
`describe.skipIf(!hasFfi)`, and under `own` there is no FFI to have, so the whole suite would skip on
any Node — including the ones this phase exists to make pass. `canDraw` in `apps/tui/src/ffi.ts` is
the question they meant, and it is `drawsOwn() || hasFfi`.

**`spanStyle` cannot merge into `textStyle` by dropping a shape.** § Scope has the two becoming one
because "a span takes the same props as a text", and under our painter it does. Under the old one it
does not and cannot: `@opentui/solid` ignores every prop on a text node but `href` and `style`, so a
span given `fg` and a mask draws in its parent's colour, which is the exact fault this phase exists
to end. So what merged is the decision, not the shape: `textStyle` answers with the mask and with
the four bits as booleans, and `Run` in `apps/tui/src/kit/cells.tsx` spreads it and passes it as
`style` as well. Phase 4 drops the second half.

**The ten-line colour adapter has to lie about its return type, and the reason is tsc.**
`apps/tui/tsconfig.json` resolves `@opentui/solid` through `node_modules` whichever painter the build
picked, so tsc checks every JSX prop against OpenTUI's shapes always and the `own` path is not
type-checked at all while the switch exists. `paintColor` therefore declares `RGBA` and, under `own`,
hands back the `Color` it was given. One cast in one file, and it is what lets one component source
compile for both.

**The region store runs over our tree unchanged, given ten accessors.** `x`, `y`, `width`, `height`,
`visible`, `isDestroyed`, `focusable`, `getChildren`, and a `focus` and `blur` that do nothing; the
`parent` the walks follow is a field the tree already had. They are on a prototype per kind rather
than on each node, and each prototype's constructor is *named* after the OpenTUI class it stands in
for — which is not decoration: `apps/tui/src/golden.ts § focusPath` records a focused node's path as
`constructor.name` per step, and every one of the 28 focus paths compared first time without a golden
being touched.

**`instanceof` is the one question a shim cannot answer.** Two tests in the store ask
`node instanceof ScrollBoxRenderable`, and no plain object can satisfy one. `isViewport` in
`apps/tui/src/keys/regions.ts` asks the class or the kind, and phase 4 leaves the second half. The
`InputRenderable` and `TextareaRenderable` tests in `apps/tui/src/keys/install.ts` are deliberately
left alone: they gate typing, and typing is phase 3.

**Importing one key event from the painter's module put 59 KB into the wrong bundle.** The keymap
host adapter needs `ownKeyEvent`, and it is in `App`'s eager graph; `ownRenderer.ts` reaches the whole
painter. `apps/tui/scripts/check-startup-graph.mjs` caught it, and the fix is that the event lives in
`apps/tui/src/ownKeys.ts` and `apps/tui/src/main.tsx` reaches the painter through one `import()`.

**`currentFocusedRenderable` may not be spelled anywhere, not even in a shim's type.**
`apps/tui/src/invariants.test.ts § the store is the only owner of focus` counts the places that could
be a second owner, and a member on the fake renderer that was there to answer `null` failed it. It
was right to: the shim has no way to ask where the keys are, and the invariant is what says so.

**A frame produces the next frame, so a harness cannot flush a fixed number of turns.** The layout
read-back calls `onSizeChange`, the component that reads it swaps its subtree, and the new subtree has
no rectangles until the frame after that. Two turns of the event loop drew a `list-detail` in its
narrow form on a 100-cell screen. Both harnesses now turn the loop while `frameRequested()` says
something has asked for another frame, and draw one at the end for a change that asked for none — a
test that calls `resize` moves every rectangle without touching the tree.

**A scroll viewport has to be focusable, and OpenTUI's renderable declared that for itself.** Ours is
a plain object, so a narrow `list-detail` — one half at a time, and neither half holding a control —
had nothing to put the keys on, the pane layer that switches the halves was never active, and `l` did
nothing. It is the store's own rule (§ stopsIn: "a scroll viewport, transparent while it holds a stop,
and the stop itself otherwise") and the store was right; what was missing was the default the
renderable used to arrive with. It went on the node in `apps/tui/src/tree/compat.ts` rather than into
`reachable`, because a store-side answer left `node.focusable` reading `undefined` and a kit case that
asserts on the flag failed instead. `apps/tui/src/invariants.test.ts` counts the places that write the
flag and now names six.

**Yoga starts a node at `flexShrink: 0` and every renderable in the old painter started at 1.** Which
is why 153 of the kit's boxes say `flexShrink={0}` out loud — that line is only worth writing where
the default is the other one. The consequence is one case: a row one cell wider than its box keeps
every child at full width here rather than squeezing one, so a `TableRow`'s caret marker is clipped
instead of drawn inside the panel. Setting the default to 1 draws it and sends `ConfirmButton` into a
layout that never settles — a 30-second case that ran for 134 — so it is reverted and written down,
and it is a defaulting question rather than a widget one.

**The kit suite needed eighteen skips and the layouts suite needed none.** 111 kit cases: 93 pass
under both painters, 17 wait on phase 3 (11 on a field's own content, 3 on the viewport's three-node
structure, 2 on mouse hit testing, 1 on typing), and the eighteenth is the `flexShrink` default above.
The table is in `apps/tui/src/kit/kit.test.tsx § PHASE_3`, keyed by the title each case is reported
under, and a case beside it checks that every key names a title that exists — a skip on a renamed case
is a case that runs and fails. The layouts suite passing 20 for 20 under both was not expected: the
eight layouts are flex boxes and a `Panel`, and there is nothing in them that was OpenTUI's.

**The startup numbers, and the one this folder has been quoting is stale.**
`apps/tui/scripts/check-startup-graph.mjs` measures the eager closure at 921,137 B under `own` and
928,320 B under `opentui`, against 919,516 B at `fc01ec22` with nothing of this slice in it. So the
slice costs 1,621 B on the build that uses it and 8,804 B on the build that does not, and ours is
the smaller of the two while both painters are still in the tree — the new painter's own chunk is
30,519 B against OpenTUI's reconciler at 31,573 B. All three numbers are over the 870,000 B ceiling,
which the check has been failing since before this programme started, and the figure this folder
quotes for that — 875,265 B — is from `9e5d90ca` and does not survive contact: the graph was already
919,516 B before this slice, so the earlier slices moved it and nobody re-measured. Phase 4 re-sets
the ceiling against a graph with one painter in it.

### Test results (2026-09-04)

`pnpm --filter @acorn/tui test` on Node 26.8.1 with the switch at its default: 449 passing, 2 failing,
28 skipped, and the 28 are `apps/tui/src/golden.test.ts`, which only runs under the other switch.
The two failures are `walks into a command group on return and back out of it on escape` and
`draws a search and an input in the same rectangle as the list`, both in
`apps/tui/src/chrome/chrome.test.tsx`, both another session's in-flight palette work, and both failing
on their own commits. The baseline for this slice was 447 passing and those same 2; the two new cases
are `apps/tui/src/invariants.test.ts § the new painter is ours` and
`apps/tui/src/kit/kit.test.tsx § holds back nothing it cannot name`.

On Node 24.11.0 with `ACORN_TUI_PAINTER=own`, no FFI and no flag:
`apps/tui/src/golden.test.ts` is 16 passing and 12 skipped, `apps/tui/src/kit/kit.test.tsx` is 93
passing and 18 skipped, and `apps/tui/src/layouts/layouts.test.tsx` is 20 for 20 with nothing skipped.
Under the default switch the same three files are 28 skipped, 111 passing and 20 passing.

One false alarm worth writing down, because the last slice predicted it and it still landed.
`apps/tui/src/keys/tiers.test.ts` looks for a keymap priority spelled outside the tier table by
finding a bare number after a closing bracket, and `.reduce((mask, attr) => …, 0)` in
`apps/tui/src/kit/roles.ts` reads as one. It is a loop now, with a line saying why.

`pnpm --filter @acorn/tui lint` is clean.

### What phase 3 must know

- **The twelve goldens it owes, and what each is waiting for**, are in
  `apps/tui/src/golden.test.ts § PHASE_3`, one sentence per surface. Take the marker off a surface and
  its two cases run; there is nothing else to switch on. Two of the six surfaces are one row from
  matching — `notes` at 80 by 24 differs by the seven characters of a placeholder and `browse` by the
  one row an `Input` is a cell tall to OpenTUI and nothing to us — and the other four throw inside a
  component reaching for a widget's own API. The four throws are worth reading as a to-do list:
  `area.setText is not a function` from `apps/tui/src/kit/asking.tsx § Textarea`, and
  `Cannot read properties of undefined (reading 'height')` from `viewport.viewport.height` in
  `apps/tui/src/kit/showing.tsx` and `box.viewport.height` in `apps/tui/src/kit/scrolling.tsx`. A
  widget under this painter needs its methods and its `viewport` as much as its cells.
- **The 164 remaining `#00AAFF` runs are phase 3's to correct**, in those twelve files, by the rule
  § Every golden holds a colour no role chose sets out. They could not be corrected here because the
  correction reads the colour off the live frame at the same column, and a column cannot be lined up
  against a frame whose characters do not match yet.
- **The keyboard already reaches the new painter and the parser is still not wired to it.**
  `apps/tui/src/ownRenderer.ts` gives the dispatcher a `keyInput` emitter and both harnesses push a
  `KeyEvent` onto it, which is what makes an overlay open in a golden. What phase 3 adds is the
  parser's events arriving there instead, and the one translation that needs: our `alt` is the keymap's
  `meta`, and nothing else moves.
- **Mouse hit testing has a shape waiting for it.** `apps/tui/src/keys/regions.ts § focusClicked` is
  installed on the root node's `onMouseDown` under both painters and nothing calls it under ours,
  because a hit test needs a rectangle-to-node walk that does not exist yet. Every node's rectangle is
  on the node, so that walk is a depth-first search over `rect` and nothing more.
- **`instanceof` is the tell.** The two tests in `apps/tui/src/keys/install.ts § isTypingTarget` are
  `instanceof InputRenderable` and `instanceof TextareaRenderable`, and they are false under this
  painter — which is why nothing types. `apps/tui/src/keys/regions.ts § isViewport` is the pattern to
  follow: ask the kind as well, and let phase 4 delete the class half.
- **The kit suite's held cases are a to-do list with a table.**
  `apps/tui/src/kit/kit.test.tsx § PHASE_3` names all eighteen and what each waits for; take an entry
  out and its case runs. One of them is not phase 3's — the `flexShrink` default — and says so.
- **`flexShrink` is an open question and it is not a one-liner.** Yoga defaults it to 0 and the old
  painter defaulted it to 1, and the difference is visible wherever something overflows its box: ours
  clips the last child, the old one squeezed one. Setting `setFlexShrink(1)` in
  `apps/tui/src/layout/yoga.ts` fixes the case that fails and puts `ConfirmButton` into a layout that
  never settles, which wants finding out rather than defaulting around.
